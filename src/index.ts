import 'express-async-errors';
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { Queue } from 'bullmq';

import { connectDB } from './lib/db';
import { initCloudinary } from './lib/cloudinary';
import { getRedisOptions } from './lib/redis';

import authRouter from './routes/auth';
import resumeRouter from './routes/resume';
import jobsRouter from './routes/jobs';
import applicationsRouter from './routes/applications';
import generateRouter from './routes/generate';

import { startResumeWorker, RESUME_QUEUE, ResumeJobData } from './workers/resumeWorker';
import { startJobRefreshWorker, JOB_REFRESH_QUEUE, JobRefreshData } from './workers/jobRefreshWorker';
import { startNotifyWorker } from './workers/notifyWorker';
import { User } from './models/User';
import { Resume } from './models/Resume';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use('/auth', authRouter);
app.use('/resume', resumeRouter);
app.use('/jobs', jobsRouter);
app.use('/applications', applicationsRouter);
app.use('/generate', generateRouter);

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

async function bootstrap(): Promise<void> {
  await connectDB();
  initCloudinary();

  // Clear stale failed/delayed resume jobs that predate the pdfBufferBase64 fix
  const resumeQueue = new Queue<ResumeJobData>(RESUME_QUEUE, { connection: getRedisOptions() });
  await resumeQueue.obliterate({ force: true });
  await resumeQueue.close();
  console.log('Cleared stale resume-parse queue jobs');

  // Start BullMQ workers
  startResumeWorker();
  startJobRefreshWorker();
  startNotifyWorker();

  // Schedule job refresh every 6 hours for all users with active resumes
  cron.schedule('0 */6 * * *', async () => {
    console.log('Running scheduled job refresh for all users...');
    const refreshQueue = new Queue<JobRefreshData>(JOB_REFRESH_QUEUE, {
      connection: getRedisOptions(),
    });

    const activeResumes = await Resume.find({ isActive: true }).distinct('userId');
    const users = await User.find({ _id: { $in: activeResumes } }).select('_id isPro');

    for (const user of users) {
      // Pro users refresh every 2 hours (handled separately), free users every 6
      await refreshQueue.add('refresh', { userId: String(user._id) });
    }

    console.log(`Queued refresh for ${users.length} users`);
  });

  // Pro users: refresh every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    const refreshQueue = new Queue<JobRefreshData>(JOB_REFRESH_QUEUE, {
      connection: getRedisOptions(),
    });

    const activeResumes = await Resume.find({ isActive: true }).distinct('userId');
    const proUsers = await User.find({
      _id: { $in: activeResumes },
      isPro: true,
    }).select('_id');

    for (const user of proUsers) {
      await refreshQueue.add('refresh', { userId: String(user._id) });
    }
  });

  app.listen(PORT, () => {
    console.log(`CareerOS backend running on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
