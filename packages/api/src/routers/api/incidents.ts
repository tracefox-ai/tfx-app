import { createAnthropic } from '@ai-sdk/anthropic';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { generateText } from 'ai';
import express from 'express';
import { ObjectId } from 'mongodb';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { getAlertById } from '@/controllers/alerts';
import { getRecentAlertHistories } from '@/controllers/alertHistory';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import Incident, {
  IncidentSeverity,
  IncidentStatus,
  TimelineEventType,
} from '@/models/incident';
import Alert, { AlertSource } from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

// Zod schemas
const incidentCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  severity: z.nativeEnum(IncidentSeverity),
  status: z.nativeEnum(IncidentStatus).default(IncidentStatus.OPEN),
  ownerId: objectIdSchema.optional(),
  alertIds: z.array(objectIdSchema).default([]),
});

const incidentUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  ownerId: objectIdSchema.optional(),
  alertIds: z.array(objectIdSchema).optional(),
});

const timelineEventSchema = z.object({
  type: z.nativeEnum(TimelineEventType),
  message: z.string().min(1).max(2000),
  metadata: z.record(z.any()).optional(),
});

// Helper function to add timeline event
async function addTimelineEvent(
  incident: any,
  type: TimelineEventType,
  message: string,
  actorId: any,
  metadata?: Record<string, any>,
) {
  incident.timeline.push({
    type,
    message,
    timestamp: new Date(),
    actor: actorId,
    metadata,
  });
  await incident.save();
}

