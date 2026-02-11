/**
 * generate-json.worker.ts — Step 8: JSON Artifact Generation
 *
 * Final pipeline step. Marks the pipeline run as completed and
 * updates data freshness. The pre-computed JSON payloads
 * (tree, timeline, dashboard, summary) are already stored in their
 * respective tables by prior workers — the frontend reads directly
 * from those tables.
 *
 * This is the last step — no further queue is enqueued.
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '../../../../packages/db/src/index';
import { eq, sql } from 'drizzle-orm';
import { workerLogger } from '../utils/logger';

interface GenerateJsonJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('generate-json');

async function processGenerateJson(job: Job<GenerateJsonJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting JSON generation (final step)');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'generate_json',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Verify all computed data exists
  const dashboardCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.dashboardItems)
    .where(eq(schema.dashboardItems.orgId, organizationId));

  const summaryExists = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.summaryMetrics)
    .where(eq(schema.summaryMetrics.orgId, organizationId));

  const timelineCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.timelineEntries)
    .where(eq(schema.timelineEntries.orgId, organizationId));

  const entityCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.entities)
    .where(eq(schema.entities.orgId, organizationId));

  log.info({
    organizationId,
    dashboardItems: dashboardCount[0]?.count ?? 0,
    summaryMetrics: summaryExists[0]?.count ?? 0,
    timelineEntries: timelineCount[0]?.count ?? 0,
    entities: entityCount[0]?.count ?? 0,
  }, 'Data verification');

  // Mark pipeline run as completed
  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      status: 'completed',
      stepsCompleted: sql`array_append(steps_completed, 'generate_json')`,
      completedAt: new Date(),
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Update data freshness
  await db
    .insert(schema.dataFreshness)
    .values({
      source: 'assignments',
      lastSuccessAt: new Date(),
      lastRecordCount: dashboardCount[0]?.count ?? 0,
      expectedIntervalHours: 24,
    })
    .onConflictDoUpdate({
      target: [schema.dataFreshness.source],
      set: {
        lastSuccessAt: new Date(),
        lastRecordCount: dashboardCount[0]?.count ?? 0,
        updatedAt: new Date(),
      },
    });

  log.info({ organizationId, jobId: job.id }, 'Pipeline finished successfully');
  return {
    dashboardItems: dashboardCount[0]?.count ?? 0,
    timelineEntries: timelineCount[0]?.count ?? 0,
    entities: entityCount[0]?.count ?? 0,
  };
}

const generateJsonWorker = new Worker<GenerateJsonJobData>(
  'patentrack-generate-json',
  processGenerateJson,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

generateJsonWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Generate-JSON job failed');
});

export default generateJsonWorker;
