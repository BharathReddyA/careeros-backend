import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IJobView extends Document {
  userId: Types.ObjectId;
  jobId: Types.ObjectId;
  viewedAt: Date;
}

const JobViewSchema = new Schema<IJobView>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  viewedAt: { type: Date, default: Date.now },
});

JobViewSchema.index({ userId: 1, jobId: 1 }, { unique: true });
JobViewSchema.index({ userId: 1, viewedAt: -1 });

export const JobView = mongoose.model<IJobView>('JobView', JobViewSchema);
