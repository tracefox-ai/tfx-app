import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';

import Connection from '@/models/connection';
import Team from '@/models/team';
import TelemetryInsight, {
  InsightStatus,
  ITelemetryInsight,
} from '@/models/telemetryInsight';
import { connectDB, mongooseConnection } from '@/models';
import {
  HdxTask,
} from '@/tasks/types';
import type { TelemetryAnalysisTaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';
import { analyzeBestPractices } from './analyzers/bestPracticesAnalyzer';
import { analyzeObservability } from './analyzers/observabilityAnalyzer';
import { analyzeReliability } from './analyzers/reliabilityAnalyzer';
import { generateInsights } from './aiService';

// Helper to get tenant database name (similar to calculateDataIngestion)
function getTenantDatabaseName(teamId: string): string {
  return `tenant_${teamId}`;
}

export default class TelemetryAnalysisTask
  implements HdxTask<TelemetryAnalysisTaskArgs>
{
  constructor(private args: TelemetryAnalysisTaskArgs) {}

  async execute(): Promise<void> {
    if (this.args.taskName !== 'telemetry-analysis') {
      throw new Error(
        `TelemetryAnalysisTask can only handle 'telemetry-analysis' tasks, received: ${this.args.taskName}`,
      );
    }

    try {
      // Ensure MongoDB is connected before checking for last run
      if (mongooseConnection.readyState !== 1) {
        logger.info('Connecting to MongoDB...');
        await connectDB();
        logger.info('MongoDB connected');
      }

      // Check if we should run today (only run once per day)
      const lastRun = await TelemetryInsight.findOne()
        .sort({ generatedAt: -1 })
        .select('generatedAt')
        .lean();

      if (lastRun?.generatedAt) {
        const lastRunDate = new Date(lastRun.generatedAt);
        const today = new Date();
        const lastRunDay = new Date(
          lastRunDate.getFullYear(),
          lastRunDate.getMonth(),
          lastRunDate.getDate(),
        );
        const todayDay = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );

        if (lastRunDay.getTime() === todayDay.getTime()) {
          logger.debug(
            {
              lastRun: lastRunDate,
              today,
            },
            'Telemetry analysis already ran today, skipping',
          );
          return;
        }
      }

      logger.info('Starting telemetry analysis task');

      // Get all teams
      const teams = await Team.find({});

      if (teams.length === 0) {
        logger.info('No teams found');
        return;
      }

      logger.info(
        { teamCount: teams.length },
        'Found teams for telemetry analysis',
      );

      // Process each team
      let processedCount = 0;
      let errorCount = 0;
      let insightsGenerated = 0;

      for (const team of teams) {
        try {
          const result = await this.processTeam(team);
          processedCount++;
          insightsGenerated += result.insightCount;
        } catch (error: any) {
          errorCount++;
          logger.error(
            {
              err: serializeError(error),
              teamId: team._id.toString(),
            },
            'Failed to process team for telemetry analysis',
          );
          // Continue processing other teams
        }
      }

      logger.info(
        {
          processedCount,
          errorCount,
          insightsGenerated,
          totalTeams: teams.length,
        },
        'Completed telemetry analysis task',
      );
    } catch (error) {
      logger.error(
        { err: serializeError(error) },
        'Fatal error in telemetry analysis task',
      );
      throw error;
    }
  }

  private async processTeam(
    team: mongoose.HydratedDocument<any>,
  ): Promise<{ insightCount: number }> {
    const teamId = team._id.toString();
    const database = getTenantDatabaseName(teamId);

    logger.debug(
      { teamId, database, teamName: team.name },
      'Processing team for telemetry analysis',
    );

    // Get managed connection for this team
    const connection = await Connection.findOne({
      team: team._id,
      isManaged: true,
    }).select('+password');

    if (!connection) {
      logger.debug(
        { teamId, teamName: team.name },
        'No managed connection found for team, skipping',
      );
      return { insightCount: 0 };
    }

    // Analyze last 7 days of data
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

    try {
      // Run all analyzers in parallel
      const [reliability, observability, bestPractices] = await Promise.all([
        analyzeReliability(connection, database, startTime, endTime),
        analyzeObservability(connection, database, startTime, endTime),
        analyzeBestPractices(connection, database, startTime, endTime),
      ]);

      logger.debug(
        {
          teamId,
          reliability: reliability.summary,
          observability: observability.summary,
          bestPractices: bestPractices.summary,
        },
        'Analysis completed for team',
      );

      // Generate AI insights
      logger.debug(
        {
          teamId,
          teamName: team.name,
        },
        'Generating AI insights from analysis results',
      );
      const insights = await generateInsights(
        reliability,
        observability,
        bestPractices,
        team.name || 'Unknown Team',
        { start: startTime, end: endTime },
      );

      logger.debug(
        {
          teamId,
          insightsGenerated: insights.length,
        },
        'AI insights generated',
      );

      // Store insights in MongoDB
      logger.debug(
        {
          teamId,
          insightsToStore: insights.length,
          insightTitles: insights.map(i => i.title),
        },
        'Preparing to store insights',
      );

      let storedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const insight of insights) {
        try {
          // Check if a similar insight already exists (same team, category, service, title)
          // Only check for insights created in the last 7 days to avoid too many duplicates
          const query: any = {
            team: team._id,
            category: insight.category,
            title: insight.title,
            status: { $in: [InsightStatus.ACTIVE, InsightStatus.RESOLVED] },
            generatedAt: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Within last 7 days
            },
          };

          // Handle serviceName - if undefined, check for documents where serviceName doesn't exist
          if (insight.serviceName) {
            query.serviceName = insight.serviceName;
          } else {
            query.$or = [
              { serviceName: { $exists: false } },
              { serviceName: null },
            ];
          }

          const existing = await TelemetryInsight.findOne(query);

          if (existing) {
            logger.debug(
              {
                teamId,
                insightTitle: insight.title,
                existingId: existing._id,
                existingGeneratedAt: existing.generatedAt,
              },
              'Similar insight already exists, skipping',
            );
            skippedCount++;
            continue;
          }

          // Create new insight
          const created = await TelemetryInsight.create({
            ...insight,
            team: team._id,
            generatedAt: new Date(),
            status: InsightStatus.ACTIVE,
          });

          logger.debug(
            {
              teamId,
              insightId: created._id,
              insightTitle: insight.title,
              category: insight.category,
            },
            'Stored new insight',
          );

          storedCount++;
        } catch (error: any) {
          errorCount++;
          logger.error(
            {
              err: serializeError(error),
              teamId,
              insightTitle: insight.title,
              insightCategory: insight.category,
            },
            'Failed to store insight',
          );
        }
      }

      logger.info(
        {
          teamId,
          insightsGenerated: insights.length,
          insightsStored: storedCount,
          insightsSkipped: skippedCount,
          insightsErrors: errorCount,
        },
        'Insight storage completed',
      );

      logger.info(
        {
          teamId,
          teamName: team.name,
          insightsGenerated: insights.length,
          insightsStored: storedCount,
        },
        'Completed telemetry analysis for team',
      );

      return { insightCount: storedCount };
    } catch (error: any) {
      const errorMessage = error?.message || String(error) || 'Unknown error';

      // Check if it's a permissions error
      const isPermissionError =
        errorMessage.includes('Not enough privileges') ||
        errorMessage.includes('privileges') ||
        errorMessage.includes('grant') ||
        errorMessage.includes('Table') && errorMessage.includes('doesn\'t exist');

      if (isPermissionError) {
        logger.warn(
          {
            err: serializeError(error),
            teamId,
            teamName: team.name,
          },
          'Failed to analyze team - ClickHouse permissions or table missing issue',
        );
      } else {
        logger.error(
          {
            err: serializeError(error),
            teamId,
            teamName: team.name,
          },
          'Failed to analyze team telemetry',
        );
      }
      throw error;
    }
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {
    // Cleanup if needed
  }
}

