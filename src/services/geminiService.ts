import { GoogleGenerativeAI } from '@google/generative-ai';
import { IParsedProfile } from '../models/Resume';

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set');
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

function getModel() {
  return getClient().getGenerativeModel({ model: 'gemini-2.5-flash' });
}

async function generateJSON<T>(prompt: string): Promise<T> {
  const model = getModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned) as T;
}

export async function parseResume(resumeText: string): Promise<IParsedProfile> {
  const prompt = `You are a resume parser. Extract structured data from this resume text and return ONLY a valid JSON object with no markdown, no preamble.

Resume text:
${resumeText}

Return this exact JSON structure:
{
  "name": "",
  "email": "",
  "phone": "",
  "summary": "",
  "skills": [],
  "titles": [],
  "experienceYears": 0,
  "industries": [],
  "education": [],
  "location": ""
}`;

  return generateJSON<IParsedProfile>(prompt);
}

export interface MatchResult {
  score: number;
  matchReasons: string[];
  missingSkills: string[];
  strongMatches: string[];
}

export async function scoreJobMatch(
  candidateProfile: IParsedProfile,
  jobTitle: string,
  company: string,
  jobDescription: string
): Promise<MatchResult> {
  const prompt = `You are a job-candidate matching expert. Score how well this candidate matches this job.

CANDIDATE PROFILE:
${JSON.stringify(candidateProfile, null, 2)}

JOB POSTING:
Title: ${jobTitle}
Company: ${company}
Description: ${jobDescription}

Return ONLY a valid JSON object:
{
  "score": 0,
  "matchReasons": ["reason 1", "reason 2"],
  "missingSkills": ["skill 1", "skill 2"],
  "strongMatches": ["match 1", "match 2"]
}`;

  return generateJSON<MatchResult>(prompt);
}

export async function tailorResume(resumeText: string, jobDescription: string): Promise<string> {
  const prompt = `You are an expert resume writer. Rewrite this resume to better match the job description below.
- Keep all facts truthful — only reframe and reorder
- Add relevant keywords from the job description naturally
- Strengthen bullet points with measurable impact where possible
- Do not invent experience or skills

ORIGINAL RESUME:
${resumeText}

TARGET JOB:
${jobDescription}

Return the full rewritten resume as plain text only.`;

  const model = getModel();
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

export async function generateCoverLetter(
  candidateName: string,
  candidateSummary: string,
  skills: string[],
  jobTitle: string,
  company: string,
  jobDescription: string
): Promise<string> {
  const prompt = `Write a professional cover letter for this candidate applying to this job.
- Paragraph 1: Strong hook connecting candidate's background to company mission
- Paragraph 2: 2-3 specific achievements that match the job requirements
- Paragraph 3: Enthusiastic close with clear call to action
- Tone: confident, specific, not generic
- Length: 3 paragraphs, max 250 words

CANDIDATE: ${candidateName}, ${candidateSummary}
SKILLS: ${skills.join(', ')}
JOB: ${jobTitle} at ${company}
JOB DESCRIPTION: ${jobDescription}

Return plain text only, no subject line, no date, no address block.`;

  const model = getModel();
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
