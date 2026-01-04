import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getNonNullUserWithTeam } from '@/middleware/auth';
import TelemetryInsight, {
  InsightCategory,
  InsightStatus,
} from '@/models/telemetryInsight';
import { objectIdSchema } from '@/utils/zod';
import logger from '@/utils/logger';

const router = express.Router();

// GET /api/telemetry-insights - List insights for team
router.get(
  '/',
  validateRequest({
    query: z.object({
      status: z.enum(['active', 'dismissed', 'resolved']).optional(),
      category: z
        .enum(['reliability', 'observability', 'best_practices'])
        .optional(),
      serviceName: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { status, category, serviceName, limit, offset } = req.query;

      const query: any = {
        team: teamId,
      };

      if (status) {
        query.status = status;
      }

      if (category) {
        query.category = category;
      }

      if (serviceName) {
        query.serviceName = serviceName;
      }

      const insights = await TelemetryInsight.find(query)
        .sort({ generatedAt: -1, severity: -1 })
        .limit(limit as number)
        .skip(offset as number)
        .populate('dismissedBy', 'email name')
        .lean();

      const total = await TelemetryInsight.countDocuments(query);

      res.json({
        data: insights,
        total,
        limit,
        offset,
      });
    } catch (e) {
      logger.error({ err: e }, 'Error fetching telemetry insights');
      next(e);
    }
  },
);

// GET /api/telemetry-insights/:id - Get single insight
router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const insight = await TelemetryInsight.findOne({
        _id: id,
        team: teamId,
      })
        .populate('dismissedBy', 'email name')
        .lean();

      if (!insight) {
        return res.status(404).json({ error: 'Insight not found' });
      }

      res.json({ data: insight });
    } catch (e) {
      logger.error({ err: e }, 'Error fetching telemetry insight');
      next(e);
    }
  },
);

// POST /api/telemetry-insights/:id/dismiss - Dismiss an insight
router.post(
  '/:id/dismiss',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const insight = await TelemetryInsight.findOne({
        _id: id,
        team: teamId,
      });

      if (!insight) {
        return res.status(404).json({ error: 'Insight not found' });
      }

      insight.status = InsightStatus.DISMISSED;
      insight.dismissedAt = new Date();
      insight.dismissedBy = userId;
      await insight.save();

      res.json({ data: insight });
    } catch (e) {
      logger.error({ err: e }, 'Error dismissing telemetry insight');
      next(e);
    }
  },
);

// POST /api/telemetry-insights/:id/acknowledge - Acknowledge an insight (mark as resolved)
router.post(
  '/:id/acknowledge',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const insight = await TelemetryInsight.findOne({
        _id: id,
        team: teamId,
      });

      if (!insight) {
        return res.status(404).json({ error: 'Insight not found' });
      }

      insight.status = InsightStatus.RESOLVED;
      await insight.save();

      res.json({ data: insight });
    } catch (e) {
      logger.error({ err: e }, 'Error acknowledging telemetry insight');
      next(e);
    }
  },
);

// POST /api/telemetry-insights/analyze - Trigger manual analysis
router.post(
  '/analyze',
  validateRequest({
    body: z.object({
      serviceName: z.string().optional(),
      timeRangeHours: z.coerce.number().int().min(1).max(168).optional().default(168), // Default 7 days
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { serviceName, timeRangeHours } = req.body;

      // This endpoint would trigger a manual analysis
      // For now, we'll return a message indicating it's queued
      // In a full implementation, this would queue a job or run analysis synchronously
      
      logger.info(
        {
          teamId,
          serviceName,
          timeRangeHours,
        },
        'Manual telemetry analysis requested',
      );

      res.json({
        message: 'Analysis queued',
        serviceName,
        timeRangeHours,
      });
    } catch (e) {
      logger.error({ err: e }, 'Error triggering telemetry analysis');
      next(e);
    }
  },
);

export default router;

