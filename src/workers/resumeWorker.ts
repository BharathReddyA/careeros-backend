import { Worker, Job } from 'bullmq';
import pdfParse from 'pdf-parse';
import { getRedisOptions } from '../lib/redis';
import { Resume } from '../models/Resume';
import { parseResume } from '../services/geminiService';
import { trackTokenUsage } from '../lib/tokenUsage';

export const RESUME_QUEUE = 'resume-parse';

export interface ResumeJobData {
  resumeId: string;
  cloudinaryUrl: string;
  pdfBufferBase64?: string;
}

const flatten = (arr: unknown[]): string[] =>
  arr.map((item) =>
    typeof item === 'string'
      ? item
      : Object.values(item as Record<string, unknown>).join(', ')
  );

export function startResumeWorker(): Worker {
  const worker = new Worker<ResumeJobData>(
    RESUME_QUEUE,
    async (job: Job<ResumeJobData>) => {
      const { resumeId, pdfBufferBase64 } = job.data;

      if (!pdfBufferBase64) {
        throw new Error(`No PDF buffer provided for resume ${resumeId}`);
      }

      const pdfBuffer = Buffer.from(pdfBufferBase64, 'base64');

      const parsed = await pdfParse(pdfBuffer);
      const rawText = parsed.text;

      const resumeDoc = await Resume.findById(resumeId);
      if (!resumeDoc) {
        throw new Error(`Resume ${resumeId} not found`);
      }

      const parsedProfile = await parseResume(rawText, trackTokenUsage(String(resumeDoc.userId)));

      // Flatten any object arrays Gemini may return
      if (parsedProfile.education?.length) parsedProfile.education = flatten(parsedProfile.education as unknown[]);
      if (parsedProfile.skills?.length) parsedProfile.skills = flatten(parsedProfile.skills as unknown[]);
      if (parsedProfile.titles?.length) parsedProfile.titles = flatten(parsedProfile.titles as unknown[]);
      if (parsedProfile.industries?.length) parsedProfile.industries = flatten(parsedProfile.industries as unknown[]);

      await Resume.findByIdAndUpdate(resumeId, {
        rawText,
        parsedProfile,
        isActive: true,
      });

      await Resume.updateMany(
        { userId: resumeDoc.userId, _id: { $ne: resumeId } },
        { isActive: false }
      );

      console.log(`Resume ${resumeId} parsed successfully`);
      return { resumeId, parsedProfile };
    },
    { connection: getRedisOptions() }
  );

  worker.on('failed', (job, err) => {
    console.error(`Resume job ${job?.id} failed:`, err.message);
  });

  return worker;
}
