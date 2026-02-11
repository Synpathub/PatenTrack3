/**
 * classify.worker.ts — Step 1: Transaction Type Classification
 *
 * Reads unclassified org_assignments, applies classifyConveyance() from
 * business-rules, writes results, then enqueues the flag step.
 *
 * Business Rules: BR-001 → BR-012
 */

import { Worker, type Job } from 'bullmq';
import { classifyConveyance } from '../../../../packages/business-rules/src/index';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '../../../../packages/db/src/index';
import { eq, and, isNull } from 'drizzle-orm';
import { flagQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface ClassifyJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('classify');

async function processClassify(job: Job<ClassifyJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting classification');

  // Update pipeline run status
  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'classify',
      status: 'active',
      startedAt: new Date(),
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Query unclassified org_assignments for this org
  const unclassified = await db
    .select({
      orgAssignmentId: schema.orgAssignments.id,
      assignmentId: schema.orgAssignments.assignmentId,
      conveyanceText: schema.assignments.conveyanceText,
    })
    .from(schema.orgAssignments)
    .innerJoin(
      schema.assignments,
      eq(schema.orgAssignments.assignmentId, schema.assignments.id),
    )
    .where(
      and(
        eq(schema.orgAssignments.orgId, organizationId),
        isNull(schema.orgAssignments.conveyanceType),
      ),
    );

  log.info({ organizationId, count: unclassified.length }, 'Found unclassified assignments');

  // Apply classifyConveyance() to each record and update
  let classified = 0;
  for (const row of unclassified) {
    const result = classifyConveyance(row.conveyanceText);

    await db.update(schema.orgAssignments).set({
      conveyanceType: result.conveyType,
      isEmployerAssignment: result.employerAssign,
      classifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(schema.orgAssignments.id, row.orgAssignmentId));

    classified++;
    if (classified % 100 === 0) {
      await job.updateProgress(Math.round((classified / unclassified.length) * 100));
    }
  }

  // Update pipeline run
  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: ['classify'],
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Enqueue next pipeline step
  await flagQueue.add('flag', { organizationId, pipelineRunId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, classified, jobId: job.id }, 'Classification complete');
  return { classified };
}

const classifyWorker = new Worker<ClassifyJobData>(
  'patentrack-classify',
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
