import mongoose, { Schema } from 'mongoose';

type ObjectId = mongoose.Types.ObjectId;

export interface IDataIngestionMetrics {
  _id: ObjectId;
  team: ObjectId;
  date: string; // YYYY-MM-DD format
  hour: number; // 0-23
  totalBytes: number;
  totalRows: number;
  breakdown: {
    logs: { bytes: number; rows: number };
    traces: { bytes: number; rows: number };
    metrics: { bytes: number; rows: number };
    sessions: { bytes: number; rows: number };
  };
  lastCalculatedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DataIngestionMetricsDocument =
  mongoose.HydratedDocument<IDataIngestionMetrics>;

const DataIngestionMetricsSchema = new Schema<IDataIngestionMetrics>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },
    hour: {
      type: Number,
      required: true,
      min: 0,
      max: 23,
      index: true,
    },
    totalBytes: {
      type: Number,
      required: true,
      default: 0,
    },
    totalRows: {
      type: Number,
      required: true,
      default: 0,
    },
    breakdown: {
      logs: {
        bytes: { type: Number, default: 0 },
        rows: { type: Number, default: 0 },
      },
      traces: {
        bytes: { type: Number, default: 0 },
        rows: { type: Number, default: 0 },
      },
      metrics: {
        bytes: { type: Number, default: 0 },
        rows: { type: Number, default: 0 },
      },
      sessions: {
        bytes: { type: Number, default: 0 },
        rows: { type: Number, default: 0 },
      },
    },
    lastCalculatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// Unique index on (team, date, hour) for efficient lookups and upserts
DataIngestionMetricsSchema.index({ team: 1, date: 1, hour: 1 }, { unique: true });

// Index for querying by team and date range
DataIngestionMetricsSchema.index({ team: 1, date: 1 });

export default mongoose.model<IDataIngestionMetrics>(
  'DataIngestionMetrics',
  DataIngestionMetricsSchema,
);

