import { Router, Response } from 'express';
import { Queue } from 'bullmq';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { Resume } from '../models/Resume';
import { Application } from '../models/Application';
import { Job } from '../models/Job';
import { getRedisOptions } from '../lib/redis';
import { JOB_REFRESH_QUEUE, JobRefreshData } from '../workers/jobRefreshWorker';

const router = Router();

let refreshQueue: Queue<JobRefreshData> | null = null;
function getRefreshQueue(): Queue<JobRefreshData> {
  if (!refreshQueue) refreshQueue = new Queue(JOB_REFRESH_QUEUE, { connection: getRedisOptions() });
  return refreshQueue;
}

router.get('/feed', authMiddleware, async (req: AuthRequest, res: Response) => {
  const resume = await Resume.findOne({ userId: req.userId, isActive: true });
  if (!resume) {
    res.status(404).json({ error: 'No active resume. Upload a resume first.' });
    return;
  }

  // Return existing matched applications with job data
  const applications = await Application.find({ userId: req.userId })
    .populate('jobId')
    .sort({ matchScore: -1 })
    .limit(50);

  const feed = applications.map((app) => ({
    applicationId: app._id,
    job: app.jobId,
    matchScore: app.matchScore,
    matchReasons: app.matchReasons,
    status: app.status,
  }));

  res.json({ feed, resumeId: resume._id });
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const job = await Job.findById(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Include user's application if exists
  const application = await Application.findOne({
    userId: req.userId,
    jobId: job._id,
  });

  res.json({ job, application });
});

router.post('/refresh', authMiddleware, async (req: AuthRequest, res: Response) => {
  await getRefreshQueue().add(
    'refresh',
    { userId: req.userId! },
    { jobId: `refresh_${req.userId}` }
  );
  res.json({ message: 'Job refresh queued' });
});

export default router;
