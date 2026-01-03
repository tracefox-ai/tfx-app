import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';

import Connection from '@/models/connection';
import DataIngestionMetrics from '@/models/dataIngestionMetrics';
import { CalculateDataIngestionTaskArgs, HdxTask } from '@/tasks/types';
import logger from '@/utils/logger';
import {
  calculateIncrementalMetrics,
  getTenantDatabaseName,
  queryClickHouseMetrics,
} from './utils';

export default class CalculateDataIngestionTask
  implements HdxTask<CalculateDataIngestionTaskArgs>
{
  constructor(private args: CalculateDataIngestionTaskArgs) {}

  async execute(): Promise<void> {
    if (this.args.taskName !== 'calculate-data-ingestion') {
      throw new Error(
        `CalculateDataIngestionTask can only handle 'calculate-data-ingestion' tasks, received: ${this.args.taskName}`,
      );
    }

    logger.info('Starting data ingestion metrics calculation');

    try {
      // Get all teams with managed ClickHouse connections
      const managedConnections = await Connection.find({
        isManaged: true,
      }).select('+password');

      if (managedConnections.length === 0) {
        logger.info('No managed ClickHouse connections found');
        return;
      }

      logger.info(
        { connectionCount: managedConnections.length },
        'Found managed connections',
      );

      // Process each team
      let processedCount = 0;
      let errorCount = 0;

      for (const connection of managedConnections) {
        try {
          await this.processTeam(connection);
          processedCount++;
        } catch (error) {
          errorCount++;
          logger.error(
            {
              err: serializeError(error),
              teamId: connection.team.toString(),
              connectionId: connection._id.toString(),
            },
            'Failed to process team for data ingestion metrics',
          );
          // Continue processing other teams
        }
      }

      logger.info(
        {
          processedCount,
          errorCount,
          totalConnections: managedConnections.length,
        },
        'Completed data ingestion metrics calculation',
      );
    } catch (error) {
      logger.error(
        { err: serializeError(error) },
        'Fatal error in data ingestion metrics calculation',
      );
      throw error;
    }
  }

  private async processTeam(
    connection: mongoose.HydratedDocument<Connection>,
  ): Promise<void> {
    const teamId = connection.team.toString();
    const database = getTenantDatabaseName(teamId);

    logger.debug(
      { teamId, database, connectionId: connection._id.toString() },
      'Processing team for data ingestion metrics',
    );

    // Get the last calculated time for this team to determine what to query
    const lastMetric = await DataIngestionMetrics.findOne({
      team: connection.team,
    })
      .sort({ date: -1, hour: -1 })
      .limit(1);

    const lastCheckTime = lastMetric?.lastCalculatedAt || null;

    if (lastCheckTime) {
      logger.debug(
        { teamId, lastCheckTime },
        'Found last calculated time, querying for new partitions',
      );
    } else {
      logger.debug(
        { teamId },
        'No previous metrics found, querying last 24 hours',
      );
    }

    // Query ClickHouse for partition metrics
    const partitionMetrics = await queryClickHouseMetrics(
      connection,
      database,
      lastCheckTime,
    );

    if (partitionMetrics.length === 0) {
      logger.debug({ teamId }, 'No partition metrics found');
      return;
    }

    logger.debug(
      { teamId, partitionCount: partitionMetrics.length },
      'Retrieved partition metrics from ClickHouse',
    );

    // Group metrics by date and hour
    const metricsByDateHour = new Map<
      string,
      Array<typeof partitionMetrics[0]>
    >();

    for (const metric of partitionMetrics) {
      const key = `${metric.partitionDate}_${metric.partitionHour}`;
      if (!metricsByDateHour.has(key)) {
        metricsByDateHour.set(key, []);
      }
      metricsByDateHour.get(key)!.push(metric);
    }

    // Calculate and store metrics for each date/hour combination
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentHour = now.getUTCHours();

    for (const [key, metrics] of metricsByDateHour.entries()) {
      const [date, hourStr] = key.split('_');
      const hour = parseInt(hourStr, 10);

      // Only process metrics for the current hour or past hours
      // Skip future dates/hours (shouldn't happen, but safety check)
      if (date > currentDate || (date === currentDate && hour > currentHour)) {
        logger.warn(
          { teamId, date, hour, currentDate, currentHour },
          'Skipping future date/hour metric',
        );
        continue;
      }

      // Calculate metrics for this date/hour
      const calculated = calculateIncrementalMetrics(metrics);

      // Get existing metric for this date/hour
      const existingMetric = await DataIngestionMetrics.findOne({
        team: connection.team,
        date,
        hour,
      });

      // For hourly tracking, we're tracking partitions modified in that hour
      // This is an approximation - partitions are organized by date, not hour
      // We use modification_time hour as a proxy for when data was ingested
      // Note: This may result in some approximation, but provides hourly granularity
      // for daily aggregation and invoicing purposes

      // Upsert the metric
      // We store the totals for partitions modified in this hour
      // When querying for daily totals, sum across all hours
      await DataIngestionMetrics.findOneAndUpdate(
        {
          team: connection.team,
          date,
          hour,
        },
        {
          $set: {
            totalBytes: calculated.totalBytes,
            totalRows: calculated.totalRows,
            breakdown: calculated.breakdown,
            lastCalculatedAt: now,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      logger.debug(
        {
          teamId,
          date,
          hour,
          totalBytes: calculated.totalBytes,
          totalRows: calculated.totalRows,
          hadExistingMetric: !!existingMetric,
        },
        'Stored data ingestion metrics',
      );
    }
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {
    // No cleanup needed
  }
}

