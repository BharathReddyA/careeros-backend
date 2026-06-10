import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { uploadAudio, streamAudioToCloudinary } from '../middleware/upload';
import { cloudinary } from '../lib/cloudinary';
import { CoachingSession } from '../models/CoachingSession';
import { Resume } from '../models/Resume';
import { Job } from '../models/Job';
import {
  generateInterviewQuestions,
  gradeInterviewAnswer,
  generateOverallInterviewFeedback,
} from '../services/geminiService';
import { textToSpeech, speechToText } from '../services/elevenLabsService';
import { trackTokenUsage } from '../lib/tokenUsage';

const router = Router();

const StartSessionSchema = z.object({
  jobId: z.string().optional(),
});

const SubmitAnswerSchema = z.object({
  questionIndex: z.coerce.number().int().min(0),
});

function uploadBufferToCloudinary(buffer: Buffer, folder: string, format: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'video', type: 'upload', access_mode: 'public', format },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary upload failed'));
          return;
        }
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
}

router.get('/sessions', authMiddleware, async (req: AuthRequest, res: Response) => {
  const sessions = await CoachingSession.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json({
    sessions: sessions.map((s) => ({
      _id: s._id,
      roleTitle: s.roleTitle,
      status: s.status,
      overallScore: s.overallScore,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      questionCount: s.questions.length,
    })),
  });
});

router.post('/sessions', authMiddleware, async (req: AuthRequest, res: Response) => {
  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = req.userId!;
  const resume = await Resume.findOne({ userId, isActive: true });
  if (!resume) {
    res.status(404).json({ error: 'Upload a resume first' });
    return;
  }

  let roleTitle = resume.parsedProfile.titles?.[0] ?? 'General';
  let jobDescription: string | undefined;
  let jobId: string | null = null;

  if (parsed.data.jobId) {
    const job = await Job.findById(parsed.data.jobId);
    if (job) {
      roleTitle = job.title;
      jobDescription = job.description;
      jobId = String(job._id);
    }
  }

  const questions = await generateInterviewQuestions(resume.parsedProfile, roleTitle, jobDescription, trackTokenUsage(userId));

  const session = await CoachingSession.create({
    userId,
    jobId,
    roleTitle,
    questions: questions.map((q) => ({
      text: q.text,
      category: q.category,
      audioUrl: '',
      answerAudioUrl: '',
      transcript: '',
      feedback: '',
      strengths: [],
      improvements: [],
      score: 0,
      answeredAt: null,
    })),
    currentQuestionIndex: 0,
    status: 'in_progress',
  });

  res.status(201).json({ session });
});

router.get('/sessions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const session = await CoachingSession.findOne({ _id: req.params.id, userId: req.userId });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session });
});

router.get('/sessions/:id/questions/:qIdx/audio', authMiddleware, async (req: AuthRequest, res: Response) => {
  const qIdx = Number(req.params.qIdx);
  const session = await CoachingSession.findOne({ _id: req.params.id, userId: req.userId });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!Number.isInteger(qIdx) || qIdx < 0 || qIdx >= session.questions.length) {
    res.status(400).json({ error: 'Invalid question index' });
    return;
  }

  const question = session.questions[qIdx];
  if (question.audioUrl) {
    res.json({ audioUrl: question.audioUrl });
    return;
  }

  const audioBuffer = await textToSpeech(question.text);
  const audioUrl = await uploadBufferToCloudinary(audioBuffer, 'careeros/coaching-audio', 'mp3');

  question.audioUrl = audioUrl;
  await session.save();

  res.json({ audioUrl });
});

router.post(
  '/sessions/:id/answers',
  authMiddleware,
  uploadAudio.single('audio'),
  streamAudioToCloudinary,
  async (req: AuthRequest, res: Response) => {
    const parsed = SubmitAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const file = req.file as (Express.Multer.File & { path: string }) | undefined;
    if (!file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    const userId = req.userId!;
    const { questionIndex: qIdx } = parsed.data;

    const session = await CoachingSession.findOne({ _id: req.params.id, userId });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (qIdx >= session.questions.length || qIdx !== session.currentQuestionIndex) {
      res.status(400).json({ error: 'Invalid or out-of-order question index' });
      return;
    }

    const resume = await Resume.findOne({ userId, isActive: true });
    if (!resume) {
      res.status(404).json({ error: 'No active resume found' });
      return;
    }

    const question = session.questions[qIdx];
    const transcript = await speechToText(file.buffer, 'answer.m4a', file.mimetype);
    const result = await gradeInterviewAnswer(question.text, transcript, resume.parsedProfile, trackTokenUsage(userId));

    question.answerAudioUrl = file.path;
    question.transcript = transcript;
    question.feedback = result.feedback;
    question.strengths = result.strengths;
    question.improvements = result.improvements;
    question.score = result.score;
    question.answeredAt = new Date();

    if (qIdx === session.questions.length - 1) {
      session.status = 'completed';
      session.completedAt = new Date();
      session.overallScore = Math.round(
        session.questions.reduce((sum, q) => sum + q.score, 0) / session.questions.length
      );
      session.overallFeedback = await generateOverallInterviewFeedback(
        session.questions.map((q) => ({ text: q.text, transcript: q.transcript, score: q.score, feedback: q.feedback })),
        session.roleTitle,
        trackTokenUsage(userId)
      );
    } else {
      session.currentQuestionIndex = qIdx + 1;
    }

    await session.save();

    res.json({
      question: {
        text: question.text,
        transcript: question.transcript,
        feedback: question.feedback,
        strengths: question.strengths,
        improvements: question.improvements,
        score: question.score,
      },
      session: {
        status: session.status,
        currentQuestionIndex: session.currentQuestionIndex,
        overallScore: session.overallScore,
        overallFeedback: session.overallFeedback,
      },
    });
  }
);

router.delete('/sessions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const result = await CoachingSession.deleteOne({ _id: req.params.id, userId: req.userId });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ message: 'Session deleted' });
});

export default router;
