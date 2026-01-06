import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import Connection, { IConnection } from '@/models/connection';
import logger from '@/utils/logger';

export interface BestPracticePattern {
  serviceName: string;
  inconsistentLogLevels: boolean;
  missingStructuredLogging: boolean;
  nonStandardMetricNames: number;
  missingInstrumentation: boolean;
  logLevelDistribution: Record<string, number>;
}

export interface BestPracticesAnalysisResult {
  patterns: BestPracticePattern[];
  summary: {
    totalServices: number;
    servicesWithInconsistentLogging: number;
    servicesWithMissingStructuredLogs: number;
    servicesWithNonStandardMetrics: number;
  };
}

/**
 * Analyzes best practices patterns from telemetry data
 */
export async function analyzeBestPractices(
  connection: mongoose.HydratedDocument<IConnection>,
  database: string,
  startTime: Date,
  endTime: Date,
): Promise<BestPracticesAnalysisResult> {
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
    'Analyzing best practices patterns',
  );

  try {
    // Query for log level consistency and structured logging patterns
    const logLevelQuery = `
      SELECT
        ServiceName as serviceName,
        SeverityText as severityText,
        count() as count
      FROM \`${sanitizedDbName}\`.otel_logs
      WHERE TimestampTime >= toDateTime({startTime: String})
        AND TimestampTime <= toDateTime({endTime: String})
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
        AND SeverityText != ''
        AND SeverityText IS NOT NULL
      GROUP BY ServiceName, SeverityText
      ORDER BY ServiceName, count DESC
    `;

    const logLevelResult = await clickhouseClient.query({
      query: logLevelQuery,
      format: 'JSON',
      query_params: {
        startTime: startTimeStr,
        endTime: endTimeStr,
      },
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const logLevelJson = await logLevelResult.json<{
      serviceName: string;
      severityText: string;
      count: string;
    }>();

    // Query for structured logging (logs with attributes)
    const structuredLoggingQuery = `
      SELECT
        ServiceName as serviceName,
        count() as totalLogs,
        countIf(mapKeys(LogAttributes) != [] OR mapKeys(ResourceAttributes) != []) as logsWithAttributes
      FROM \`${sanitizedDbName}\`.otel_logs
      WHERE TimestampTime >= toDateTime({startTime: String})
        AND TimestampTime <= toDateTime({endTime: String})
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
      GROUP BY ServiceName
    `;

    const structuredResult = await clickhouseClient.query({
      query: structuredLoggingQuery,
      format: 'JSON',
      query_params: {
        startTime: startTimeStr,
        endTime: endTimeStr,
      },
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const structuredJson = await structuredResult.json<{
      serviceName: string;
      totalLogs: string;
      logsWithAttributes: string;
    }>();

    // Query for metric naming patterns
    const metricNamingQuery = `
      SELECT
        ServiceName as serviceName,
        count(DISTINCT MetricName) as metricCount,
        countIf(
          NOT (
            MetricName LIKE 'http_%' OR
            MetricName LIKE 'rpc_%' OR
            MetricName LIKE 'db_%' OR
            MetricName LIKE 'system_%' OR
            MetricName LIKE 'process_%' OR
            MetricName LIKE 'runtime_%'
          )
        ) as nonStandardMetrics
      FROM \`${sanitizedDbName}\`.otel_metrics_gauge
      WHERE TimeUnix >= toDateTime64({startTime: String}, 9)
        AND TimeUnix <= toDateTime64({endTime: String}, 9)
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
      GROUP BY ServiceName
    `;

    const metricResult = await clickhouseClient.query({
      query: metricNamingQuery,
      format: 'JSON',
      query_params: {
        startTime: startTimeStr,
        endTime: endTimeStr,
      },
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const metricJson = await metricResult.json<{
      serviceName: string;
      metricCount: string;
      nonStandardMetrics: string;
    }>();

    // Process log level data
    const logLevelMap = new Map<string, Record<string, number>>();
    for (const row of logLevelJson.data || []) {
      if (!logLevelMap.has(row.serviceName)) {
        logLevelMap.set(row.serviceName, {});
      }
      logLevelMap.get(row.serviceName)![row.severityText] =
        Number(row.count) || 0;
    }

    // Process structured logging data
    const structuredMap = new Map<
      string,
      { totalLogs: number; logsWithAttributes: number }
    >();
    for (const row of structuredJson.data || []) {
      structuredMap.set(row.serviceName, {
        totalLogs: Number(row.totalLogs) || 0,
        logsWithAttributes: Number(row.logsWithAttributes) || 0,
      });
    }

    // Process metric naming data
    const metricMap = new Map<string, number>();
    for (const row of metricJson.data || []) {
      metricMap.set(row.serviceName, Number(row.nonStandardMetrics) || 0);
    }

    // Combine all services
    const allServices = new Set([
      ...logLevelMap.keys(),
      ...structuredMap.keys(),
      ...metricMap.keys(),
    ]);

    const patterns: BestPracticePattern[] = Array.from(allServices).map(
      serviceName => {
        const logLevels = logLevelMap.get(serviceName) || {};
        const structured = structuredMap.get(serviceName);
        const nonStandardMetrics = metricMap.get(serviceName) || 0;

        // Check for inconsistent log levels (using both uppercase and lowercase, or mixed formats)
        const severityTexts = Object.keys(logLevels);
        const hasInconsistentLevels =
          severityTexts.some(s => s.toLowerCase() !== s) &&
          severityTexts.some(s => s.toLowerCase() === s);

        // Check for missing structured logging (less than 50% have attributes)
        const structuredLoggingRatio =
          structured && structured.totalLogs > 0
            ? structured.logsWithAttributes / structured.totalLogs
            : 0;
        const missingStructuredLogging = structuredLoggingRatio < 0.5;

        return {
          serviceName,
          inconsistentLogLevels: hasInconsistentLevels,
          missingStructuredLogging,
          nonStandardMetricNames: nonStandardMetrics,
          missingInstrumentation: false, // Could be enhanced
          logLevelDistribution: logLevels,
        };
      },
    );

    const summary = {
      totalServices: patterns.length,
      servicesWithInconsistentLogging: patterns.filter(
        p => p.inconsistentLogLevels,
      ).length,
      servicesWithMissingStructuredLogs: patterns.filter(
        p => p.missingStructuredLogging,
      ).length,
      servicesWithNonStandardMetrics: patterns.filter(
        p => p.nonStandardMetricNames > 0,
      ).length,
    };

    logger.debug(
      {
        patternCount: patterns.length,
        summary,
      },
      'Best practices analysis completed',
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
      'Failed to analyze best practices patterns',
    );
    throw new Error(
      `Failed to analyze best practices: ${error?.message || String(error)}`,
    );
  }
}

