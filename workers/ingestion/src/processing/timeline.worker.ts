/**
 * timeline.worker.ts — Step 4: Timeline Generation
 *
 * Generates a chronological timeline of ownership events for each patent.
 *
 * Business Rules: BR-024 → BR-031 (timeline is derived from tree data)
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { brokenTitleQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface TimelineJobData {
  organizationId: string;
}

const log = workerLogger('timeline');

async function processTimeline(job: Job<TimelineJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting timeline generation');

  // TODO: Query tree data / assignments ordered by record_date
  // TODO: Build timeline entries with ownership transitions
  // TODO: Persist timeline to appropriate table
  // TODO: Record progress in pipeline_runs

  await brokenTitleQueue.add('broken-title', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Timeline generation complete');
}

const timelineWorker = new Worker<TimelineJobData>(
  'patentrack:timeline',
  processTimeline,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

timelineWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Timeline job failed');
});

export default timelineWorker;
