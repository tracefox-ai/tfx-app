import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import Team from './team';

export enum InsightCategory {
  RELIABILITY = 'reliability',
  OBSERVABILITY = 'observability',
  BEST_PRACTICES = 'best_practices',
}

export enum InsightSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum InsightStatus {
  ACTIVE = 'active',
  DISMISSED = 'dismissed',
  RESOLVED = 'resolved',
}

export interface IRelatedQuery {
  type: 'search' | 'chart' | 'dashboard';
  label: string;
  query?: string;
  sourceId?: string;
  dashboardId?: string;
  tileId?: string;
}

export interface ITelemetryInsight {
  team: ObjectId;
  serviceName?: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  suggestions: string[];
  relatedQueries: IRelatedQuery[];
  metadata: Record<string, any>;
  status: InsightStatus;
  dismissedAt?: Date;
  dismissedBy?: ObjectId;
  generatedAt: Date;
  analysisTimeRange: {
    start: Date;
    end: Date;
  };
}

export type TelemetryInsightDocument =
  mongoose.HydratedDocument<ITelemetryInsight>;

const RelatedQuerySchema = new Schema<IRelatedQuery>(
  {
    type: {
      type: String,
      enum: ['search', 'chart', 'dashboard'],
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    query: {
      type: String,
      required: false,
    },
    sourceId: {
      type: String,
      required: false,
    },
    dashboardId: {
      type: String,
      required: false,
    },
    tileId: {
      type: String,
      required: false,
    },
  },
  { _id: false },
);

const TelemetryInsightSchema = new Schema<ITelemetryInsight>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: Team.modelName,
      index: true,
    },
    serviceName: {
      type: String,
      required: false,
      index: true,
    },
    category: {
      type: String,
      enum: InsightCategory,
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: InsightSeverity,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    suggestions: {
      type: [String],
      required: true,
      default: [],
    },
    relatedQueries: {
      type: [RelatedQuerySchema],
      required: true,
      default: [],
    },
    metadata: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    status: {
      type: String,
      enum: InsightStatus,
      default: InsightStatus.ACTIVE,
      index: true,
    },
    dismissedAt: {
      type: Date,
      required: false,
    },
    dismissedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    analysisTimeRange: {
      start: {
        type: Date,
        required: true,
      },
      end: {
        type: Date,
        required: true,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

// Index for efficient queries
TelemetryInsightSchema.index({ team: 1, status: 1, generatedAt: -1 });
TelemetryInsightSchema.index({ team: 1, category: 1, status: 1 });
TelemetryInsightSchema.index({ team: 1, serviceName: 1, status: 1 });

export default mongoose.model<ITelemetryInsight>(
  'TelemetryInsight',
  TelemetryInsightSchema,
);

