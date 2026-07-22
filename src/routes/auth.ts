import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User';
import { Resume } from '../models/Resume';
import { Application } from '../models/Application';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { uploadImage, streamImageToCloudinary } from '../middleware/upload';
import { sendOtp, checkOtp } from '../lib/twilio';

const router = Router();

// Brute-force protection: credential-guessing endpoints only.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// OTP endpoints hit Twilio (billed per SMS) — tighter limit.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

const PhoneSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format, e.g. +14155552671'),
});

const RegisterSchema = PhoneSchema.extend({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  otp: z.string().min(4),
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

const VerifyPhoneSchema = PhoneSchema.extend({
  otp: z.string().min(4),
});

const ForgotPasswordResetSchema = PhoneSchema.extend({
  otp: z.string().min(4),
  newPassword: z.string().min(8),
});

function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign({ userId }, secret, { expiresIn: '30d' });
}

router.post('/register/send-otp', otpLimiter, async (req: Request, res: Response) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existingPhone = await User.findOne({ phone: parsed.data.phone, phoneVerified: true });
  if (existingPhone) {
    res.status(409).json({ error: 'Phone number already registered' });
    return;
  }

  await sendOtp(parsed.data.phone);
  res.json({ message: 'OTP sent' });
});

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password, name, phone, otp } = parsed.data;

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const existingPhone = await User.findOne({ phone, phoneVerified: true });
  if (existingPhone) {
    res.status(409).json({ error: 'Phone number already registered' });
    return;
  }

  const approved = await checkOtp(phone, otp);
  if (!approved) {
    res.status(400).json({ error: 'Incorrect or expired code' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, name, phone, phoneVerified: true });
  const token = signToken(String(user._id));

  res.status(201).json({
    token,
    user: { id: user._id, email: user.email, name: user.name, isPro: user.isPro },
  });
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
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

router.post('/reset-password', authLimiter, authMiddleware, async (req: AuthRequest, res: Response) => {
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

// ── Recovery phone: add + verify while logged in ──────────────────────────

router.post('/phone/send-otp', otpLimiter, authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = await User.findOne({ phone: parsed.data.phone, phoneVerified: true, _id: { $ne: req.userId } });
  if (existing) {
    res.status(409).json({ error: 'Phone number already registered to another account' });
    return;
  }

  await sendOtp(parsed.data.phone);
  res.json({ message: 'OTP sent' });
});

router.post('/phone/verify', otpLimiter, authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = VerifyPhoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const approved = await checkOtp(parsed.data.phone, parsed.data.otp);
  if (!approved) {
    res.status(400).json({ error: 'Incorrect or expired code' });
    return;
  }

  const user = await User.findByIdAndUpdate(
    req.userId,
    { phone: parsed.data.phone, phoneVerified: true },
    { new: true }
  ).select('-passwordHash');

  res.json({ user });
});

// ── Forgot password via SMS OTP (no auth — user is locked out) ────────────

router.post('/forgot-password/send-otp', otpLimiter, async (req: Request, res: Response) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = await User.findOne({ phone: parsed.data.phone, phoneVerified: true });
  // Always respond the same way, verified phone or not, to avoid leaking which numbers are registered.
  if (user) {
    await sendOtp(parsed.data.phone);
  }
  res.json({ message: 'If that phone number is registered, a code has been sent.' });
});

router.post('/forgot-password/reset', otpLimiter, async (req: Request, res: Response) => {
  const parsed = ForgotPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = await User.findOne({ phone: parsed.data.phone, phoneVerified: true });
  if (!user) {
    res.status(400).json({ error: 'Incorrect or expired code' });
    return;
  }

  const approved = await checkOtp(parsed.data.phone, parsed.data.otp);
  if (!approved) {
    res.status(400).json({ error: 'Incorrect or expired code' });
    return;
  }

  user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
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
