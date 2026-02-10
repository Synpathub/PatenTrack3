import 'dotenv/config';
import IORedis from 'ioredis';
import { db } from '@patentrack/db';

// ── Redis ────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error(
    'REDIS_URL environment variable is required. ' +
      'Set it to a Redis connection string, e.g. redis://localhost:6379',
  );
}

export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  console.error('[redis] connection error', err);
});

// ── Database ─────────────────────────────────────────────────────────────────

// Re-export the Drizzle client configured in @patentrack/db.
// DATABASE_URL is validated inside that package.
export { db };

// ── Worker settings ──────────────────────────────────────────────────────────

export const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 3;
export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
