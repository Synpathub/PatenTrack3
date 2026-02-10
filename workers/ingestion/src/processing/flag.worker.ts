/**
 * flag.worker.ts — Step 2: Employer / Entity Flag Detection
 *
 * Detects employer assignments using inventor-to-assignor matching
 * and flags entity types using suffix detection.
 *
 * Business Rules: BR-017, BR-021 → BR-023
 */

import { Worker, type Job } from 'bullmq';
import { matchInventorsToAssignment, normalizeName } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { treeQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface FlagJobData {
  organizationId: string;
}

const log = workerLogger('flag');

async function processFlag(job: Job<FlagJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting flag detection');

  // TODO: Query assignments + related inventors for this org
  // const assignments = await db.select()...

  // TODO: For each assignment, run matchInventorsToAssignment()
  //   to detect employer assignments
  // TODO: Normalize entity names with normalizeName()
  // TODO: Update employer_assign flag in org_assignments
  // TODO: Record progress in pipeline_runs

  await treeQueue.add('tree', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Flag detection complete');
}

const flagWorker = new Worker<FlagJobData>(
  'patentrack:flag',
  processFlag,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

flagWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Flag job failed');
});

export default flagWorker;