// Helper function to query logs/traces from an alert
async function queryLogsFromAlert(
  alertId: string,
  teamId: any,
  incidentStartTime?: Date,
): Promise<{ logData: Array<Record<string, any>>; dateRange: { startTime: Date; endTime: Date } } | null> {
  let source: any = null;
  let connection: any = null;
  
  try {
    const alert = await Alert.findById(alertId).populate('savedSearch').populate('dashboard');
    if (!alert || alert.team.toString() !== teamId.toString()) {
      logger.warn({ alertId, teamId }, 'Alert not found or team mismatch');
      return null;
    }

    let startTime: Date;
    let endTime: Date;

    // Get the most recent alert history to determine the time range
    const histories = await getRecentAlertHistories({
      alertId: new ObjectId(alertId),
      limit: 1,
    });

    if (!histories || histories.length === 0 || !histories[0].lastValues || histories[0].lastValues.length === 0) {
      // No history available, use incident start time or default time range
      if (incidentStartTime) {
        // Use 2 hours before incident start to incident start + 1 hour
        startTime = new Date(incidentStartTime.getTime() - ms('2h'));
        endTime = new Date(incidentStartTime.getTime() + ms('1h'));
        logger.info(
          { alertId, startTime, endTime, reason: 'no_alert_history_using_incident_time' },
          'Using incident time range for alert query',
        );
      } else {
        // Fallback: use last hour
        endTime = new Date();
        startTime = new Date(endTime.getTime() - ms('1h'));
        logger.info(
          { alertId, startTime, endTime, reason: 'no_alert_history_no_incident_time' },
          'Using default time range for alert query',
        );
      }
    } else {
    const history = histories[0];
    const lastValues = history.lastValues;
    startTime = new Date(lastValues[0].startTime);
    endTime = new Date(history.createdAt);
    logger.info(
      { alertId, startTime, endTime, reason: 'using_alert_history' },
      'Using alert history time range',
    );
    }

    let source: any = null;
    let connection: any = null;
    let chartConfig: any;

    if (alert.source === AlertSource.SAVED_SEARCH && alert.savedSearch) {
      const savedSearch = await SavedSearch.findById(alert.savedSearch)
        .populate<{ source: any }>('source');
      if (!savedSearch || !savedSearch.source) {
        return null;
      }

      source = savedSearch.source;
      connection = await getConnectionById(
        teamId.toString(),
        source.connection.toString(),
        true, // selectPassword: true - we need the password to query
      );
      if (!connection) {
        return null;
      }

      chartConfig = {
        connection: connection._id.toString(),
        displayType: DisplayType.Search,
        dateRange: [startTime, endTime],
        dateRangeStartInclusive: true,
        dateRangeEndInclusive: true,
        from: source.from,
        select: savedSearch.select || source.defaultTableSelectExpression || '',
        where: savedSearch.where || '',
        whereLanguage: savedSearch.whereLanguage || 'lucene',
        orderBy: savedSearch.orderBy || `${source.timestampValueExpression} DESC`,
        implicitColumnExpression: source.implicitColumnExpression,
        timestampValueExpression: source.timestampValueExpression,
        limit: {
          limit: 10000, // Limit to capture more data
          offset: 0,
        },
      };
    } else if (alert.source === AlertSource.TILE && alert.dashboard && alert.tileId) {
      const dashboard = await Dashboard.findById(alert.dashboard);
      if (!dashboard) {
        return null;
      }

      const tile = dashboard.tiles?.find((t: any) => t.id === alert.tileId);
      if (!tile || !tile.config.source) {
        return null;
      }

      source = await Source.findById(tile.config.source);
      if (!source) {
        return null;
      }

      connection = await getConnectionById(
        teamId.toString(),
        source.connection.toString(),
        true, // selectPassword: true - we need the password to query
      );
      if (!connection) {
        return null;
      }

      // For tile alerts, we need to query the actual logs/traces
      // Use the tile's where condition and source
      chartConfig = {
        connection: connection._id.toString(),
        displayType: DisplayType.Search,
        dateRange: [startTime, endTime],
        dateRangeStartInclusive: true,
        dateRangeEndInclusive: true,
        from: source.from,
        select: source.defaultTableSelectExpression || '',
        where: tile.config.where || '',
        whereLanguage: 'lucene',
        orderBy: `${source.timestampValueExpression} DESC`,
        implicitColumnExpression: source.implicitColumnExpression,
        timestampValueExpression: source.timestampValueExpression,
        limit: {
          limit: 10000, // Limit to capture more data
          offset: 0,
        },
      };
    } else {
      return null;
    }

    // Query the logs/traces
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    const metadata = getMetadata(clickhouseClient);
    
    // Use queryChartConfig to get the data in the proper format
    const result = await clickhouseClient.queryChartConfig({
      config: chartConfig,
      metadata,
    });

    // Extract the data rows from the ResponseJSON format
    // ResponseJSON has structure: { data: [...], meta: [...], rows: number }
    const logData = Array.isArray(result?.data) ? result.data : [];

    logger.info(
      {
        alertId,
        logDataCount: logData.length,
        dateRange: { startTime, endTime },
        hasData: logData.length > 0,
        sampleData: logData.length > 0 ? logData[0] : null,
      },
      'Queried logs from alert for analysis',
    );

    return {
      logData,
      dateRange: { startTime, endTime },
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const isAuthError = errorMessage.includes('Authentication failed') || 
                       errorMessage.includes('password is incorrect') ||
                       error?.code === '516' ||
                       error?.type === 'AUTHENTICATION_FAILED';
    
    if (isAuthError) {
      logger.error(
        { 
          err: error, 
          alertId,
          errorType: 'authentication_failed',
          connectionHost: connection?.host,
          connectionId: connection?._id?.toString(),
          sourceId: source?._id?.toString(),
          sourceKind: source?.kind,
        },
        'ClickHouse authentication failed when querying logs from alert. The connection credentials stored in the database may be incorrect or expired. Please verify the ClickHouse connection settings for this team.',
      );
    } else {
      logger.warn(
        { 
          err: error, 
          alertId,
          errorType: 'query_failed',
          connectionHost: connection?.host,
          connectionId: connection?._id?.toString(),
        },
        'Failed to query logs from alert',
      );
    }
    return null;
  }
}

// GET / - List incidents
router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const { status, severity } = req.query;

    const query: any = { team: teamId };
    if (status) {
      query.status = status;
    }
    if (severity) {
      query.severity = severity;
    }

    const incidents = await Incident.find(query)
      .populate('owner', 'email name')
      .populate({
        path: 'alerts',
        select: 'name state source savedSearch dashboard tileId',
        populate: [
          {
            path: 'savedSearch',
            select: '_id name',
          },
          {
            path: 'dashboard',
            select: '_id name tiles',
          },
        ],
      })
      .sort({ startedAt: -1 })
      .limit(100);

    res.json({ data: incidents });
  } catch (e) {
    next(e);
  }
});

