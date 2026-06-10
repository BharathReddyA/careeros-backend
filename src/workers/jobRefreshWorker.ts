import { Worker, Queue, Job } from 'bullmq';
import { getRedisOptions } from '../lib/redis';
import { User } from '../models/User';
import { Resume } from '../models/Resume';
import { fetchAdzunaJobs } from '../services/adzunaService';
import { batchMatchJobs } from '../services/matchingService';
import { Application } from '../models/Application';
import { trackTokenUsage } from '../lib/tokenUsage';

export const JOB_REFRESH_QUEUE = 'job-refresh';
export const NOTIFY_QUEUE = 'notify';

export interface JobRefreshData {
  userId: string;
}

export interface NotifyJobData {
  userId: string;
  fcmToken: string;
  jobId: string;
  jobTitle: string;
  company: string;
  score: number;
  resumeId: string;
}

let notifyQueue: Queue<NotifyJobData> | null = null;

function getNotifyQueue(): Queue<NotifyJobData> {
  if (!notifyQueue) notifyQueue = new Queue(NOTIFY_QUEUE, { connection: getRedisOptions() });
  return notifyQueue;
}

export function startJobRefreshWorker(): Worker {
  const worker = new Worker<JobRefreshData>(
    JOB_REFRESH_QUEUE,
    async (job: Job<JobRefreshData>) => {
      const { userId } = job.data;

      const user = await User.findById(userId);
      if (!user) return;

      const resume = await Resume.findOne({ userId, isActive: true });
      if (!resume?.parsedProfile?.skills?.length) return;

      const { skills, titles } = resume.parsedProfile;
      const locations = user.preferences.locations;

      console.log(`Fetching jobs for user ${userId} with titles: ${titles?.join(', ')}, skills: ${skills?.slice(0,3).join(', ')}`);
      const jobs = await fetchAdzunaJobs(skills, titles, locations);
      console.log(`Adzuna returned ${jobs.length} jobs`);
      const matched = await batchMatchJobs(jobs, resume.parsedProfile, 15, trackTokenUsage(userId));
      console.log(`Gemini matched ${matched.length} jobs, scores: ${matched.slice(0,5).map(m => m.match.score).join(', ')}`);

      for (const { job: matchedJob, match } of matched) {
        // Upsert application with match score
        const existing = await Application.findOne({
          userId,
          jobId: matchedJob._id,
        });

        if (!existing) {
          await Application.create({
            userId,
            jobId: matchedJob._id,
            resumeId: resume._id,
            status: 'saved',
            matchScore: match.score,
            matchReasons: match.matchReasons,
          });

          // Queue notification for high-match jobs
          if (match.score >= 85 && user.fcmToken) {
            await getNotifyQueue().add('notify', {
              userId,
              fcmToken: user.fcmToken,
              jobId: String(matchedJob._id),
              jobTitle: matchedJob.title,
              company: matchedJob.company,
              score: match.score,
              resumeId: String(resume._id),
            });
          }
        }
      }

      console.log(`Job refresh complete for user ${userId}: ${matched.length} jobs processed`);
    },
    { connection: getRedisOptions() }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job refresh ${job?.id} failed:`, err);
  });

  return worker;
}
