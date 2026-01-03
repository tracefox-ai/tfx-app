import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import Connection from '@/models/connection';
import logger from '@/utils/logger';

export interface ServiceMetrics {
  serviceName: string;
  tableType: 'logs' | 'traces' | 'metrics' | 'sessions';
  bytes: number;
  rows: number;
  estimatedBytesPerHour: number;
  estimatedRowsPerHour: number;
}

/**
 * Query ClickHouse tables directly for real-time service-level metrics
 * This queries the actual data tables (not system.parts) to get service breakdown
 */
export async function queryServiceLevelMetrics(
  connection: mongoose.HydratedDocument<Connection>,
  database: string,
  timeRangeHours: number = 1,
): Promise<ServiceMetrics[]> {
  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });

  const now = new Date();
  const startTime = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);
  // Format for ClickHouse DateTime/DateTime64
  const startTimeStr = startTime.toISOString().slice(0, 19).replace('T', ' ');

  // Sanitize database name for use in SQL (escape backticks)
  const sanitizedDbName = database.replace(/`/g, '``');

  const queryParams: Record<string, string> = {
    startTime: startTimeStr,
  };

  logger.debug(
    {
      database,
      timeRangeHours,
      startTime: startTimeStr,
      now: now.toISOString(),
    },
    'Querying service metrics',
  );

  // Query each table type separately and union the results
  // We use approximate row counts and size estimates for performance
  // Use toDateTime/toDateTime64 to convert timestamps for comparison
  // Note: Database name is interpolated directly (sanitized) since parameter substitution
  // doesn't work in database.table syntax
  const query = `
    SELECT
        ServiceName as serviceName,
        'logs' as tableType,
        count() as rows,
        sum(length(Body) + length(TraceId) + length(SpanId)) as estimatedBytes
    FROM \`${sanitizedDbName}\`.otel_logs
    WHERE TimestampTime >= toDateTime({startTime: String})
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
    GROUP BY ServiceName
    
    UNION ALL
    
    SELECT
        ServiceName as serviceName,
        'traces' as tableType,
        count() as rows,
        sum(length(TraceId) + length(SpanId) + length(SpanName) + coalesce(length(StatusMessage), 0)) as estimatedBytes
    FROM \`${sanitizedDbName}\`.otel_traces
    WHERE Timestamp >= toDateTime64({startTime: String}, 9)
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
    GROUP BY ServiceName
    
    UNION ALL
    
    SELECT
        ServiceName as serviceName,
        'metrics' as tableType,
        count() as rows,
        sum(length(MetricName) + length(MetricDescription) + length(MetricUnit)) as estimatedBytes
    FROM \`${sanitizedDbName}\`.otel_metrics_gauge
    WHERE TimeUnix >= toDateTime64({startTime: String}, 9)
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
    GROUP BY ServiceName
    
    UNION ALL
    
    SELECT
        ServiceName as serviceName,
        'metrics' as tableType,
        count() as rows,
        sum(length(MetricName) + length(MetricDescription) + length(MetricUnit)) as estimatedBytes
    FROM \`${sanitizedDbName}\`.otel_metrics_sum
    WHERE TimeUnix >= toDateTime64({startTime: String}, 9)
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
    GROUP BY ServiceName
    
    UNION ALL
    
    SELECT
        ServiceName as serviceName,
        'metrics' as tableType,
        count() as rows,
        sum(length(MetricName) + length(MetricDescription) + length(MetricUnit)) as estimatedBytes
    FROM \`${sanitizedDbName}\`.otel_metrics_histogram
    WHERE TimeUnix >= toDateTime64({startTime: String}, 9)
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
    GROUP BY ServiceName
    
    UNION ALL
    
    SELECT
        ServiceName as serviceName,
        'sessions' as tableType,
        count() as rows,
        sum(length(Body) + length(TraceId) + length(SpanId)) as estimatedBytes
    FROM \`${sanitizedDbName}\`.hyperdx_sessions
    WHERE TimestampTime >= toDateTime({startTime: String})
        AND ServiceName != ''
        AND ServiceName IS NOT NULL
    GROUP BY ServiceName
  `;

  try {
    const result = await clickhouseClient.query({
      query,
      format: 'JSON',
      query_params: queryParams,
      clickhouse_settings: {
        max_execution_time: 30,
      },
    });

    const json = await result.json<ResponseJSON<{
      serviceName: string;
      tableType: string;
      rows: string;
      estimatedBytes: string;
    }>>();

    logger.debug(
      {
        rowCount: json.data?.length || 0,
        sampleRows: json.data?.slice(0, 3),
      },
      'Service metrics query result',
    );

    // Aggregate by service and table type, then calculate hourly estimates
    const serviceMap = new Map<string, ServiceMetrics>();

    for (const row of json.data || []) {
      const key = `${row.serviceName}_${row.tableType}`;
      const rows = Number(row.rows) || 0;
      const bytes = Number(row.estimatedBytes) || 0;

      if (!serviceMap.has(key)) {
        serviceMap.set(key, {
          serviceName: row.serviceName,
          tableType: row.tableType as 'logs' | 'traces' | 'metrics' | 'sessions',
          bytes: 0,
          rows: 0,
          estimatedBytesPerHour: 0,
          estimatedRowsPerHour: 0,
        });
      }

      const metric = serviceMap.get(key)!;
      metric.bytes += bytes;
      metric.rows += rows;
    }

    // Calculate hourly estimates
    for (const metric of serviceMap.values()) {
      metric.estimatedBytesPerHour = Math.round(
        (metric.bytes / timeRangeHours) * 1.1, // Add 10% buffer for compression
      );
      metric.estimatedRowsPerHour = Math.round(metric.rows / timeRangeHours);
    }

    return Array.from(serviceMap.values()).sort(
      (a, b) => b.estimatedBytesPerHour - a.estimatedBytesPerHour,
    );
  } catch (error: any) {
    // Log the full error for debugging
    const errorMessage = error?.message || String(error);
    logger.error(
      {
        err: error,
        database,
        timeRangeHours,
        startTimeStr,
        errorMessage,
      },
      'Service metrics query error',
    );
    throw new Error(
      `Failed to query service-level metrics for database ${database}: ${errorMessage}`,
    );
  }
}

