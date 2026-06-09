import type { RedisOptions } from 'bullmq';

export function getRedisOptions(): RedisOptions {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  // Parse redis[s]://[:password@]host[:port][/db]
  const parsed = new URL(url);
  const options: RedisOptions = {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    maxRetriesPerRequest: null,
  };
  if (parsed.password) options.password = parsed.password;
  if (parsed.pathname && parsed.pathname !== '/') {
    options.db = parseInt(parsed.pathname.slice(1), 10);
  }
  if (parsed.protocol === 'rediss:') options.tls = {};
  return options;
}
