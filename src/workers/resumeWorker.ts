import { Worker, Job } from 'bullmq';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import { getRedisOptions } from '../lib/redis';
import { Resume } from '../models/Resume';
import { parseResume } from '../services/geminiService';

export const RESUME_QUEUE = 'resume-parse';

export interface ResumeJobData {
  resumeId: string;
  cloudinaryUrl: string;
}

export function startResumeWorker(): Worker {
  const worker = new Worker<ResumeJobData>(
    RESUME_QUEUE,
    async (job: Job<ResumeJobData>) => {
      const { resumeId, cloudinaryUrl } = job.data;

      // Download PDF from Cloudinary
      const response = await axios.get<ArrayBuffer>(cloudinaryUrl, {
        responseType: 'arraybuffer',
      });
      const pdfBuffer = Buffer.from(response.data);

      // Extract text
      const parsed = await pdfParse(pdfBuffer);
      const rawText = parsed.text;

      // Parse with Gemini
      const parsedProfile = await parseResume(rawText);

      // Update resume in DB
      await Resume.findByIdAndUpdate(resumeId, {
        rawText,
        parsedProfile,
        isActive: true,
      });

      // Deactivate other resumes for this user
      const resume = await Resume.findById(resumeId);
      if (resume) {
        await Resume.updateMany(
          { userId: resume.userId, _id: { $ne: resumeId } },
          { isActive: false }
        );
      }

      console.log(`Resume ${resumeId} parsed successfully`);
      return { resumeId, parsedProfile };
    },
    { connection: getRedisOptions() }
  );

  worker.on('failed', (job, err) => {
    console.error(`Resume job ${job?.id} failed:`, err);
  });

  return worker;
}
