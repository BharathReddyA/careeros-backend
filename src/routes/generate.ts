import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { Application } from '../models/Application';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import { User } from '../models/User';
import { tailorResume, generateCoverLetter } from '../services/geminiService';

const router = Router();

const PRO_TAILORING_LIMIT = 5;

async function checkProAccess(userId: string): Promise<boolean> {
  const user = await User.findById(userId);
  return user?.isPro ?? false;
}

async function getTailoringCount(userId: string): Promise<number> {
  return Application.countDocuments({
    userId,
    tailoredResumeText: { $ne: '' },
  });
}

const TailorSchema = z.object({
  jobId: z.string(),
  resumeId: z.string(),
});

const CoverLetterSchema = z.object({
  applicationId: z.string(),
});

router.post('/tailor', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = TailorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { jobId, resumeId } = parsed.data;
  const userId = req.userId!;

  // Freemium gate
  const isPro = await checkProAccess(userId);
  if (!isPro) {
    const count = await getTailoringCount(userId);
    if (count >= PRO_TAILORING_LIMIT) {
      res.status(402).json({
        error: 'Free tailoring limit reached. Upgrade to CareerOS Pro for unlimited tailoring.',
        requiresPro: true,
      });
      return;
    }
  }

  const [resume, job] = await Promise.all([
    Resume.findOne({ _id: resumeId, userId }),
    Job.findById(jobId),
  ]);

  if (!resume) {
    res.status(404).json({ error: 'Resume not found' });
    return;
  }
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Get or create application
  let application = await Application.findOne({ userId, jobId });
  if (!application) {
    application = await Application.create({
      userId,
      jobId,
      resumeId,
      status: 'tailoring',
    });
  } else {
    application.status = 'tailoring';
    await application.save();
  }

  const tailoredText = await tailorResume(resume.rawText, job.description);

  application.tailoredResumeText = tailoredText;
  application.status = 'ready';
  await application.save();

  res.json({
    applicationId: application._id,
    originalResume: resume.rawText,
    tailoredResume: tailoredText,
  });
});

router.post('/coverletter', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = CoverLetterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = req.userId!;

  // Pro-only feature
  const isPro = await checkProAccess(userId);
  if (!isPro) {
    res.status(402).json({
      error: 'Cover letter generation requires CareerOS Pro.',
      requiresPro: true,
    });
    return;
  }

  const application = await Application.findOne({
    _id: parsed.data.applicationId,
    userId,
  }).populate<{ jobId: InstanceType<typeof Job> }>('jobId');

  if (!application) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  const resume = await Resume.findOne({ userId, isActive: true });
  if (!resume) {
    res.status(404).json({ error: 'No active resume found' });
    return;
  }

  const job = application.jobId as InstanceType<typeof Job>;
  const { name, summary, skills } = resume.parsedProfile;

  const coverLetter = await generateCoverLetter(
    name,
    summary,
    skills,
    job.title,
    job.company,
    job.description
  );

  application.coverLetter = coverLetter;
  await application.save();

  res.json({ applicationId: application._id, coverLetter });
});

export default router;
