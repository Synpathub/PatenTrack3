/**
 * broken-title.worker.ts — Step 5: Broken Title Chain Detection
 *
 * THIS IS THE CORE BUSINESS LOGIC OF PATENTRACK.
 * Analyzes the assignment chain for each patent to determine if
 * the title is complete, broken, or encumbered.
 *
 * Business Rules: BR-032 → BR-036
 */

import { Worker, type Job } from 'bullmq';
import { analyzeChain, type ChainTransaction } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { dashboardQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface BrokenTitleJobData {
  organizationId: string;
}

const log = workerLogger('broken-title');

async function processBrokenTitle(job: Job<BrokenTitleJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting broken title analysis');

  // TODO: Query all patents for this organization
  // TODO: For each patent, build ChainTransaction[] from assignments
  //   const transactions: ChainTransaction[] = assignments.map(a => ({
  //     rfId: a.rfId,
  //     assignorNames: a.assignorNames,
  //     assigneeNames: a.assigneeNames,
  //     conveyanceType: a.conveyanceType,
  //     employerAssign: a.employerAssign,
  //     recordDate: a.recordDate,
  //   }));
  // TODO: Apply analyzeChain(transactions)
  // TODO: Write chain analysis result (status, dashboardType, breaks) to DB
  // TODO: Record progress in pipeline_runs

  await dashboardQueue.add('dashboard', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Broken title analysis complete');
}

const brokenTitleWorker = new Worker<BrokenTitleJobData>(
  'patentrack:broken-title',
  processBrokenTitle,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

brokenTitleWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Broken title job failed');
});

export default brokenTitleWorker;
