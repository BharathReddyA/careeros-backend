import mongoose, { Document, Schema, Types } from 'mongoose';

export type ApplicationStatus =
  | 'saved'
  | 'tailoring'
  | 'ready'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected';

export interface IApplication extends Document {
  userId: Types.ObjectId;
  jobId: Types.ObjectId;
  resumeId: Types.ObjectId;
  status: ApplicationStatus;
  matchScore: number;
  matchReasons: string[];
  tailoredResumeText: string;
  coverLetter: string;
  notes: string;
  appliedAt: Date | null;
  followUpAt: Date | null;
  createdAt: Date;
}

const ApplicationSchema = new Schema<IApplication>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
    status: {
      type: String,
      enum: ['saved', 'tailoring', 'ready', 'applied', 'interviewing', 'offer', 'rejected'],
      default: 'saved',
    },
    matchScore: { type: Number, default: 0, min: 0, max: 100 },
    matchReasons: { type: [String], default: [] },
    tailoredResumeText: { type: String, default: '' },
    coverLetter: { type: String, default: '' },
    notes: { type: String, default: '' },
    appliedAt: { type: Date, default: null },
    followUpAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ApplicationSchema.index({ userId: 1, status: 1 });
ApplicationSchema.index({ userId: 1, jobId: 1 }, { unique: true });

export const Application = mongoose.model<IApplication>('Application', ApplicationSchema);
