/**
 * flag.worker.ts — Step 2: Employer / Entity Flag Detection
 *
 * Detects employer assignments using inventor-to-assignor matching.
 * For each assignment, checks if any assignor name fuzzy-matches a patent inventor.
 *
 * Business Rules: BR-017, BR-021 → BR-023
 */

import { Worker, type Job } from 'bullmq';
import { matchInventorsToAssignment, normalizeName } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '@patentrack/db';
import { eq, and, sql } from 'drizzle-orm';
import { treeQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface FlagJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('flag');

async function processFlag(job: Job<FlagJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting flag detection');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'flag',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Get all org assignments with their patent document IDs
  const orgAssigns = await db
    .select({
      orgAssignmentId: schema.orgAssignments.id,
      assignmentId: schema.orgAssignments.assignmentId,
      documentId: schema.orgAssignments.documentId,
      rfId: schema.orgAssignments.rfId,
      conveyanceType: schema.orgAssignments.conveyanceType,
    })
    .from(schema.orgAssignments)
    .where(eq(schema.orgAssignments.orgId, organizationId));

  let flagged = 0;

  for (const oa of orgAssigns) {
    // Get assignor names for this assignment
    const assignors = await db
      .select({ name: schema.assignmentAssignors.name })
      .from(schema.assignmentAssignors)
      .where(eq(schema.assignmentAssignors.rfId, oa.rfId));

    // Get patent inventors via org_assets + patent_inventors
    const inventors = await db
      .select({ name: schema.patentInventors.name })
      .from(schema.orgAssets)
      .innerJoin(
        schema.patentInventors,
        eq(schema.orgAssets.patentId, schema.patentInventors.patentId),
      )
      .where(
        and(
          eq(schema.orgAssets.orgId, organizationId),
          eq(schema.orgAssets.documentId, oa.documentId),
        ),
      );

    if (inventors.length === 0 || assignors.length === 0) continue;

    // Build inventor names array for matching
    const inventorNames = inventors.map((inv) => ({
      firstName: inv.name.split(' ')[0] ?? '',
      lastName: inv.name.split(' ').slice(-1)[0] ?? '',
      fullName: inv.name,
    }));

    const assignorNames = assignors.map((a) => a.name);

    // Check if any assignor is an inventor (= employer assignment)
    const match = matchInventorsToAssignment(inventorNames, assignorNames);

    if (match.isEmployerAssignment) {
      await db.update(schema.orgAssignments).set({
        isEmployerAssignment: true,
        flagged: true,
        flagReason: `Inventor match: ${match.matchedAssignor ?? 'unknown'}`,
        updatedAt: new Date(),
      }).where(eq(schema.orgAssignments.id, oa.orgAssignmentId));
      flagged++;
    }

    if (flagged % 50 === 0 && orgAssigns.length > 0) {
      await job.updateProgress(Math.round((flagged / orgAssigns.length) * 100));
    }
  }

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: sql`array_append(steps_completed, 'flag')`,
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  await treeQueue.add('tree', { organizationId, pipelineRunId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, flagged, jobId: job.id }, 'Flag detection complete');
  return { flagged };
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
