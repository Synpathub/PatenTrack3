/**
 * summary.worker.ts — Step 7: Organization Summary
 *
 * Builds the final summary view for the organization, including
 * entity grouping and canonical name resolution.
 *
 * Business Rules: BR-013 → BR-020
 */

import { Worker, type Job } from 'bullmq';
import { groupEntities, normalizeName } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { generateJsonQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface SummaryJobData {
  organizationId: string;
}

const log = workerLogger('summary');

async function processSummary(job: Job<SummaryJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting summary generation');

  // TODO: Query all entity names (assignors/assignees) for this org
  // TODO: Normalize names with normalizeName()
  // TODO: Group entities with groupEntities()
  // TODO: Write canonical entity mappings to DB
  // TODO: Compute final org-level statistics
  // TODO: Record progress in pipeline_runs

  await generateJsonQueue.add('generate-json', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Summary generation complete');
}

const summaryWorker = new Worker<SummaryJobData>(
  'patentrack:summary',
  processSummary,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

summaryWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Summary job failed');
});

export default summaryWorker;
