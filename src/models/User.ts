import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  fcmToken: string;
  revenueCatId: string;
  isPro: boolean;
  profilePhotoUrl: string;
  tokensUsed: number;
  preferences: {
    jobTypes: string[];
    locations: string[];
    salaryMin: number;
  };
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    fcmToken: { type: String, default: '' },
    revenueCatId: { type: String, default: '' },
    isPro: { type: Boolean, default: false },
    profilePhotoUrl: { type: String, default: '' },
    tokensUsed: { type: Number, default: 0 },
    preferences: {
      jobTypes: { type: [String], default: ['full-time'] },
      locations: { type: [String], default: [] },
      salaryMin: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);
