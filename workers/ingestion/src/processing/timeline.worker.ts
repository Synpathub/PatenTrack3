/**
 * timeline.worker.ts — Step 4: Timeline Generation
 *
 * Generates a chronological timeline of ownership events for each patent,
 * grouped by date with assignment counts and conveyance type arrays.
 *
 * Business Rules: BR-024 → BR-031 (timeline is derived from tree data)
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '../../../../packages/db/src/index';
import { eq, sql } from 'drizzle-orm';
import { brokenTitleQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface TimelineJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('timeline');

async function processTimeline(job: Job<TimelineJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting timeline generation');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'timeline',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Group org_assignments by record_date, count per day, collect types
  const grouped = await db
    .select({
      recordDate: schema.orgAssignments.recordDate,
      count: sql<number>`count(*)::int`,
      types: sql<string[]>`array_agg(distinct ${schema.orgAssignments.conveyanceType})`,
    })
    .from(schema.orgAssignments)
    .where(eq(schema.orgAssignments.orgId, organizationId))
    .groupBy(schema.orgAssignments.recordDate);

  let entriesWritten = 0;

  for (const row of grouped) {
    if (!row.recordDate) continue;

    await db
      .insert(schema.timelineEntries)
      .values({
        orgId: organizationId,
        entryDate: row.recordDate,
        assignmentCount: row.count,
        types: row.types,
      })
      .onConflictDoUpdate({
        target: [schema.timelineEntries.orgId, schema.timelineEntries.entryDate],
        set: {
          assignmentCount: row.count,
          types: row.types,
          updatedAt: new Date(),
        },
      });

    entriesWritten++;
  }

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: sql`array_append(steps_completed, 'timeline')`,
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  await brokenTitleQueue.add('broken-title', { organizationId, pipelineRunId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, entriesWritten, jobId: job.id }, 'Timeline generation complete');
  return { entriesWritten };
}

const timelineWorker = new Worker<TimelineJobData>(
  'patentrack-timeline',
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