// GET /:id - Get incident details
router.get(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const incident = await Incident.findOne({ _id: id, team: teamId })
        .populate('owner', 'email name')
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        })
        .populate('timeline.actor', 'email name');

      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      res.json({ data: incident });
    } catch (e) {
      next(e);
    }
  },
);

// POST / - Create incident
router.post(
  '/',
  validateRequest({ body: incidentCreateSchema }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { title, description, severity, status, ownerId, alertIds } =
        req.body;

      // Validate alerts belong to team
      if (alertIds && alertIds.length > 0) {
        for (const alertId of alertIds) {
          const alert = await getAlertById(alertId, teamId);
          if (!alert) {
            return res.status(400).json({
              error: `Alert ${alertId} not found or doesn't belong to team`,
            });
          }
        }
      }

      const incident = new Incident({
        title,
        description,
        severity,
        status: status || IncidentStatus.OPEN,
        owner: ownerId,
        team: teamId,
        alerts: alertIds || [],
        startedAt: new Date(),
        timeline: [
          {
            type: TimelineEventType.STATUS_CHANGE,
            message: `Incident created with status: ${status || IncidentStatus.OPEN}`,
            timestamp: new Date(),
            actor: userId,
          },
        ],
      });

      await incident.save();

      // Add alert events to timeline
      if (alertIds && alertIds.length > 0) {
        for (const alertId of alertIds) {
          const alert = await Alert.findById(alertId);
          if (alert) {
            await addTimelineEvent(
              incident,
              TimelineEventType.ALERT,
              `Alert "${alert.name || alertId}" associated with incident`,
              userId,
              { alertId: alertId.toString() },
            );
          }
        }
      }

      const populated = await Incident.findById(incident._id)
        .populate('owner', 'email name')
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        });

      res.json({ data: populated });
    } catch (e) {
      next(e);
    }
  },
);

// PATCH /:id - Update incident
router.patch(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
    body: incidentUpdateSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id } = req.params;
      const update = req.body;

      const incident = await Incident.findOne({ _id: id, team: teamId });
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      // Track status changes
      if (update.status && update.status !== incident.status) {
        await addTimelineEvent(
          incident,
          TimelineEventType.STATUS_CHANGE,
          `Status changed from ${incident.status} to ${update.status}`,
          userId,
        );
        incident.status = update.status;

        // Set resolvedAt if status is Resolved
        if (update.status === IncidentStatus.RESOLVED && !incident.resolvedAt) {
          incident.resolvedAt = new Date();
        } else if (
          update.status !== IncidentStatus.RESOLVED &&
          incident.resolvedAt
        ) {
          incident.resolvedAt = undefined;
        }
      }

      // Track severity changes
      if (update.severity && update.severity !== incident.severity) {
        await addTimelineEvent(
          incident,
          TimelineEventType.STATUS_CHANGE,
          `Severity changed from ${incident.severity} to ${update.severity}`,
          userId,
        );
        incident.severity = update.severity;
      }

      // Track owner changes
      if (update.ownerId && update.ownerId !== incident.owner?.toString()) {
        await addTimelineEvent(
          incident,
          TimelineEventType.STATUS_CHANGE,
          `Owner assigned`,
          userId,
          { ownerId: update.ownerId },
        );
        incident.owner = update.ownerId as any;
      }

      // Update other fields
      if (update.title !== undefined) incident.title = update.title;
      if (update.description !== undefined)
        incident.description = update.description;

      // Handle alert associations
      if (update.alertIds) {
        // Validate alerts
        for (const alertId of update.alertIds) {
          const alert = await getAlertById(alertId, teamId);
          if (!alert) {
            return res.status(400).json({
              error: `Alert ${alertId} not found or doesn't belong to team`,
            });
          }
        }

        // Add new alerts to timeline
        const existingAlertIds = incident.alerts.map((a: any) =>
          a.toString(),
        );
        const newAlertIds = update.alertIds.filter(
          (id: string) => !existingAlertIds.includes(id),
        );

        for (const alertId of newAlertIds) {
          const alert = await Alert.findById(alertId);
          if (alert) {
            await addTimelineEvent(
              incident,
              TimelineEventType.ALERT,
              `Alert "${alert.name || alertId}" associated with incident`,
              userId,
              { alertId: alertId.toString() },
            );
          }
        }

        incident.alerts = update.alertIds as any;
      }

      await incident.save();

      const populated = await Incident.findById(incident._id)
        .populate('owner', 'email name')
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        })
        .populate('timeline.actor', 'email name');

      res.json({ data: populated });
    } catch (e) {
      next(e);
    }
  },
);

