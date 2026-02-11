/**
 * tree.worker.ts — Step 3: Ownership Tree Construction
 *
 * Builds the ownership tree (D3-compatible JSON) for each patent
 * in the organization, assigning node types, tabs, and colors.
 *
 * Business Rules: BR-024 → BR-031
 */

import { Worker, type Job } from 'bullmq';
import { isOwnershipTransfer, isEncumbrance, isRelease } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '@patentrack/db';
import { eq, and, asc, sql } from 'drizzle-orm';
import {
  TREE_NODE_TYPES,
  CONVEYANCE_TYPES,
  getConveyanceColor,
} from '@patentrack/shared';
import { timelineQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface TreeJobData {
  organizationId: string;
  pipelineRunId?: string;
}

const log = workerLogger('tree');

interface TreeNode {
  id: string;
  rfId: string;
  type: number;
  tab: number;
  color: string;
  assignorNames: string[];
  assigneeNames: string[];
  conveyanceType: string;
  isEmployerAssignment: boolean;
  recordDate: string | null;
  children: TreeNode[];
}

function getNodeTypeAndTab(
  conveyanceType: string | null,
  isEmployerAssignment: boolean,
): { type: number; tab: number } {
  if (isEmployerAssignment) return TREE_NODE_TYPES.EMPLOYEE;

  switch (conveyanceType) {
    case CONVEYANCE_TYPES.EMPLOYEE:
      return TREE_NODE_TYPES.EMPLOYEE;
    case CONVEYANCE_TYPES.ASSIGNMENT:
      return TREE_NODE_TYPES.PURCHASE;
    case CONVEYANCE_TYPES.MERGER:
      return TREE_NODE_TYPES.MERGER_IN;
    case CONVEYANCE_TYPES.SECURITY:
      return TREE_NODE_TYPES.SECURITY_OUT;
    case CONVEYANCE_TYPES.RELEASE:
      return TREE_NODE_TYPES.RELEASE_OUT;
    case CONVEYANCE_TYPES.NAME_CHANGE:
      return TREE_NODE_TYPES.NAME_CHANGE;
    case CONVEYANCE_TYPES.GOVERN:
      return TREE_NODE_TYPES.GOVERN;
    case CONVEYANCE_TYPES.CORRECT:
      return TREE_NODE_TYPES.CORRECT;
    case CONVEYANCE_TYPES.LICENSE:
      return TREE_NODE_TYPES.OTHER;
    case CONVEYANCE_TYPES.MISSING:
      return TREE_NODE_TYPES.MISSING;
    default:
      return TREE_NODE_TYPES.OTHER;
  }
}

async function processTree(job: Job<TreeJobData>) {
  const { organizationId, pipelineRunId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting tree construction');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'tree',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Get all org assets (patents this org monitors)
  const assets = await db
    .select({
      assetId: schema.orgAssets.id,
      patentId: schema.orgAssets.patentId,
      documentId: schema.orgAssets.documentId,
    })
    .from(schema.orgAssets)
    .where(eq(schema.orgAssets.orgId, organizationId));

  let treesBuilt = 0;

  for (const asset of assets) {
    // Get classified assignments for this patent, ordered by record date
    const orgAssigns = await db
      .select({
        id: schema.orgAssignments.id,
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

    // Build tree nodes
    const treeNodes: TreeNode[] = [];

    for (const oa of orgAssigns) {
      // Get assignors and assignees for this assignment
      const assignors = await db
        .select({ name: schema.assignmentAssignors.name })
        .from(schema.assignmentAssignors)
        .where(eq(schema.assignmentAssignors.rfId, oa.rfId));

      const assignees = await db
        .select({ name: schema.assignmentAssignees.name })
        .from(schema.assignmentAssignees)
        .where(eq(schema.assignmentAssignees.rfId, oa.rfId));

      const { type, tab } = getNodeTypeAndTab(oa.conveyanceType, oa.isEmployerAssignment);

      treeNodes.push({
        id: oa.id,
        rfId: oa.rfId,
        type,
        tab,
        color: getConveyanceColor(oa.conveyanceType ?? 'assignment'),
        assignorNames: assignors.map((a) => a.name),
        assigneeNames: assignees.map((a) => a.name),
        conveyanceType: oa.conveyanceType ?? 'missing',
        isEmployerAssignment: oa.isEmployerAssignment,
        recordDate: oa.recordDate?.toISOString() ?? null,
        children: [],
      });
    }

    // Determine dashboard tab from tree composition
    const hasEncumbrance = treeNodes.some((n) => n.tab === 2);
    const tab = hasEncumbrance ? 'encumbered' as const : 'complete' as const;

    // Upsert dashboard item with tree JSON
    await db
      .insert(schema.dashboardItems)
      .values({
        orgId: organizationId,
        assetId: asset.assetId,
        type: 0, // Will be updated by broken-title worker
        tab,
        treeJson: treeNodes,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.dashboardItems.orgId, schema.dashboardItems.assetId],
        set: {
          treeJson: treeNodes,
          tab,
          computedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    treesBuilt++;
  }

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: sql`array_append(steps_completed, 'tree')`,
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  await timelineQueue.add('timeline', { organizationId, pipelineRunId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, treesBuilt, jobId: job.id }, 'Tree construction complete');
  return { treesBuilt };
}

const treeWorker = new Worker<TreeJobData>(
  'patentrack:tree',
  processTree,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

treeWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Tree job failed');
});

export default treeWorker;
