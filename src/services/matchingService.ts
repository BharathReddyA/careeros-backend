import { IParsedProfile } from '../models/Resume';
import { IJob } from '../models/Job';
import { batchScoreJobs, MatchResult } from './geminiService';

export async function batchMatchJobs(
  jobs: IJob[],
  profile: IParsedProfile,
  chunkSize = 15
): Promise<Array<{ job: IJob; match: MatchResult }>> {
  const results: Array<{ job: IJob; match: MatchResult }> = [];

  // Send jobs to Gemini in chunks of 15 to avoid prompt size limits
  for (let i = 0; i < jobs.length; i += chunkSize) {
    const chunk = jobs.slice(i, i + chunkSize);
    try {
      const scoreMap = await batchScoreJobs(
        profile,
        chunk.map((j) => ({
          id: String(j._id),
          title: j.title,
          company: j.company,
          description: j.description,
        }))
      );
      for (const job of chunk) {
        const match = scoreMap.get(String(job._id));
        if (match) results.push({ job, match });
      }
    } catch (err) {
      console.error('Batch match chunk failed:', (err as Error).message);
    }
  }

  return results.sort((a, b) => b.match.score - a.match.score);
}