// POST /:id/timeline - Add timeline event
router.post(
  '/:id/timeline',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
    body: timelineEventSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id } = req.params;
      const { type, message, metadata } = req.body;

      const incident = await Incident.findOne({ _id: id, team: teamId });
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      await addTimelineEvent(incident, type, message, userId, metadata);

      const populated = await Incident.findById(incident._id)
        .populate('owner', 'email name')
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        })
        .populate('timeline.actor', 'email name');

      res.json({ data: populated });
    } catch (e) {
      next(e);
    }
  },
);

// POST /:id/analyze - Trigger AI analysis
router.post(
  '/:id/analyze',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      if (!config.ANTHROPIC_API_KEY) {
        logger.error('No ANTHROPIC_API_KEY defined');
        return res.status(500).json({
          error: 'AI analysis not available: ANTHROPIC_API_KEY not configured',
        });
      }

      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const incident = await Incident.findOne({ _id: id, team: teamId })
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        })
        .populate('owner', 'email name');

      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      // Query logs/traces from associated alerts
      let allAlertLogs: Array<{ alertName: string; logData: Array<Record<string, any>>; dateRange: { startTime: Date; endTime: Date } }> = [];
      let logContext = '';

      try {
        // Query logs from each associated alert
        if (incident.alerts && incident.alerts.length > 0) {
          logger.info(
            {
              incidentId: id,
              alertCount: incident.alerts.length,
              alertIds: (incident.alerts as any[]).map((a: any) => a._id?.toString()),
            },
            'Starting to query logs from alerts for analysis',
          );

          const alertQueries = await Promise.all(
            (incident.alerts as any[]).map(async (alert: any) => {
              try {
                const alertId = alert._id?.toString() || alert.toString();
                logger.info({ alertId, incidentStartTime: incident.startedAt }, 'Querying logs from alert');
                const logResult = await queryLogsFromAlert(alertId, teamId, incident.startedAt);
                if (logResult) {
                  logger.info(
                    {
                      alertId,
                      logDataCount: logResult.logData.length,
                      dateRange: logResult.dateRange,
                    },
                    'Successfully queried logs from alert',
                  );
                  if (logResult.logData.length > 0) {
                    return {
                      alertName: alert.name || alertId,
                      logData: logResult.logData,
                      dateRange: logResult.dateRange,
                    };
                  } else {
                    logger.warn({ alertId }, 'Alert query returned empty log data');
                  }
                } else {
                  logger.warn({ alertId }, 'queryLogsFromAlert returned null');
                }
              } catch (err: any) {
                const errorMessage = err?.message || String(err);
                const isAuthError = errorMessage.includes('Authentication failed') || 
                                 errorMessage.includes('password is incorrect') ||
                                 err?.code === '516' ||
                                 err?.type === 'AUTHENTICATION_FAILED';
                
                if (isAuthError) {
                  logger.error(
                    { 
                      err, 
                      alertId: alert._id?.toString(),
                      errorType: 'authentication_failed',
                    },
                    'ClickHouse authentication failed when querying logs from alert',
                  );
                } else {
                  logger.error(
                    { 
                      err, 
                      alertId: alert._id?.toString(),
                      errorType: 'query_error',
                    },
                    'Error querying logs from alert',
                  );
                }
              }
              return null;
            }),
          );

          allAlertLogs = alertQueries.filter((q): q is NonNullable<typeof q> => q !== null);

          logger.info(
            {
              incidentId: id,
              successfulQueries: allAlertLogs.length,
              totalLogs: allAlertLogs.reduce((sum, q) => sum + q.logData.length, 0),
            },
            'Completed querying logs from alerts',
          );

          // Combine all alert logs into context
          if (allAlertLogs.length > 0) {
            const combinedLogs = allAlertLogs.flatMap(alertLog => 
              alertLog.logData.map(log => ({
                alert: alertLog.alertName,
                ...log,
              }))
            );
            
            // Limit to 500 logs total to avoid token limits
            logContext = JSON.stringify(combinedLogs.slice(0, 500), null, 2);
            logger.info(
              {
                incidentId: id,
                combinedLogCount: combinedLogs.length,
                logContextLength: logContext.length,
              },
              'Combined alert logs into context',
            );
          } else {
            logger.warn({ incidentId: id }, 'No logs retrieved from any alerts');
          }
        } else {
          logger.warn({ incidentId: id }, 'No alerts associated with incident');
        }

        // Fallback: If no alert logs, try default log source
        if (!logContext && allAlertLogs.length === 0) {
          const defaultSource = await Source.findOne({
            team: teamId,
            kind: 'log',
          });

          if (defaultSource) {
            const connection = await getConnectionById(
              teamId.toString(),
              defaultSource.connection.toString(),
              true, // selectPassword: true - we need the password to query
            );

            if (connection) {
              const analysisStartTime = new Date(
                incident.startedAt.getTime() - ms('2h'),
              );
              const analysisEndTime = new Date();

              const clickhouseClient = new ClickhouseClient({
                host: connection.host,
                username: connection.username,
                password: connection.password,
              });

              // Query recent error logs
              const errorLogsQuery = `
                SELECT 
                  ${defaultSource.timestampValueExpression} as timestamp,
                  ${defaultSource.severityTextExpression} as severity,
                  ${defaultSource.serviceNameExpression} as service,
                  ${defaultSource.bodyExpression} as body
                FROM ${defaultSource.from.databaseName}.${defaultSource.from.tableName}
                WHERE ${defaultSource.timestampValueExpression} >= {startTime:DateTime64}
                  AND ${defaultSource.timestampValueExpression} <= {endTime:DateTime64}
                  AND ${defaultSource.severityTextExpression} IN ('error', 'err', 'ERROR', 'ERR', 'fatal', 'FATAL')
                ORDER BY ${defaultSource.timestampValueExpression} DESC
                LIMIT 100
              `;

              const errorLogs = await clickhouseClient
                .query({
                  query: errorLogsQuery,
                  query_params: {
                    startTime: analysisStartTime,
                    endTime: analysisEndTime,
                  },
                  format: 'JSONEachRow',
                })
                .then(res => res.json());

              if (Array.isArray(errorLogs) && errorLogs.length > 0) {
                logContext = JSON.stringify(errorLogs.slice(0, 50), null, 2);
              }
            }
          }
        }
      } catch (logError: any) {
        const errorMessage = logError?.message || String(logError);
        const isAuthError = errorMessage.includes('Authentication failed') || 
                         errorMessage.includes('password is incorrect') ||
                         logError?.code === '516' ||
                         logError?.type === 'AUTHENTICATION_FAILED';
        
        if (isAuthError) {
          logger.error(
            { 
              err: logError,
              incidentId: id,
              errorType: 'authentication_failed',
            },
            'ClickHouse authentication failed when fetching fallback logs for analysis',
          );
        } else {
          logger.warn(
            { 
              err: logError,
              incidentId: id,
            },
            'Failed to fetch logs for analysis',
          );
        }
        // Continue without log context
      }

      // Build context about the incident
      const incidentContext = {
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        startedAt: incident.startedAt,
        alerts: incident.alerts.map((a: any) => ({
          name: a.name,
          state: a.state,
          message: a.message,
        })),
        timelineEvents: incident.timeline.length,
      };

      const anthropic = createAnthropic({
        apiKey: config.ANTHROPIC_API_KEY,
      });

      const model = anthropic('claude-sonnet-4-5-20250929');

      // Build alert context for the prompt
      const alertContext = allAlertLogs.length > 0
        ? allAlertLogs.map(alertLog => ({
            alertName: alertLog.alertName,
            logCount: alertLog.logData.length,
            dateRange: alertLog.dateRange,
          }))
        : [];

      const hasLogData = logContext && logContext.length > 0 && logContext !== '[]';
      const hasAlerts = incident.alerts && (incident.alerts as any[]).length > 0;
      const hasAuthIssues = allAlertLogs.length === 0 && hasAlerts;
      
      const prompt = `You are an SRE incident analyst. Analyze the following incident and provide actionable insights.

## Incident Context
${JSON.stringify(incidentContext, null, 2)}

${alertContext.length > 0 ? `## Associated Alerts
The following alerts are associated with this incident:
${JSON.stringify(alertContext, null, 2)}
` : ''}${hasLogData ? `## Alert Query Results
The logs/traces below were queried directly from the alert configurations. These represent the exact data that triggered the alerts. Analyze this data carefully:

