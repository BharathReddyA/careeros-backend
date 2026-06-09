import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IParsedProfile {
  name: string;
  email: string;
  phone: string;
  summary: string;
  skills: string[];
  titles: string[];
  experienceYears: number;
  industries: string[];
  education: string[];
  location: string;
}

export interface IResume extends Document {
  userId: Types.ObjectId;
  cloudinaryUrl: string;
  rawText: string;
  parsedProfile: IParsedProfile;
  isActive: boolean;
  createdAt: Date;
}

const ParsedProfileSchema = new Schema<IParsedProfile>(
  {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    summary: { type: String, default: '' },
    skills: { type: [String], default: [] },
    titles: { type: [String], default: [] },
    experienceYears: { type: Number, default: 0 },
    industries: { type: [String], default: [] },
    education: { type: [String], default: [] },
    location: { type: String, default: '' },
  },
  { _id: false }
);

const ResumeSchema = new Schema<IResume>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cloudinaryUrl: { type: String, required: true },
    rawText: { type: String, default: '' },
    parsedProfile: { type: ParsedProfileSchema, default: () => ({}) },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ResumeSchema.index({ userId: 1, isActive: 1 });

export const Resume = mongoose.model<IResume>('Resume', ResumeSchema);
