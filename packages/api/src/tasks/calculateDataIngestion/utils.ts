import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import Connection, { IConnection } from '@/models/connection';

export type TableType = 'logs' | 'traces' | 'metrics' | 'sessions';

export interface TableMetrics {
  bytes: number;
  rows: number;
}

export interface PartitionMetrics {
  table: string;
  partitionDate: string; // YYYY-MM-DD
  partitionHour: number; // 0-23
  bytes: number;
  rows: number;
}

export interface TableTypeMapping {
  tableName: string;
  type: TableType;
}

/**
 * Get tenant database name from team ID
 */
export function getTenantDatabaseName(teamId: string): string {
  return `tenant_${teamId}`;
}

/**
 * Get mapping of ClickHouse table names to their types
 */
export function getTableNamesByType(): TableTypeMapping[] {
  return [
    { tableName: 'otel_logs', type: 'logs' },
    { tableName: 'otel_traces', type: 'traces' },
    { tableName: 'otel_metrics_gauge', type: 'metrics' },
    { tableName: 'otel_metrics_sum', type: 'metrics' },
    { tableName: 'otel_metrics_histogram', type: 'metrics' },
    { tableName: 'hyperdx_sessions', type: 'sessions' },
  ];
}

/**
 * Query ClickHouse system.parts table to get metrics for a specific database
 */
export async function queryClickHouseMetrics(
  connection: mongoose.HydratedDocument<IConnection>,
  database: string,
  lastCheckTime: Date | null,
): Promise<PartitionMetrics[]> {
  const tableMappings = getTableNamesByType();
  const tableNames = tableMappings.map(m => m.tableName);

  // Build query parameters
  const tableListString = tableNames
    .map((_, idx) => `table = {table${idx}: String}`)
    .join(' OR ');

  const queryParams: Record<string, string> = {
    dbName: database,
  };

  tableNames.forEach((table, idx) => {
    queryParams[`table${idx}`] = table;
  });

  // Build WHERE clause for time filtering
  // We'll use modification_time to get partitions that were modified since last check
  // This captures both new partitions and merged partitions
  let timeFilter = '';
  if (lastCheckTime) {
    // Use modification_time to get partitions that were modified since last check
    // Format: YYYY-MM-DD HH:MM:SS
    const lastCheckTimeStr = lastCheckTime.toISOString().slice(0, 19).replace('T', ' ');
    queryParams.lastCheckTime = lastCheckTimeStr;
    timeFilter = 'AND modification_time >= {lastCheckTime: DateTime}';
  } else {
    // If no last check time, get data for the last 24 hours to initialize
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oneDayAgoStr = oneDayAgo.toISOString().slice(0, 19).replace('T', ' ');
    queryParams.oneDayAgo = oneDayAgoStr;
    timeFilter = 'AND modification_time >= {oneDayAgo: DateTime}';
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });

  const query = `
    SELECT
        table,
        toDate(min_time) as partitionDate,
        toHour(modification_time) as partitionHour,
        sum(bytes) as bytes,
        sum(rows) as rows
    FROM system.parts
    WHERE active = 1
        AND database = {dbName: String}
        AND (${tableListString})
        ${timeFilter}
    GROUP BY table, toDate(min_time), toHour(modification_time)
    ORDER BY partitionDate, partitionHour
  `;

  try {
    const result = await clickhouseClient.query({
      query,
      format: 'JSON',
      query_params: queryParams,
    });

    const json = await result.json<{
      table: string;
      partitionDate: string;
      partitionHour: number;
      bytes: string | number;
      rows: string | number;
    }>();

    // Map the results to match our interface and ensure proper types
    const mappedData: PartitionMetrics[] = (json.data || []).map(row => ({
      table: row.table,
      partitionDate: row.partitionDate || '',
      partitionHour: Number(row.partitionHour) || 0,
      bytes: Number(row.bytes) || 0,
      rows: Number(row.rows) || 0,
    }));

    return mappedData;
  } catch (error) {
    throw new Error(
      `Failed to query ClickHouse metrics for database ${database}: ${error}`,
    );
  }
}

/**
 * Calculate incremental metrics by grouping partition metrics by table type
 */
export function calculateIncrementalMetrics(
  partitionMetrics: PartitionMetrics[],
): {
  totalBytes: number;
  totalRows: number;
  breakdown: {
    logs: TableMetrics;
    traces: TableMetrics;
    metrics: TableMetrics;
    sessions: TableMetrics;
  };
} {
  const tableMappings = getTableNamesByType();
  const tableToType = new Map<string, TableType>();
  tableMappings.forEach(m => {
    tableToType.set(m.tableName, m.type);
  });

  const breakdown = {
    logs: { bytes: 0, rows: 0 },
    traces: { bytes: 0, rows: 0 },
    metrics: { bytes: 0, rows: 0 },
    sessions: { bytes: 0, rows: 0 },
  };

  let totalBytes = 0;
  let totalRows = 0;

  for (const metric of partitionMetrics) {
    const tableType = tableToType.get(metric.table);
    if (!tableType) {
      continue; // Skip unknown tables
    }

    const bytes = Number(metric.bytes) || 0;
    const rows = Number(metric.rows) || 0;

    breakdown[tableType].bytes += bytes;
    breakdown[tableType].rows += rows;
    totalBytes += bytes;
    totalRows += rows;
  }

  return {
    totalBytes,
    totalRows,
    breakdown,
  };
}

