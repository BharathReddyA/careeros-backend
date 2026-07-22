import axios from 'axios';
import { Job } from '../models/Job';

interface AdzunaJob {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string };
  description: string;
  redirect_url: string;
  salary_min?: number;
  salary_max?: number;
  contract_time?: string;
  created: string;
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchAdzuna(
  appId: string,
  appKey: string,
  what: string,
  city: string | undefined,
  resultsPerPage: number
): Promise<AdzunaJob[]> {
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1`;
  const params: Record<string, unknown> = {
    app_id: appId,
    app_key: appKey,
    what,
    results_per_page: resultsPerPage,
    sort_by: 'date',
  };
  if (city && city.length > 2) params.where = city;

  // Adzuna intermittently 503s under light rate-limiting — a couple of short retries
  // clears most of these without meaningfully slowing down the refresh.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data } = await axios.get<AdzunaResponse>(url, { params });
      return data.results ?? [];
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      const retryable = status === undefined || status === 503 || status === 429;
      if (!retryable || attempt === maxAttempts) throw err;
      await sleep(400 * attempt);
    }
  }
  return [];
}

export async function fetchAdzunaJobs(
  skills: string[],
  titles: string[],
  locations: string[],
  resultsPerPage = 10
): Promise<typeof Job.prototype[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('Adzuna API credentials not set');

  const city = locations[0];

  // Run separate searches: one per title + one skills-based fallback
  const queries = [
    ...titles.slice(0, 3).map((t) => t),
    skills.slice(0, 3).join(' OR '),
  ].filter(Boolean);

  const allResults: AdzunaJob[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const results = await searchAdzuna(appId, appKey, q, city, resultsPerPage);
      for (const r of results) {
        if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); }
      }
    } catch (err) {
      console.warn(`Adzuna query "${q}" failed:`, (err as Error).message);
    }
  }

  if (allResults.length === 0) return [];

  const upsertOps = allResults.map((job) => ({
    updateOne: {
      filter: { externalId: `adzuna_${job.id}` },
      update: {
        $setOnInsert: {
          externalId: `adzuna_${job.id}`,
          source: 'adzuna' as const,
          title: job.title,
          company: job.company.display_name,
          location: job.location.display_name,
          description: job.description,
          applyUrl: job.redirect_url,
          salary: {
            min: job.salary_min ?? 0,
            max: job.salary_max ?? 0,
            currency: 'USD',
          },
          jobType: job.contract_time ?? 'full-time',
          postedAt: new Date(job.created),
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      upsert: true,
    },
  }));

  await Job.bulkWrite(upsertOps);

  const externalIds = allResults.map((j) => `adzuna_${j.id}`);
  return Job.find({ externalId: { $in: externalIds } });
}
