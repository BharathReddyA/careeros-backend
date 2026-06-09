import axios from 'axios';
import { Job } from '../models/Job';

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_description: string;
  job_apply_link: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_employment_type?: string;
  job_posted_at_datetime_utc?: string;
}

interface JSearchResponse {
  data: JSearchJob[];
}

export async function fetchJSearchJobs(
  query: string,
  location: string,
  page = 1
): Promise<typeof Job.prototype[]> {
  const apiKey = process.env.JSEARCH_RAPIDAPI_KEY;
  if (!apiKey) throw new Error('JSEARCH_RAPIDAPI_KEY not set');

  const { data } = await axios.get<JSearchResponse>(
    'https://jsearch.p.rapidapi.com/search',
    {
      params: { query: `${query} in ${location}`, page, num_pages: 1 },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
    }
  );

  const upsertOps = data.data.map((job) => {
    const loc = [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ');
    return {
      updateOne: {
        filter: { externalId: `jsearch_${job.job_id}` },
        update: {
          $setOnInsert: {
            externalId: `jsearch_${job.job_id}`,
            source: 'jsearch' as const,
            title: job.job_title,
            company: job.employer_name,
            location: loc,
            description: job.job_description,
            applyUrl: job.job_apply_link,
            salary: {
              min: job.job_min_salary ?? 0,
              max: job.job_max_salary ?? 0,
              currency: job.job_salary_currency ?? 'USD',
            },
            jobType: job.job_employment_type ?? 'full-time',
            postedAt: job.job_posted_at_datetime_utc
              ? new Date(job.job_posted_at_datetime_utc)
              : new Date(),
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
        upsert: true,
      },
    };
  });

  if (upsertOps.length > 0) await Job.bulkWrite(upsertOps);

  const externalIds = data.data.map((j) => `jsearch_${j.job_id}`);
  return Job.find({ externalId: { $in: externalIds } });
}
