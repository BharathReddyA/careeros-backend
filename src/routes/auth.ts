import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models/User';
import { authMiddleware, AuthRequest } from '../middleware/auth';

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

export default router;
