/**
 * dashboard.worker.ts — Step 6: Dashboard Aggregation
 *
 * Computes dashboard summary counts (complete, broken, encumbered, etc.)
 * for the organization after chain analysis is done.
 *
 * Business Rules: BR-037 → BR-038
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { summaryQueue } from '../queues';
import { workerLogger } from '../utils/logger';
import { DASHBOARD_TYPES, resolveActivityGroup } from '@patentrack/shared';

interface DashboardJobData {
  organizationId: string;
}

const log = workerLogger('dashboard');

async function processDashboard(job: Job<DashboardJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting dashboard aggregation');

  // TODO: Query chain analysis results for all org patents
  // TODO: Aggregate counts by dashboardType (COMPLETE, BROKEN, ENCUMBERED, etc.)
  // TODO: Apply resolveActivityGroup() for activity-based summaries
  // TODO: Write dashboard counts to org summary tables
  // TODO: Record progress in pipeline_runs

  await summaryQueue.add('summary', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Dashboard aggregation complete');
}

const dashboardWorker = new Worker<DashboardJobData>(
  'patentrack:dashboard',
  processDashboard,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

dashboardWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Dashboard job failed');
});

export default dashboardWorker;
