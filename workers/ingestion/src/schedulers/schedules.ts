/**
 * schedules.ts — Cron-style recurring job schedules
 *
 * Uses BullMQ's built-in repeatable jobs to schedule periodic tasks.
 */

import { assignmentsQueue, classifyQueue } from '../queues';
import { workerLogger } from '../utils/logger';

const log = workerLogger('scheduler');

/**
 * Register all recurring schedules.
 * Call this once at startup from index.ts.
 */
export async function registerSchedules() {
  log.info('Registering recurring job schedules');

  // TODO: Query all active organizations from the database and schedule
  //   ingestion for each. For now we set up the repeatable job templates.

  // ── Daily USPTO assignment ingestion (2 AM UTC) ────────────────────────
  await assignmentsQueue.upsertJobScheduler(
    'daily-assignments-ingestion',
    { pattern: '0 2 * * *' },
    {
      name: 'assignments',
      data: { organizationId: '*' }, // wildcard — handler resolves all orgs
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    },
  );

  // ── Weekly full re-classification (Sunday 4 AM UTC) ────────────────────
  await classifyQueue.upsertJobScheduler(
    'weekly-reclassify',
    { pattern: '0 4 * * 0' },
    {
      name: 'classify',
      data: { organizationId: '*' },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    },
  );

  log.info('All recurring schedules registered');
}
