import { TeamClickHouseSettingsSchema } from '@hyperdx/common-utils/dist/types';
import crypto from 'crypto';
import express from 'express';
import pick from 'lodash/pick';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import {
  getTags,
  getTeam,
  setTeamName,
  updateTeamClickhouseSettings,
} from '@/controllers/team';
import {
  deleteTeamMember,
  findUserByEmail,
  findUsersByTeam,
} from '@/controllers/user';
import Connection from '@/models/connection';
import DataIngestionMetrics from '@/models/dataIngestionMetrics';
import TeamInvite from '@/models/teamInvite';
import { Source } from '@/models/source';
import { queryServiceLevelMetrics } from '@/tasks/calculateDataIngestion/serviceMetrics';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';
import {
  calculateCosts,
  calculateForecasts,
  aggregateBillingByPeriod,
  getServiceLevelBilling,
  DEFAULT_PRICING,
  type IngestionBreakdown,
  type BillingData,
  type ServiceBilling,
} from '@/utils/billing';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const userId = req.user?._id;

    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    if (userId == null) {
      throw new Error(`User has no id`);
    }

    const team = await getTeam(teamId, [
      '_id',
      'allowedAuthMethods',
      'archive',
      'name',
      'slackAlert',
      'createdAt',
    ]);
    if (team == null) {
      throw new Error(`Team ${teamId} not found for user ${userId}`);
    }

    res.json(team.toJSON());
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/name',
  validateRequest({
    body: z.object({
      name: z.string().min(1).max(100),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }
      const { name } = req.body;
      const team = await setTeamName(teamId, name);
      res.json({ name: team?.name });
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/clickhouse-settings',
  validateRequest({
    body: TeamClickHouseSettingsSchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }

      if (Object.keys(req.body).length === 0) {
        return res.json({});
      }

      const team = await updateTeamClickhouseSettings(teamId, req.body);

      res.json(
        Object.entries(req.body).reduce((acc, cur) => {
          return {
            ...acc,
            [cur[0]]: team?.[cur[0]],
          };
        }, {} as any),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/invitation',
  validateRequest({
    body: z.object({
      email: z.string().email(),
      name: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { email: toEmail, name } = req.body;
      const teamId = req.user?.team;
      const fromEmail = req.user?.email;

      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }

      if (fromEmail == null) {
        throw new Error(`User ${req.user?._id} doesnt have email`);
      }

      const toUser = await findUserByEmail(toEmail);
      if (toUser) {
        return res.status(400).json({
          message:
            'User already exists. Please contact HyperDX team for support',
        });
      }

      // Normalize email to lowercase for consistency
      const normalizedEmail = toEmail.toLowerCase();

      // Check for existing invitation with normalized email
      let teamInvite = await TeamInvite.findOne({
        teamId,
        email: normalizedEmail,
      });

      if (!teamInvite) {
        teamInvite = await new TeamInvite({
          teamId,
          name,
          email: normalizedEmail,
          token: crypto.randomBytes(32).toString('hex'),
        }).save();
      }

      res.json({
        url: `${config.FRONTEND_URL}/join-team?token=${teamInvite.token}`,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/invitations', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    const teamInvites = await TeamInvite.find(
      { teamId },
      {
        createdAt: 1,
        email: 1,
        name: 1,
        token: 1,
      },
    );
    res.json({
      data: teamInvites.map(ti => ({
        _id: ti._id,
        createdAt: ti.createdAt,
        email: ti.email,
        name: ti.name,
        url: `${config.FRONTEND_URL}/join-team?token=${ti.token}`,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.delete(
  '/invitation/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const id = req.params.id;

      await TeamInvite.findByIdAndDelete(id);

      return res.json({ message: 'TeamInvite deleted' });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/members', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const userId = req.user?._id;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    if (userId == null) {
      throw new Error(`User has no id`);
    }
    const teamUsers = await findUsersByTeam(teamId);
    res.json({
      data: teamUsers.map(user => ({
        ...pick(user.toJSON({ virtuals: true }), [
          '_id',
          'email',
          'name',
          'hasPasswordAuth',
        ]),
        isCurrentUser: user._id.equals(userId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.delete(
  '/member/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const userIdToDelete = req.params.id;
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Error(`User ${req.user?._id} not associated with a team`);
      }

      const userIdRequestingDelete = req.user?._id;
      if (!userIdRequestingDelete) {
        throw new Error(`Requesting user has no id`);
      }

      await deleteTeamMember(teamId, userIdToDelete, userIdRequestingDelete);

      res.json({ message: 'User deleted' });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/tags', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    const tags = await getTags(teamId);
    return res.json({ data: tags });
  } catch (e) {
    next(e);
  }
});

router.get('/data-ingestion-metrics-realtime', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const timeRangeHours = req.query.timeRangeHours
      ? parseInt(req.query.timeRangeHours as string, 10)
      : 1;

    // Get the managed connection for this team
    const connection = await Connection.findOne({
      team: teamId,
      isManaged: true,
    }).select('+password');

    if (!connection) {
      return res.json({ data: [] });
    }

    // Get tenant database name - try to get it from Source if available
    const source = await Source.findOne({ team: teamId }).limit(1);
    const database =
      (source as any)?.from?.databaseName ?? `tenant_${teamId.toString()}`;

    // Query real-time service metrics
    const metrics = await queryServiceLevelMetrics(
      connection,
      database,
      timeRangeHours,
    );

    // Aggregate by service (combining all table types)
    const serviceAggregates = new Map<
      string,
      {
        serviceName: string;
        totalBytes: number;
        totalRows: number;
        estimatedBytesPerHour: number;
        estimatedRowsPerHour: number;
        breakdown: {
          logs: { bytes: number; rows: number };
          traces: { bytes: number; rows: number };
          metrics: { bytes: number; rows: number };
          sessions: { bytes: number; rows: number };
        };
      }
    >();

    for (const metric of metrics) {
      if (!serviceAggregates.has(metric.serviceName)) {
        serviceAggregates.set(metric.serviceName, {
          serviceName: metric.serviceName,
          totalBytes: 0,
          totalRows: 0,
          estimatedBytesPerHour: 0,
          estimatedRowsPerHour: 0,
          breakdown: {
            logs: { bytes: 0, rows: 0 },
            traces: { bytes: 0, rows: 0 },
            metrics: { bytes: 0, rows: 0 },
            sessions: { bytes: 0, rows: 0 },
          },
        });
      }

      const aggregate = serviceAggregates.get(metric.serviceName)!;
      aggregate.totalBytes += metric.bytes;
      aggregate.totalRows += metric.rows;
      aggregate.estimatedBytesPerHour += metric.estimatedBytesPerHour;
      aggregate.estimatedRowsPerHour += metric.estimatedRowsPerHour;
      aggregate.breakdown[metric.tableType].bytes += metric.bytes;
      aggregate.breakdown[metric.tableType].rows += metric.rows;
    }

    const result = {
      data: Array.from(serviceAggregates.values()).sort(
        (a, b) => b.estimatedBytesPerHour - a.estimatedBytesPerHour,
      ),
      timeRangeHours,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      {
        serviceCount: result.data.length,
        database,
        teamId: teamId.toString(),
        timeRangeHours,
      },
      'Service metrics API response',
    );

    return res.json(result);
  } catch (e: any) {
    logger.error(
      {
        err: serializeError(e),
        teamId: req.user?.team?.toString(),
        timeRangeHours: req.query.timeRangeHours,
      },
      'Error in data-ingestion-metrics-realtime',
    );
    next(e);
  }
});

router.get('/data-ingestion-metrics', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const { startDate, endDate } = req.query;

    // Default to last 30 days if no date range provided
    const end = endDate
      ? new Date(endDate as string)
      : new Date();
    const start = startDate
      ? new Date(startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const metrics = await DataIngestionMetrics.find({
      team: teamId,
      date: {
        $gte: start.toISOString().split('T')[0],
        $lte: end.toISOString().split('T')[0],
      },
    })
      .sort({ date: 1, hour: 1 })
      .lean();

    // Aggregate daily totals
    const dailyTotals = new Map<string, {
      date: string;
      totalBytes: number;
      totalRows: number;
      breakdown: {
        logs: { bytes: number; rows: number };
        traces: { bytes: number; rows: number };
        metrics: { bytes: number; rows: number };
        sessions: { bytes: number; rows: number };
      };
    }>();

    for (const metric of metrics) {
      const date = metric.date;
      if (!dailyTotals.has(date)) {
        dailyTotals.set(date, {
          date,
          totalBytes: 0,
          totalRows: 0,
          breakdown: {
            logs: { bytes: 0, rows: 0 },
            traces: { bytes: 0, rows: 0 },
            metrics: { bytes: 0, rows: 0 },
            sessions: { bytes: 0, rows: 0 },
          },
        });
      }

      const daily = dailyTotals.get(date)!;
      daily.totalBytes += metric.totalBytes;
      daily.totalRows += metric.totalRows;
      daily.breakdown.logs.bytes += metric.breakdown.logs.bytes;
      daily.breakdown.logs.rows += metric.breakdown.logs.rows;
      daily.breakdown.traces.bytes += metric.breakdown.traces.bytes;
      daily.breakdown.traces.rows += metric.breakdown.traces.rows;
      daily.breakdown.metrics.bytes += metric.breakdown.metrics.bytes;
      daily.breakdown.metrics.rows += metric.breakdown.metrics.rows;
      daily.breakdown.sessions.bytes += metric.breakdown.sessions.bytes;
      daily.breakdown.sessions.rows += metric.breakdown.sessions.rows;
    }

    return res.json({
      data: Array.from(dailyTotals.values()),
      hourly: metrics,
    });
  } catch (e) {
    next(e);
  }
});

// Billing endpoints

router.get('/billing/current', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const currentHour = today.getUTCHours();

    // Get today's metrics
    const todayMetrics = await DataIngestionMetrics.find({
      team: teamId,
      date: todayStr,
    })
      .sort({ hour: 1 })
      .lean();

    // Aggregate today's ingestion
    const todayBreakdown: IngestionBreakdown = {
      logs: { bytes: 0, rows: 0 },
      traces: { bytes: 0, rows: 0 },
      metrics: { bytes: 0, rows: 0 },
      sessions: { bytes: 0, rows: 0 },
    };

    for (const metric of todayMetrics) {
      todayBreakdown.logs.bytes += metric.breakdown.logs.bytes;
      todayBreakdown.logs.rows += metric.breakdown.logs.rows;
      todayBreakdown.traces.bytes += metric.breakdown.traces.bytes;
      todayBreakdown.traces.rows += metric.breakdown.traces.rows;
      todayBreakdown.metrics.bytes += metric.breakdown.metrics.bytes;
      todayBreakdown.metrics.rows += metric.breakdown.metrics.rows;
      todayBreakdown.sessions.bytes += metric.breakdown.sessions.bytes;
      todayBreakdown.sessions.rows += metric.breakdown.sessions.rows;
    }

    // Calculate today's costs
    const todayCosts = calculateCosts(todayBreakdown, DEFAULT_PRICING);

    // Calculate current hourly rate (from current hour if available, or last hour)
    let currentHourlyCost = 0;
    const currentHourMetric = todayMetrics.find(m => m.hour === currentHour);
    const lastHourMetric =
      todayMetrics.length > 0
        ? todayMetrics[todayMetrics.length - 1]
        : null;

    if (currentHourMetric) {
      const hourlyBreakdown: IngestionBreakdown = {
        logs: currentHourMetric.breakdown.logs,
        traces: currentHourMetric.breakdown.traces,
        metrics: currentHourMetric.breakdown.metrics,
        sessions: currentHourMetric.breakdown.sessions,
      };
      currentHourlyCost = calculateCosts(hourlyBreakdown, DEFAULT_PRICING).total;
    } else if (lastHourMetric) {
      const hourlyBreakdown: IngestionBreakdown = {
        logs: lastHourMetric.breakdown.logs,
        traces: lastHourMetric.breakdown.traces,
        metrics: lastHourMetric.breakdown.metrics,
        sessions: lastHourMetric.breakdown.sessions,
      };
      currentHourlyCost = calculateCosts(hourlyBreakdown, DEFAULT_PRICING).total;
    }

    // Estimate daily cost based on current rate
    const estimatedDailyCost = currentHourlyCost * 24;

    return res.json({
      date: todayStr,
      ingestion: todayBreakdown,
      costs: todayCosts,
      currentHourlyCost: Math.round(currentHourlyCost * 100) / 100,
      estimatedDailyCost: Math.round(estimatedDailyCost * 100) / 100,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/billing/forecast', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const currentHour = today.getUTCHours();

    // Get current hour cost for current rate forecast
    const currentHourMetric = await DataIngestionMetrics.findOne({
      team: teamId,
      date: todayStr,
      hour: currentHour,
    }).lean();

    let currentHourlyCost = 0;
    if (currentHourMetric) {
      const hourlyBreakdown: IngestionBreakdown = {
        logs: currentHourMetric.breakdown.logs,
        traces: currentHourMetric.breakdown.traces,
        metrics: currentHourMetric.breakdown.metrics,
        sessions: currentHourMetric.breakdown.sessions,
      };
      currentHourlyCost = calculateCosts(hourlyBreakdown, DEFAULT_PRICING).total;
    }

    // Get last 30 days of metrics for averages
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const metrics = await DataIngestionMetrics.find({
      team: teamId,
      date: {
        $gte: thirtyDaysAgo.toISOString().split('T')[0],
        $lte: todayStr,
      },
    })
      .sort({ date: 1, hour: 1 })
      .lean();

    // Aggregate daily costs
    const dailyCostsMap = new Map<string, number>();
    for (const metric of metrics) {
      const date = metric.date;
      if (!dailyCostsMap.has(date)) {
        dailyCostsMap.set(date, 0);
      }

      const dailyBreakdown: IngestionBreakdown = {
        logs: metric.breakdown.logs,
        traces: metric.breakdown.traces,
        metrics: metric.breakdown.metrics,
        sessions: metric.breakdown.sessions,
      };
      const dailyCost = calculateCosts(dailyBreakdown, DEFAULT_PRICING).total;
      dailyCostsMap.set(date, dailyCostsMap.get(date)! + dailyCost);
    }

    const dailyCosts = Array.from(dailyCostsMap.values());

    // Calculate forecasts
    const forecasts = calculateForecasts(currentHourlyCost, dailyCosts);

    return res.json({
      forecasts,
      currentHourlyCost: Math.round(currentHourlyCost * 100) / 100,
      historicalDailyCosts: dailyCosts,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/billing/breakdown', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const { startDate, endDate, groupBy } = req.query;

    // Default to last 30 days
    const end = endDate
      ? new Date(endDate as string)
      : new Date();
    const start = startDate
      ? new Date(startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const metrics = await DataIngestionMetrics.find({
      team: teamId,
      date: {
        $gte: start.toISOString().split('T')[0],
        $lte: end.toISOString().split('T')[0],
      },
    })
      .sort({ date: 1, hour: 1 })
      .lean();

    // Aggregate by day
    const dailyBilling = new Map<string, BillingData>();

    for (const metric of metrics) {
      const date = metric.date;
      if (!dailyBilling.has(date)) {
        dailyBilling.set(date, {
          date,
          ingestion: {
            logs: { bytes: 0, rows: 0 },
            traces: { bytes: 0, rows: 0 },
            metrics: { bytes: 0, rows: 0 },
            sessions: { bytes: 0, rows: 0 },
          },
          costs: {
            logs: 0,
            traces: 0,
            metrics: 0,
            sessions: 0,
            total: 0,
          },
        });
      }

      const daily = dailyBilling.get(date)!;
      daily.ingestion.logs.bytes += metric.breakdown.logs.bytes;
      daily.ingestion.logs.rows += metric.breakdown.logs.rows;
      daily.ingestion.traces.bytes += metric.breakdown.traces.bytes;
      daily.ingestion.traces.rows += metric.breakdown.traces.rows;
      daily.ingestion.metrics.bytes += metric.breakdown.metrics.bytes;
      daily.ingestion.metrics.rows += metric.breakdown.metrics.rows;
      daily.ingestion.sessions.bytes += metric.breakdown.sessions.bytes;
      daily.ingestion.sessions.rows += metric.breakdown.sessions.rows;
    }

    // Calculate costs for each day
    const dailyBreakdown = Array.from(dailyBilling.values()).map(day => {
      day.costs = calculateCosts(day.ingestion, DEFAULT_PRICING);
      return day;
    });

    // Get service-level breakdown if requested
    let serviceBreakdown: ServiceBilling[] | null = null;
    if (req.query.includeServices === 'true') {
      const connection = await Connection.findOne({
        team: teamId,
        isManaged: true,
      }).select('+password');

      if (connection) {
        const source = await Source.findOne({ team: teamId }).limit(1);
        const database =
          (source as any)?.from?.databaseName ?? `tenant_${teamId.toString()}`;

        const timeRangeHours = 24; // Last 24 hours for service breakdown
        const serviceMetrics = await queryServiceLevelMetrics(
          connection,
          database,
          timeRangeHours,
        );

        // Convert to format expected by getServiceLevelBilling
        const formattedMetrics = serviceMetrics.map(metric => ({
          serviceName: metric.serviceName,
          breakdown: {
            logs: { bytes: 0, rows: 0 },
            traces: { bytes: 0, rows: 0 },
            metrics: { bytes: 0, rows: 0 },
            sessions: { bytes: 0, rows: 0 },
          },
          estimatedBytesPerHour: metric.estimatedBytesPerHour,
          estimatedRowsPerHour: metric.estimatedRowsPerHour,
        }));

        // Aggregate by service
        for (const metric of serviceMetrics) {
          const formatted = formattedMetrics.find(
            m => m.serviceName === metric.serviceName,
          );
          if (formatted) {
            formatted.breakdown[metric.tableType].bytes += metric.bytes;
            formatted.breakdown[metric.tableType].rows += metric.rows;
          }
        }

        serviceBreakdown = getServiceLevelBilling(formattedMetrics, DEFAULT_PRICING);
      }
    }

    // Calculate totals
    const totalBilling = aggregateBillingByPeriod(dailyBreakdown);

    return res.json({
      daily: dailyBreakdown,
      total: totalBilling,
      serviceBreakdown,
      period: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/billing/export', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const { startDate, endDate, format } = req.query;
    const exportFormat = (format as string) || 'json';

    // Default to last 30 days
    const end = endDate
      ? new Date(endDate as string)
      : new Date();
    const start = startDate
      ? new Date(startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const metrics = await DataIngestionMetrics.find({
      team: teamId,
      date: {
        $gte: start.toISOString().split('T')[0],
        $lte: end.toISOString().split('T')[0],
      },
    })
      .sort({ date: 1, hour: 1 })
      .lean();

    // Aggregate daily billing
    const dailyBilling = new Map<string, BillingData>();

    for (const metric of metrics) {
      const date = metric.date;
      if (!dailyBilling.has(date)) {
        dailyBilling.set(date, {
          date,
          ingestion: {
            logs: { bytes: 0, rows: 0 },
            traces: { bytes: 0, rows: 0 },
            metrics: { bytes: 0, rows: 0 },
            sessions: { bytes: 0, rows: 0 },
          },
          costs: {
            logs: 0,
            traces: 0,
            metrics: 0,
            sessions: 0,
            total: 0,
          },
        });
      }

      const daily = dailyBilling.get(date)!;
      daily.ingestion.logs.bytes += metric.breakdown.logs.bytes;
      daily.ingestion.logs.rows += metric.breakdown.logs.rows;
      daily.ingestion.traces.bytes += metric.breakdown.traces.bytes;
      daily.ingestion.traces.rows += metric.breakdown.traces.rows;
      daily.ingestion.metrics.bytes += metric.breakdown.metrics.bytes;
      daily.ingestion.metrics.rows += metric.breakdown.metrics.rows;
      daily.ingestion.sessions.bytes += metric.breakdown.sessions.bytes;
      daily.ingestion.sessions.rows += metric.breakdown.sessions.rows;
    }

    // Calculate costs
    const dailyBreakdown = Array.from(dailyBilling.values()).map(day => {
      day.costs = calculateCosts(day.ingestion, DEFAULT_PRICING);
      return day;
    });

    if (exportFormat === 'csv') {
      // Generate CSV
      const csvRows = [
        [
          'Date',
          'Logs Bytes',
          'Logs Rows',
          'Logs Cost ($)',
          'Traces Bytes',
          'Traces Rows',
          'Traces Cost ($)',
          'Metrics Bytes',
          'Metrics Rows',
          'Metrics Cost ($)',
          'Total Cost ($)',
        ].join(','),
      ];

      for (const day of dailyBreakdown) {
        csvRows.push(
          [
            day.date || '',
            day.ingestion.logs.bytes,
            day.ingestion.logs.rows,
            day.costs.logs,
            day.ingestion.traces.bytes,
            day.ingestion.traces.rows,
            day.costs.traces,
            day.ingestion.metrics.bytes,
            day.ingestion.metrics.rows,
            day.costs.metrics,
            day.costs.total,
          ].join(','),
        );
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="billing-export-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}.csv"`,
      );
      return res.send(csvRows.join('\n'));
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="billing-export-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}.json"`,
      );
      return res.json({
        period: {
          start: start.toISOString().split('T')[0],
          end: end.toISOString().split('T')[0],
        },
        data: dailyBreakdown,
        total: aggregateBillingByPeriod(dailyBreakdown),
      });
    }
  } catch (e) {
    next(e);
  }
});

export default router;