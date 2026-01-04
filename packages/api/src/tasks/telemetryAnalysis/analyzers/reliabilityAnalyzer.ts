import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import Connection from '@/models/connection';
import logger from '@/utils/logger';

export interface ReliabilityPattern {
  serviceName: string;
  errorRate: number;
  errorCount: number;
  totalCount: number;
  errorRateTrend: 'increasing' | 'decreasing' | 'stable';
  spikeDetected: boolean;
  hasAlerts: boolean;
}

export interface ReliabilityAnalysisResult {
  patterns: ReliabilityPattern[];
  summary: {
    totalServices: number;
    servicesWithHighErrorRate: number;
    servicesWithSpikes: number;
    servicesWithoutAlerts: number;
  };
}

/**
 * Analyzes reliability patterns from telemetry data
 */
export async function analyzeReliability(
  connection: mongoose.HydratedDocument<Connection>,
  database: string,
  startTime: Date,
  endTime: Date,
): Promise<ReliabilityAnalysisResult> {
  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });

  const sanitizedDbName = database.replace(/`/g, '``');
  const startTimeStr = startTime.toISOString().slice(0, 19).replace('T', ' ');
  const endTimeStr = endTime.toISOString().slice(0, 19).replace('T', ' ');

  // Calculate time windows for trend analysis (split into 2 periods)
  const midTime = new Date(
    startTime.getTime() + (endTime.getTime() - startTime.getTime()) / 2,
  );
  const midTimeStr = midTime.toISOString().slice(0, 19).replace('T', ' ');

  logger.debug(
    {
      database,
      startTime: startTimeStr,
      endTime: endTimeStr,
      midTime: midTimeStr,
    },
    'Analyzing reliability patterns',
  );

  try {
    // Query error rates by service, split into two time periods for trend analysis
    const query = `
      WITH period1 AS (
        SELECT
          ServiceName as serviceName,
          countIf(SeverityText = 'error' OR SeverityText = 'ERROR' OR SeverityNumber >= 17) as errorCount,
          count() as totalCount
        FROM \`${sanitizedDbName}\`.otel_logs
        WHERE TimestampTime >= toDateTime({startTime: String})
          AND TimestampTime < toDateTime({midTime: String})
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
        GROUP BY ServiceName
      ),
      period2 AS (
        SELECT
          ServiceName as serviceName,
          countIf(SeverityText = 'error' OR SeverityText = 'ERROR' OR SeverityNumber >= 17) as errorCount,
          count() as totalCount
        FROM \`${sanitizedDbName}\`.otel_logs
        WHERE TimestampTime >= toDateTime({midTime: String})
          AND TimestampTime <= toDateTime({endTime: String})
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
        GROUP BY ServiceName
      ),
      hourlyErrors AS (
        SELECT
          ServiceName as serviceName,
          toStartOfHour(TimestampTime) as hour,
          countIf(SeverityText = 'error' OR SeverityText = 'ERROR' OR SeverityNumber >= 17) as errorCount
        FROM \`${sanitizedDbName}\`.otel_logs
        WHERE TimestampTime >= toDateTime({startTime: String})
          AND TimestampTime <= toDateTime({endTime: String})
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
        GROUP BY ServiceName, hour
      ),
      spikeDetection AS (
        SELECT
          serviceName,
          max(errorCount) as maxHourlyErrors,
          avg(errorCount) as avgHourlyErrors,
          stddevPop(errorCount) as stddevHourlyErrors
        FROM hourlyErrors
        GROUP BY serviceName
      )
      SELECT
        COALESCE(p1.serviceName, p2.serviceName) as serviceName,
        COALESCE(p1.errorCount, 0) + COALESCE(p2.errorCount, 0) as errorCount,
        COALESCE(p1.totalCount, 0) + COALESCE(p2.totalCount, 0) as totalCount,
        CASE
          WHEN COALESCE(p1.totalCount, 0) + COALESCE(p2.totalCount, 0) > 0 THEN
            (COALESCE(p1.errorCount, 0) + COALESCE(p2.errorCount, 0)) * 100.0 / (COALESCE(p1.totalCount, 0) + COALESCE(p2.totalCount, 0))
          ELSE 0
        END as errorRate,
        CASE
          WHEN COALESCE(p1.totalCount, 0) = 0 THEN 'stable'
          WHEN COALESCE(p2.totalCount, 0) = 0 THEN 'stable'
          WHEN (p2.errorCount * 100.0 / p2.totalCount) > (p1.errorCount * 100.0 / p1.totalCount) * 1.2 THEN 'increasing'
          WHEN (p2.errorCount * 100.0 / p2.totalCount) < (p1.errorCount * 100.0 / p1.totalCount) * 0.8 THEN 'decreasing'
          ELSE 'stable'
        END as errorRateTrend,
        CASE
          WHEN sd.maxHourlyErrors > sd.avgHourlyErrors + (sd.stddevHourlyErrors * 2) THEN 1
          ELSE 0
        END as spikeDetected
      FROM period1 p1
      FULL OUTER JOIN period2 p2 ON p1.serviceName = p2.serviceName
      LEFT JOIN spikeDetection sd ON COALESCE(p1.serviceName, p2.serviceName) = sd.serviceName
      WHERE COALESCE(p1.totalCount, 0) + COALESCE(p2.totalCount, 0) > 0
      ORDER BY errorRate DESC
    `;

    const result = await clickhouseClient.query({
      query,
      format: 'JSON',
      query_params: {
        startTime: startTimeStr,
        midTime: midTimeStr,
        endTime: endTimeStr,
      },
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const json = await result.json<ResponseJSON<{
      serviceName: string;
      errorCount: string;
      totalCount: string;
      errorRate: string;
      errorRateTrend: string;
      spikeDetected: string;
    }>>();

    const patterns: ReliabilityPattern[] = (json.data || []).map(row => ({
      serviceName: row.serviceName,
      errorCount: Number(row.errorCount) || 0,
      totalCount: Number(row.totalCount) || 0,
      errorRate: Number(row.errorRate) || 0,
      errorRateTrend: row.errorRateTrend as
        | 'increasing'
        | 'decreasing'
        | 'stable',
      spikeDetected: Number(row.spikeDetected) === 1,
      hasAlerts: false, // Will be populated by checking alerts separately
    }));

    const summary = {
      totalServices: patterns.length,
      servicesWithHighErrorRate: patterns.filter(p => p.errorRate > 5).length,
      servicesWithSpikes: patterns.filter(p => p.spikeDetected).length,
      servicesWithoutAlerts: 0, // Will be populated separately
    };

    logger.debug(
      {
        patternCount: patterns.length,
        summary,
      },
      'Reliability analysis completed',
    );

    return {
      patterns,
      summary,
    };
  } catch (error: any) {
    logger.error(
      {
        err: error,
        database,
        startTime: startTimeStr,
        endTime: endTimeStr,
      },
      'Failed to analyze reliability patterns',
    );
    throw new Error(
      `Failed to analyze reliability: ${error?.message || String(error)}`,
    );
  }
}

