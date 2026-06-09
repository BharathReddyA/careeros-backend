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

export async function fetchAdzunaJobs(
  skills: string[],
  titles: string[],
  locations: string[],
  page = 1,
  resultsPerPage = 20
): Promise<typeof Job.prototype[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('Adzuna API credentials not set');

  const keywords = [...titles.slice(0, 2), ...skills.slice(0, 3)].join(' ');
  const country = 'us';

  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`;
  const params: Record<string, unknown> = {
    app_id: appId,
    app_key: appKey,
    what: keywords,
    results_per_page: resultsPerPage,
    sort_by: 'date',
  };

  // Only add 'where' if user specified an actual city/region (not empty, not a country code)
  const city = locations[0];
  if (city && city.length > 2) params.where = city;

  const { data } = await axios.get<AdzunaResponse>(url, { params });

  const upsertOps = data.results.map((job) => ({
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

  if (upsertOps.length > 0) await Job.bulkWrite(upsertOps);

  const externalIds = data.results.map((j) => `adzuna_${j.id}`);
  return Job.find({ externalId: { $in: externalIds } });
}
