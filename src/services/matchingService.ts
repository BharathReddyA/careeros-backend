import { IParsedProfile } from '../models/Resume';
import { IJob } from '../models/Job';
import { scoreJobMatch, MatchResult } from './geminiService';

export async function matchJobToProfile(
  job: IJob,
  profile: IParsedProfile
): Promise<MatchResult> {
  return scoreJobMatch(profile, job.title, job.company, job.description);
}

export async function batchMatchJobs(
  jobs: IJob[],
  profile: IParsedProfile,
  concurrency = 5
): Promise<Array<{ job: IJob; match: MatchResult }>> {
  const results: Array<{ job: IJob; match: MatchResult }> = [];

  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (job) => {
        const match = await matchJobToProfile(job, profile);
        return { job, match };
      })
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled') results.push(result.value);
    }
  }

  return results.sort((a, b) => b.match.score - a.match.score);
}
