import { User } from '../models/User';
import { UsageCallback } from '../services/geminiService';

export function trackTokenUsage(userId: string): UsageCallback {
  return async (tokens: number) => {
    await User.findByIdAndUpdate(userId, { $inc: { tokensUsed: tokens } });
  };
}
