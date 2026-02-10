/**
 * classify.worker.ts — Step 1: Transaction Type Classification
 *
 * Reads unclassified assignments, applies classifyConveyance() from
 * business-rules, writes results, then enqueues the flag step.
 *
 * Business Rules: BR-001 → BR-012
 */

import { Worker, type Job } from 'bullmq';
import { classifyConveyance } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { flagQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface ClassifyJobData {
  organizationId: string;
}

const log = workerLogger('classify');

async function processClassify(job: Job<ClassifyJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting classification');

  // TODO: Query unclassified assignments for this org's patents
  // const assignments = await db.select()...

  // TODO: Apply classifyConveyance() to each record
  // const results = assignments.map(a => ({
  //   rfId: a.rfId,
  //   ...classifyConveyance(a.conveyanceText),
  // }));

  // TODO: Write classification results to org_assignments table
  // await db.update(...)

  // TODO: Record progress in pipeline_runs table
  // await db.insert(pipelineRuns).values({ ... })

  // Enqueue next pipeline step
  await flagQueue.add('flag', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Classification complete');
}

const classifyWorker = new Worker<ClassifyJobData>(
  'patentrack:classify',
  processClassify,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

classifyWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Classification job failed');
});

export default classifyWorker;
