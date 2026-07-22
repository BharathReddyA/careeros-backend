import { Router, Response } from 'express';
import { Queue } from 'bullmq';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { Resume } from '../models/Resume';
import { Application } from '../models/Application';
import { Job } from '../models/Job';
import { JobView } from '../models/JobView';
import { getRedisOptions } from '../lib/redis';
import { JOB_REFRESH_QUEUE, JobRefreshData } from '../workers/jobRefreshWorker';

const router = Router();

let refreshQueue: Queue<JobRefreshData> | null = null;
function getRefreshQueue(): Queue<JobRefreshData> {
  if (!refreshQueue) refreshQueue = new Queue(JOB_REFRESH_QUEUE, { connection: getRedisOptions() });
  return refreshQueue;
}

// General listing — no resume required, used before a user has uploaded one.
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const jobs = await Job.find({}).sort({ postedAt: -1 }).limit(50);
  res.json({ jobs });
});

router.get('/feed', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { resumeId } = req.query;
  const resume = resumeId
    ? await Resume.findOne({ _id: resumeId as string, userId: req.userId })
    : await Resume.findOne({ userId: req.userId, isActive: true });
  if (!resume) {
    res.status(404).json({ error: 'No active resume. Upload a resume first.' });
    return;
  }

  // Return applications linked to the current active resume only
  const applications = await Application.find({ userId: req.userId, resumeId: resume._id })
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

router.get('/viewed', authMiddleware, async (req: AuthRequest, res: Response) => {
  const views = await JobView.find({ userId: req.userId }).sort({ viewedAt: -1 }).limit(50).populate('jobId');
  const jobs = views.filter((v) => v.jobId).map((v) => v.jobId);
  res.json({ jobs });
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

  await JobView.findOneAndUpdate(
    { userId: req.userId, jobId: job._id },
    { viewedAt: new Date() },
    { upsert: true }
  );

  res.json({ job, application });
});

router.post('/refresh', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { resumeId } = req.body ?? {};
  await getRefreshQueue().add('refresh', { userId: req.userId!, resumeId });
  res.json({ message: 'Job refresh queued' });
});

export default router;
