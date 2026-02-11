/**
 * broken-title.worker.ts — Step 5: Broken Title Chain Detection
 *
 * THIS IS THE CORE BUSINESS LOGIC OF PATENTRACK.
 * For each patent in the org, builds a ChainTransaction[] from
 * org_assignments + assignors/assignees, runs analyzeChain(),
 * and writes chain status to dashboard_items.
 *
 * Business Rules: BR-032 → BR-036
 */

import { Worker, type Job } from 'bullmq';
import { analyzeChain, type ChainTransaction } from '../../../../packages/business-rules/src/index';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '../../../../packages/db/src/index';
import { eq, and, asc, sql } from 'drizzle-orm';
import { DASHBOARD_TYPES } from '../../../../packages/shared/src/index';
import { dashboardQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface BrokenTitleJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('broken-title');

function dashboardTypeToTab(dashboardType: number): 'complete' | 'broken' | 'encumbered' | 'other' {
  switch (dashboardType) {
    case DASHBOARD_TYPES.COMPLETE:
      return 'complete';
    case DASHBOARD_TYPES.BROKEN:
      return 'broken';
    case DASHBOARD_TYPES.ENCUMBERED:
      return 'encumbered';
    default:
      return 'other';
  }
}

async function processBrokenTitle(job: Job<BrokenTitleJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting broken title analysis');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'broken_title',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Get all org assets
  const assets = await db
    .select({
      assetId: schema.orgAssets.id,
      documentId: schema.orgAssets.documentId,
    })
    .from(schema.orgAssets)
    .where(eq(schema.orgAssets.orgId, organizationId));

  let analyzed = 0;
  let broken = 0;
  let complete = 0;
  let encumbered = 0;

  for (const asset of assets) {
    // Get classified assignments for this patent, ordered by record date
    const orgAssigns = await db
      .select({
        rfId: schema.orgAssignments.rfId,
        conveyanceType: schema.orgAssignments.conveyanceType,
        isEmployerAssignment: schema.orgAssignments.isEmployerAssignment,
        recordDate: schema.orgAssignments.recordDate,
      })
      .from(schema.orgAssignments)
      .where(
        and(
          eq(schema.orgAssignments.orgId, organizationId),
          eq(schema.orgAssignments.documentId, asset.documentId),
        ),
      )
      .orderBy(asc(schema.orgAssignments.recordDate));

    // Build ChainTransaction[] for analyzeChain()
    const transactions: ChainTransaction[] = [];

    for (const oa of orgAssigns) {
      const assignors = await db
        .select({ name: schema.assignmentAssignors.name })
        .from(schema.assignmentAssignors)
        .where(eq(schema.assignmentAssignors.rfId, oa.rfId));

      const assignees = await db
        .select({ name: schema.assignmentAssignees.name })
        .from(schema.assignmentAssignees)
        .where(eq(schema.assignmentAssignees.rfId, oa.rfId));

      transactions.push({
        rfId: oa.rfId,
        assignorNames: assignors.map((a) => a.name),
        assigneeNames: assignees.map((a) => a.name),
        conveyanceType: (oa.conveyanceType ?? 'missing') as ChainTransaction['conveyanceType'],
        employerAssign: oa.isEmployerAssignment,
        recordDate: oa.recordDate ?? new Date(0),
      });
    }

    // Run the core analysis
    const chainResult = analyzeChain(transactions);

    // Determine broken reason
    const brokenReason = chainResult.breaks.length > 0
      ? chainResult.breaks.map((b) => b.reason).join('; ')
      : null;

    const brokenMissingLink = chainResult.breaks.length > 0
      ? {
          from: chainResult.breaks[0]?.expectedAssignor ?? [],
          to: chainResult.breaks[0]?.actualAssignor ?? [],
        }
      : null;

    // Update dashboard item (created by tree worker)
    await db
      .insert(schema.dashboardItems)
      .values({
        orgId: organizationId,
        assetId: asset.assetId,
        type: chainResult.dashboardType,
        tab: dashboardTypeToTab(chainResult.dashboardType),
        isBroken: chainResult.status === 'broken',
        brokenReason,
        brokenMissingLink,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.dashboardItems.orgId, schema.dashboardItems.assetId],
        set: {
          type: chainResult.dashboardType,
          tab: dashboardTypeToTab(chainResult.dashboardType),
          isBroken: chainResult.status === 'broken',
          brokenReason,
          brokenMissingLink,
          computedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    analyzed++;
    if (chainResult.status === 'broken') broken++;
    else if (chainResult.status === 'complete') complete++;
    else if (chainResult.status === 'encumbered') encumbered++;
  }

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: sql`array_append(steps_completed, 'broken_title')`,
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  await dashboardQueue.add('dashboard', { organizationId, pipelineRunId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info(
    { organizationId, analyzed, broken, complete, encumbered, jobId: job.id },
    'Broken title analysis complete',
  );
  return { analyzed, broken, complete, encumbered };
}

const brokenTitleWorker = new Worker<BrokenTitleJobData>(
  'patentrack-broken-title',
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
