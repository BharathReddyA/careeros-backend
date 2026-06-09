import { Router, Response } from 'express';
import { Queue } from 'bullmq';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { uploadResume, streamToCloudinary } from '../middleware/upload';
import { Resume } from '../models/Resume';
import { getRedisOptions } from '../lib/redis';
import { RESUME_QUEUE, ResumeJobData } from '../workers/resumeWorker';

const router = Router();

let resumeQueue: Queue<ResumeJobData> | null = null;
function getResumeQueue(): Queue<ResumeJobData> {
  if (!resumeQueue) resumeQueue = new Queue(RESUME_QUEUE, { connection: getRedisOptions() });
  return resumeQueue;
}

router.post(
  '/upload',
  authMiddleware,
  uploadResume.single('resume'),
  streamToCloudinary,
  async (req: AuthRequest, res: Response) => {
    const file = req.file as Express.Multer.File & { path: string; pdfBuffer?: Buffer };
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const resume = await Resume.create({
      userId: req.userId,
      cloudinaryUrl: file.path,
      isActive: false,
    });

    await getResumeQueue().add('parse', {
      resumeId: String(resume._id),
      cloudinaryUrl: file.path,
      pdfBufferBase64: file.pdfBuffer?.toString('base64'),
    });

    res.status(202).json({
      message: 'Resume uploaded and queued for parsing',
      resumeId: resume._id,
    });
  }
);

router.get('/active', authMiddleware, async (req: AuthRequest, res: Response) => {
  const resume = await Resume.findOne({ userId: req.userId, isActive: true });
  if (!resume) {
    res.status(404).json({ error: 'No active resume found' });
    return;
  }
  res.json({ resume });
});

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const resumes = await Resume.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json({ resumes });
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const resume = await Resume.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!resume) {
    res.status(404).json({ error: 'Resume not found' });
    return;
  }
  res.json({ message: 'Resume deleted' });
});

export default router;
