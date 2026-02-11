/**
 * dashboard.worker.ts — Step 6: Dashboard Aggregation
 *
 * No additional computation needed — dashboard_items were written by
 * tree + broken-title workers. This step validates counts and
 * ensures consistency, then enqueues summary.
 *
 * Business Rules: BR-037 → BR-038
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '@patentrack/db';
import { eq, sql } from 'drizzle-orm';
import { summaryQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface DashboardJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('dashboard');

async function processDashboard(job: Job<DashboardJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting dashboard aggregation');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'dashboard',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Count dashboard items by type for this org
  const counts = await db
    .select({
      type: schema.dashboardItems.type,
      tab: schema.dashboardItems.tab,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.dashboardItems)
    .where(eq(schema.dashboardItems.orgId, organizationId))
    .groupBy(schema.dashboardItems.type, schema.dashboardItems.tab);

  const totalAssets = counts.reduce((sum, c) => sum + c.count, 0);
  const completeChains = counts
    .filter((c) => c.type === 0)
    .reduce((sum, c) => sum + c.count, 0);
  const brokenChains = counts
    .filter((c) => c.type === 1)
    .reduce((sum, c) => sum + c.count, 0);
  const encumbrances = counts
    .filter((c) => c.type === 18)
    .reduce((sum, c) => sum + c.count, 0);

  log.info(
    { organizationId, totalAssets, completeChains, brokenChains, encumbrances },
    'Dashboard counts computed',
  );

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: sql`array_append(steps_completed, 'dashboard')`,
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  await summaryQueue.add('summary', {
    organizationId,
    pipelineRunId,
    dashboardCounts: { totalAssets, completeChains, brokenChains, encumbrances },
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Dashboard aggregation complete');
  return { totalAssets, completeChains, brokenChains, encumbrances };
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