${logContext}
` : hasAuthIssues ? `## Alert Query Results
⚠️ CRITICAL: Failed to retrieve logs/traces from associated alerts due to ClickHouse authentication errors. This indicates:
- The database connection credentials may be incorrect or expired
- The connection configuration needs to be updated
- There may be a connectivity issue with the ClickHouse database

**Action Required**: The incident analysis cannot access the actual trace/log data that triggered the alerts. Please:
1. Verify ClickHouse connection credentials are correct
2. Check database connectivity
3. Manually query the alerts to retrieve trace data

Please proceed with analysis based on the incident context and alert metadata only.
` : `## Alert Query Results
⚠️ WARNING: No logs or traces were retrieved from the associated alerts. This could indicate:
- The alert queries returned no results
- The time range used may not contain data
- There may be an issue with the alert configuration or data source

Please proceed with analysis based on the incident context and alert metadata only.
`}

## Analysis Requirements
Provide a structured markdown analysis with the following sections:

1. **Log Pattern Analysis**: ${hasLogData ? 'Identify patterns, anomalies, or trends in the logs/traces from the alerts' : 'Note that no trace/log data is available. Analyze based on incident context and alert metadata.'}
2. **Root Cause Indicators**: What might be causing this incident based on ${hasLogData ? 'the alert query results and' : ''} the context provided
3. **Suggested Queries**: Provide 3-5 specific HyperDX query suggestions (in Lucene or SQL format) that would help investigate further
4. **Recommended Actions**: Next steps for the incident commander

Format your response as markdown. Be specific and actionable. ${hasLogData ? 'Focus on the actual data from the alert queries.' : 'Since no trace data is available, focus on the incident context and suggest ways to gather the necessary data.'}`;

      const result = await generateText({
        model,
        prompt,
      });

      // Save analysis to incident
      incident.analysis = result.text;
      await incident.save();

      // Add timeline event
      await addTimelineEvent(
        incident,
        TimelineEventType.COMMENT,
        'AI analysis generated',
        userId,
      );

      const populated = await Incident.findById(incident._id)
        .populate('owner', 'email name')
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        })
        .populate('timeline.actor', 'email name');

      res.json({ data: populated });
    } catch (e) {
      logger.error({ err: e }, 'Error during incident analysis');
      next(e);
    }
  },
);

