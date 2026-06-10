import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICoachingQuestion {
  text: string;
  category: string;
  audioUrl: string;
  answerAudioUrl: string;
  transcript: string;
  feedback: string;
  strengths: string[];
  improvements: string[];
  score: number;
  answeredAt: Date | null;
}

export type CoachingSessionStatus = 'in_progress' | 'completed';

export interface ICoachingSession extends Document {
  userId: Types.ObjectId;
  jobId: Types.ObjectId | null;
  roleTitle: string;
  questions: ICoachingQuestion[];
  currentQuestionIndex: number;
  status: CoachingSessionStatus;
  overallScore: number;
  overallFeedback: string;
  createdAt: Date;
  completedAt: Date | null;
}

const CoachingQuestionSchema = new Schema<ICoachingQuestion>(
  {
    text: { type: String, required: true },
    category: { type: String, default: '' },
    audioUrl: { type: String, default: '' },
    answerAudioUrl: { type: String, default: '' },
    transcript: { type: String, default: '' },
    feedback: { type: String, default: '' },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    score: { type: Number, default: 0 },
    answeredAt: { type: Date, default: null },
  },
  { _id: false }
);

const CoachingSessionSchema = new Schema<ICoachingSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    roleTitle: { type: String, required: true },
    questions: { type: [CoachingQuestionSchema], default: [] },
    currentQuestionIndex: { type: Number, default: 0 },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
    overallScore: { type: Number, default: 0 },
    overallFeedback: { type: String, default: '' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CoachingSessionSchema.index({ userId: 1, createdAt: -1 });

export const CoachingSession = mongoose.model<ICoachingSession>('CoachingSession', CoachingSessionSchema);
