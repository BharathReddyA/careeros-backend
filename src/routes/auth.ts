import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models/User';
import { Resume } from '../models/Resume';
import { Application } from '../models/Application';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { uploadImage, streamImageToCloudinary } from '../middleware/upload';

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const ResetPasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

const DeleteAccountSchema = z.object({
  password: z.string(),
});

function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign({ userId }, secret, { expiresIn: '30d' });
}

router.post('/register', async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, name } = parsed.data;

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, name });
  const token = signToken(String(user._id));

  res.status(201).json({
    token,
    user: { id: user._id, email: user.email, name: user.name, isPro: user.isPro },
  });
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken(String(user._id));
  res.json({
    token,
    user: { id: user._id, email: user.email, name: user.name, isPro: user.isPro },
  });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.userId).select('-passwordHash');
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
});

router.patch('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name, fcmToken, preferences } = req.body;
  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (fcmToken !== undefined) update.fcmToken = fcmToken;
  if (preferences) update.preferences = preferences;

  const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select(
    '-passwordHash'
  );
  res.json({ user });
});

router.post(
  '/photo',
  authMiddleware,
  uploadImage.single('photo'),
  streamImageToCloudinary,
  async (req: AuthRequest, res: Response) => {
    const file = req.file as (Express.Multer.File & { path: string }) | undefined;
    if (!file?.path) {
      res.status(400).json({ error: 'No photo uploaded' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePhotoUrl: file.path },
      { new: true }
    ).select('-passwordHash');

    res.json({ user });
  }
);

router.post('/reset-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = ResetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  res.json({ message: 'Password updated' });
});

router.delete('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Password is incorrect' });
    return;
  }

  await Resume.deleteMany({ userId: req.userId });
  await Application.deleteMany({ userId: req.userId });
  await User.findByIdAndDelete(req.userId);

  res.json({ message: 'Account deleted' });
});

router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const [resumesUploaded, jobsApplied, resumesTailored] = await Promise.all([
    Resume.countDocuments({ userId: req.userId }),
    Application.countDocuments({ userId: req.userId, status: { $ne: 'saved' } }),
    Application.countDocuments({ userId: req.userId, tailoredResumeText: { $ne: '' } }),
  ]);

  res.json({
    resumesUploaded,
    jobsApplied,
    resumesTailored,
    tokensUsed: user.tokensUsed,
  });
});

export default router;