// GET /:id/report - Generate incident report
router.get(
  '/:id/report',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const incident = await Incident.findOne({ _id: id, team: teamId })
        .populate('owner', 'email name')
        .populate({
          path: 'alerts',
          select: 'name state source savedSearch dashboard tileId',
          populate: [
            {
              path: 'savedSearch',
              select: '_id name',
            },
            {
              path: 'dashboard',
              select: '_id name tiles',
            },
          ],
        })
        .populate('timeline.actor', 'email name');

      if (!incident) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      // Generate markdown report
      const report = generateIncidentReport(incident);

      // Set headers for download
      const filename = `incident-report-${incident._id}-${new Date().toISOString().split('T')[0]}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );

      res.send(report);
    } catch (e) {
      logger.error({ err: e }, 'Error generating incident report');
      next(e);
    }
  },
);

// Helper function to generate incident report
function generateIncidentReport(incident: any): string {
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const formatDuration = (start: Date | string, end?: Date | string) => {
    if (!end) return 'Ongoing';
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const durationMs = endTime - startTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  let report = `# Incident Report\n\n`;
  report += `**Generated:** ${formatDate(new Date())}\n\n`;
  report += `---\n\n`;

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `**Title:** ${incident.title}\n\n`;
  report += `**Status:** ${incident.status}\n\n`;
  report += `**Severity:** ${incident.severity}\n\n`;
  if (incident.description) {
    report += `**Description:** ${incident.description}\n\n`;
  }
  report += `**Started:** ${formatDate(incident.startedAt)}\n\n`;
  if (incident.resolvedAt) {
    report += `**Resolved:** ${formatDate(incident.resolvedAt)}\n\n`;
    report += `**Duration:** ${formatDuration(incident.startedAt, incident.resolvedAt)}\n\n`;
  } else {
    report += `**Duration:** ${formatDuration(incident.startedAt)}\n\n`;
  }
  if (incident.owner) {
    report += `**Owner:** ${incident.owner.name || incident.owner.email}\n\n`;
  }
  report += `---\n\n`;

  // Associated Alerts
  if (incident.alerts && incident.alerts.length > 0) {
    report += `## Associated Alerts\n\n`;
    incident.alerts.forEach((alert: any, index: number) => {
      report += `### Alert ${index + 1}: ${alert.name || 'Unnamed Alert'}\n\n`;
      report += `- **State:** ${alert.state}\n`;
      report += `- **Source:** ${alert.source || 'Unknown'}\n`;
      if (alert.source === 'saved_search' && alert.savedSearch) {
        report += `- **Saved Search:** ${alert.savedSearch.name || alert.savedSearch._id}\n`;
      } else if (alert.source === 'tile' && alert.dashboard) {
        report += `- **Dashboard:** ${alert.dashboard.name || alert.dashboard._id}\n`;
        if (alert.tileId) {
          report += `- **Tile ID:** ${alert.tileId}\n`;
        }
      }
      report += `\n`;
    });
    report += `---\n\n`;
  }

  // Timeline
  if (incident.timeline && incident.timeline.length > 0) {
    report += `## Timeline\n\n`;
    const sortedTimeline = [...incident.timeline].sort(
      (a: any, b: any) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    sortedTimeline.forEach((event: any) => {
      report += `### ${formatDate(event.timestamp)}\n\n`;
      report += `**Type:** ${event.type.replace('_', ' ').toUpperCase()}\n\n`;
      report += `**Message:** ${event.message}\n\n`;
      if (event.actor) {
        report += `**Actor:** ${event.actor.name || event.actor.email}\n\n`;
      }
      if (event.metadata && Object.keys(event.metadata).length > 0) {
        report += `**Metadata:**\n\`\`\`json\n${JSON.stringify(event.metadata, null, 2)}\n\`\`\`\n\n`;
      }
      report += `---\n\n`;
    });
  }

  // Analysis
  if (incident.analysis) {
    report += `## AI Analysis\n\n`;
    report += `${incident.analysis}\n\n`;
    report += `---\n\n`;
  }

  // Log Data Summary
  if (incident.logData && incident.logData.length > 0) {
    report += `## Log/Trace Data Summary\n\n`;
    report += `**Total Logs/Traces Captured:** ${incident.logData.length}\n\n`;
    if (incident.logDataDateRange) {
      report += `**Date Range:** ${formatDate(incident.logDataDateRange.startTime)} - ${formatDate(incident.logDataDateRange.endTime)}\n\n`;
    }
    report += `\n*Note: Full log/trace data is available in the incident record for detailed analysis.*\n\n`;
    report += `---\n\n`;
  }

  // Footer
  report += `## Report Metadata\n\n`;
  report += `- **Incident ID:** ${incident._id}\n`;
  report += `- **Team ID:** ${incident.team}\n`;
  report += `- **Report Generated:** ${formatDate(new Date())}\n`;
  report += `- **Tracefox Incident Management System**\n`;

  return report;
}

export default router;
