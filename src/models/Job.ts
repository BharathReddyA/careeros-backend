import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
  externalId: string;
  source: 'adzuna' | 'jsearch';
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  salary: {
    min: number;
    max: number;
    currency: string;
  };
  jobType: string;
  postedAt: Date;
  fetchedAt: Date;
  expiresAt: Date;
}

const JobSchema = new Schema<IJob>({
  externalId: { type: String, required: true, unique: true },
  source: { type: String, enum: ['adzuna', 'jsearch'], required: true },
  title: { type: String, required: true },
  company: { type: String, required: true },
  location: { type: String, default: '' },
  description: { type: String, default: '' },
  applyUrl: { type: String, required: true },
  salary: {
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
  },
  jobType: { type: String, default: 'full-time' },
  postedAt: { type: Date, default: Date.now },
  fetchedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
});

JobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
JobSchema.index({ title: 'text', description: 'text' });

export const Job = mongoose.model<IJob>('Job', JobSchema);
