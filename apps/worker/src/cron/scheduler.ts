import { ingestionQueue } from '../queues/index.js';

/**
 * Register all cron jobs.
 * See docs/design/05-ingestion-pipeline.md Section 2 for schedules.
 */
export async function registerCronJobs() {
  // Daily assignment ingestion (BR-054) — 02:00 UTC
  await ingestionQueue.add('ingest:assignments', {}, {
    repeat: { pattern: '0 2 * * *' },
    jobId: 'cron:assignments',
  });

  // Weekly bibliographic (BR-055) — Tuesday 04:00 UTC
  await ingestionQueue.add('ingest:bibliographic', {}, {
    repeat: { pattern: '0 4 * * 2' },
    jobId: 'cron:bibliographic',
  });

  // Daily EPO family (BR-057) — 06:00 UTC
  await ingestionQueue.add('ingest:epo-family', {}, {
    repeat: { pattern: '0 6 * * *' },
    jobId: 'cron:epo-family',
  });

  // Monthly CPC (BR-056) — 1st of month 03:00 UTC
  await ingestionQueue.add('ingest:cpc', {}, {
    repeat: { pattern: '0 3 1 * *' },
    jobId: 'cron:cpc',
  });

  // Weekly maintenance fees (BR-058) — Thursday 05:00 UTC
  await ingestionQueue.add('ingest:maintenance', {}, {
    repeat: { pattern: '0 5 * * 4' },
    jobId: 'cron:maintenance',
  });
}
