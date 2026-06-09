import { Worker, Job } from 'bullmq';
import { getRedisOptions } from '../lib/redis';
import { sendHighMatchNotification, sendFollowUpNotification } from '../services/notificationService';
import { NotifyJobData } from './jobRefreshWorker';

export interface FollowUpNotifyData {
  fcmToken: string;
  company: string;
  applicationId: string;
}

export function startNotifyWorker(): Worker {
  const worker = new Worker<NotifyJobData | FollowUpNotifyData>(
    'notify',
    async (job: Job<NotifyJobData | FollowUpNotifyData>) => {
      if ('jobId' in job.data) {
        const { fcmToken, score, jobTitle, company, jobId } = job.data as NotifyJobData;
        await sendHighMatchNotification(fcmToken, score, jobTitle, company, jobId);
        console.log(`High-match notification sent for job ${jobId}`);
      } else {
        const { fcmToken, company, applicationId } = job.data as FollowUpNotifyData;
        await sendFollowUpNotification(fcmToken, company, applicationId);
        console.log(`Follow-up notification sent for application ${applicationId}`);
      }
    },
    { connection: getRedisOptions() }
  );

  worker.on('failed', (job, err) => {
    console.error(`Notify job ${job?.id} failed:`, err);
  });

  return worker;
}
