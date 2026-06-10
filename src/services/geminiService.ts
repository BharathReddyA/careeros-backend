import { GoogleGenerativeAI } from '@google/generative-ai';
import { IParsedProfile } from '../models/Resume';

export type UsageCallback = (tokens: number) => void | Promise<void>;

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

async function reportUsage(tokens: number | undefined, onUsage?: UsageCallback): Promise<void> {
  if (!onUsage || !tokens) return;
  try {
    await onUsage(tokens);
  } catch {
    // token tracking must never break the main flow
  }
}

async function generateJSON<T>(prompt: string, onUsage?: UsageCallback): Promise<T> {
  const model = getModel();
  const result = await model.generateContent(prompt);
  await reportUsage(result.response.usageMetadata?.totalTokenCount, onUsage);
  const text = result.response.text().trim();
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned) as T;
}

export async function parseResume(resumeText: string, onUsage?: UsageCallback): Promise<IParsedProfile> {
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

  return generateJSON<IParsedProfile>(prompt, onUsage);
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
  jobDescription: string,
  onUsage?: UsageCallback
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

  return generateJSON<MatchResult>(prompt, onUsage);
}

export async function batchScoreJobs(
  candidateProfile: IParsedProfile,
  jobs: Array<{ id: string; title: string; company: string; description: string }>,
  onUsage?: UsageCallback
): Promise<Map<string, MatchResult>> {
  const jobList = jobs
    .map((j, i) => `JOB_${i}: {"id":"${j.id}","title":"${j.title}","company":"${j.company}","description":${JSON.stringify(j.description.slice(0, 300))}}`)
    .join('\n');

  const prompt = `You are a job-candidate matching expert. Score how well this candidate matches each job below.

CANDIDATE:
Skills: ${candidateProfile.skills?.join(', ')}
Titles: ${candidateProfile.titles?.join(', ')}
Experience: ${candidateProfile.experienceYears} years
Industries: ${candidateProfile.industries?.join(', ')}

JOBS:
${jobList}

Return ONLY a valid JSON array — one entry per job in the same order:
[{"id":"job_id","score":75,"matchReasons":["reason"],"missingSkills":["skill"],"strongMatches":["match"]},...]`;

  const results = await generateJSON<Array<{ id: string } & MatchResult>>(prompt, onUsage);
  const map = new Map<string, MatchResult>();
  for (const r of results) {
    map.set(r.id, { score: r.score, matchReasons: r.matchReasons, missingSkills: r.missingSkills, strongMatches: r.strongMatches });
  }
  return map;
}

export async function tailorResume(resumeText: string, jobDescription: string, onUsage?: UsageCallback): Promise<string> {
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
  await reportUsage(result.response.usageMetadata?.totalTokenCount, onUsage);
  return result.response.text().trim();
}

export async function generateCoverLetter(
  candidateName: string,
  candidateSummary: string,
  skills: string[],
  jobTitle: string,
  company: string,
  jobDescription: string,
  onUsage?: UsageCallback
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
  await reportUsage(result.response.usageMetadata?.totalTokenCount, onUsage);
  return result.response.text().trim();
}
