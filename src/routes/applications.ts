import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { Application, ApplicationStatus } from '../models/Application';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import { scoreJobMatch } from '../services/geminiService';

const router = Router();

const CreateApplicationSchema = z.object({
  jobId: z.string(),
});

const UpdateApplicationSchema = z.object({
  status: z
    .enum(['saved', 'tailoring', 'ready', 'applied', 'interviewing', 'offer', 'rejected'])
    .optional(),
  notes: z.string().optional(),
  appliedAt: z.string().datetime().optional(),
  followUpAt: z.string().datetime().optional(),
});

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { status } = req.query;
  const filter: Record<string, unknown> = { userId: req.userId };
  if (status) filter.status = status;

  const applications = await Application.find(filter)
    .populate('jobId')
    .sort({ createdAt: -1 });

  res.json({ applications });
});

router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = CreateApplicationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { jobId } = parsed.data;

  const resume = await Resume.findOne({ userId: req.userId, isActive: true });
  if (!resume) {
    res.status(404).json({ error: 'No active resume found' });
    return;
  }

  const job = await Job.findById(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const existing = await Application.findOne({ userId: req.userId, jobId });
  if (existing) {
    res.status(409).json({ error: 'Already saved this job', application: existing });
    return;
  }

  // Score the match
  const match = await scoreJobMatch(resume.parsedProfile, job.title, job.company, job.description);

  const application = await Application.create({
    userId: req.userId,
    jobId,
    resumeId: resume._id,
    status: 'saved',
    matchScore: match.score,
    matchReasons: match.matchReasons,
  });

  res.status(201).json({ application });
});

router.patch('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = UpdateApplicationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const update: Partial<{
    status: ApplicationStatus;
    notes: string;
    appliedAt: Date;
    followUpAt: Date;
  }> = {};

  if (parsed.data.status) update.status = parsed.data.status;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
  if (parsed.data.appliedAt) update.appliedAt = new Date(parsed.data.appliedAt);
  if (parsed.data.followUpAt) update.followUpAt = new Date(parsed.data.followUpAt);

  const application = await Application.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    update,
    { new: true }
  ).populate('jobId');

  if (!application) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  res.json({ application });
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const application = await Application.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!application) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  res.json({ message: 'Application deleted' });
});

export default router;
