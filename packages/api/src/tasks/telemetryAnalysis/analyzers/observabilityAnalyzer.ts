import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import Connection from '@/models/connection';
import logger from '@/utils/logger';

export interface ObservabilityPattern {
  serviceName: string;
  hasLogs: boolean;
  hasTraces: boolean;
  hasMetrics: boolean;
  traceCoverage: number; // Percentage of logs with trace IDs
  incompleteTraces: number; // Count of traces missing parent/child relationships
  missingAttributes: string[]; // List of missing critical attributes
  logCoverage: number; // Percentage of time with logs
}

export interface ObservabilityAnalysisResult {
  patterns: ObservabilityPattern[];
  summary: {
    totalServices: number;
    servicesWithMissingTraces: number;
    servicesWithLowLogCoverage: number;
    servicesWithIncompleteTraces: number;
  };
}

/**
 * Analyzes observability patterns from telemetry data
 */
export async function analyzeObservability(
  connection: mongoose.HydratedDocument<Connection>,
  database: string,
  startTime: Date,
  endTime: Date,
): Promise<ObservabilityAnalysisResult> {
  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });

  const sanitizedDbName = database.replace(/`/g, '``');
  const startTimeStr = startTime.toISOString().slice(0, 19).replace('T', ' ');
  const endTimeStr = endTime.toISOString().slice(0, 19).replace('T', ' ');

  logger.debug(
    {
      database,
      startTime: startTimeStr,
      endTime: endTimeStr,
    },
    'Analyzing observability patterns',
  );

  try {
    // Query for services and their telemetry coverage
    const query = `
      WITH serviceLogs AS (
        SELECT DISTINCT ServiceName as serviceName
        FROM \`${sanitizedDbName}\`.otel_logs
        WHERE TimestampTime >= toDateTime({startTime: String})
          AND TimestampTime <= toDateTime({endTime: String})
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
      ),
      serviceTraces AS (
        SELECT DISTINCT ServiceName as serviceName
        FROM \`${sanitizedDbName}\`.otel_traces
        WHERE Timestamp >= toDateTime64({startTime: String}, 9)
          AND Timestamp <= toDateTime64({endTime: String}, 9)
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
      ),
      serviceMetrics AS (
        SELECT DISTINCT ServiceName as serviceName
        FROM \`${sanitizedDbName}\`.otel_metrics_gauge
        WHERE TimeUnix >= toDateTime64({startTime: String}, 9)
          AND TimeUnix <= toDateTime64({endTime: String}, 9)
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
      ),
      traceCoverage AS (
        SELECT
          ServiceName as serviceName,
          count() as totalLogs,
          countIf(TraceId != '' AND TraceId IS NOT NULL) as logsWithTraceId
        FROM \`${sanitizedDbName}\`.otel_logs
        WHERE TimestampTime >= toDateTime({startTime: String})
          AND TimestampTime <= toDateTime({endTime: String})
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
        GROUP BY ServiceName
      ),
      incompleteTraces AS (
        SELECT
          ServiceName as serviceName,
          countIf(ParentSpanId = '' OR ParentSpanId IS NULL) as rootSpans,
          count() as totalSpans
        FROM \`${sanitizedDbName}\`.otel_traces
        WHERE Timestamp >= toDateTime64({startTime: String}, 9)
          AND Timestamp <= toDateTime64({endTime: String}, 9)
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
        GROUP BY ServiceName
        HAVING rootSpans * 100.0 / totalSpans > 50  -- More than 50% are root spans suggests missing parent relationships
      ),
      logCoverage AS (
        SELECT
          ServiceName as serviceName,
          count(DISTINCT toStartOfHour(TimestampTime)) as hoursWithLogs,
          toUInt64(dateDiff('hour', toDateTime({startTime: String}), toDateTime({endTime: String}))) + 1 as totalHours
        FROM \`${sanitizedDbName}\`.otel_logs
        WHERE TimestampTime >= toDateTime({startTime: String})
          AND TimestampTime <= toDateTime({endTime: String})
          AND ServiceName != ''
          AND ServiceName IS NOT NULL
        GROUP BY ServiceName
      )
      SELECT
        COALESCE(sl.serviceName, st.serviceName, sm.serviceName) as serviceName,
        CASE WHEN sl.serviceName IS NOT NULL THEN 1 ELSE 0 END as hasLogs,
        CASE WHEN st.serviceName IS NOT NULL THEN 1 ELSE 0 END as hasTraces,
        CASE WHEN sm.serviceName IS NOT NULL THEN 1 ELSE 0 END as hasMetrics,
        COALESCE(tc.logsWithTraceId * 100.0 / NULLIF(tc.totalLogs, 0), 0) as traceCoverage,
        COALESCE(it.totalSpans, 0) as incompleteTraces,
        COALESCE(lc.hoursWithLogs * 100.0 / NULLIF(lc.totalHours, 0), 0) as logCoverage
      FROM serviceLogs sl
      FULL OUTER JOIN serviceTraces st ON sl.serviceName = st.serviceName
      FULL OUTER JOIN serviceMetrics sm ON COALESCE(sl.serviceName, st.serviceName) = sm.serviceName
      LEFT JOIN traceCoverage tc ON COALESCE(sl.serviceName, st.serviceName, sm.serviceName) = tc.serviceName
      LEFT JOIN incompleteTraces it ON COALESCE(sl.serviceName, st.serviceName, sm.serviceName) = it.serviceName
      LEFT JOIN logCoverage lc ON COALESCE(sl.serviceName, st.serviceName, sm.serviceName) = lc.serviceName
      ORDER BY serviceName
    `;

    const result = await clickhouseClient.query({
      query,
      format: 'JSON',
      query_params: {
        startTime: startTimeStr,
        endTime: endTimeStr,
      },
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const json = await result.json<ResponseJSON<{
      serviceName: string;
      hasLogs: string;
      hasTraces: string;
      hasMetrics: string;
      traceCoverage: string;
      incompleteTraces: string;
      logCoverage: string;
    }>>();

    const patterns: ObservabilityPattern[] = (json.data || []).map(row => ({
      serviceName: row.serviceName,
      hasLogs: Number(row.hasLogs) === 1,
      hasTraces: Number(row.hasTraces) === 1,
      hasMetrics: Number(row.hasMetrics) === 1,
      traceCoverage: Number(row.traceCoverage) || 0,
      incompleteTraces: Number(row.incompleteTraces) || 0,
      missingAttributes: [], // Could be enhanced to check for specific attributes
      logCoverage: Number(row.logCoverage) || 0,
    }));

    const summary = {
      totalServices: patterns.length,
      servicesWithMissingTraces: patterns.filter(
        p => p.hasLogs && !p.hasTraces,
      ).length,
      servicesWithLowLogCoverage: patterns.filter(p => p.logCoverage < 50)
        .length,
      servicesWithIncompleteTraces: patterns.filter(
        p => p.incompleteTraces > 0,
      ).length,
    };

    logger.debug(
      {
        patternCount: patterns.length,
        summary,
      },
      'Observability analysis completed',
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
      'Failed to analyze observability patterns',
    );
    throw new Error(
      `Failed to analyze observability: ${error?.message || String(error)}`,
    );
  }
}

