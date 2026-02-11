/**
 * summary.worker.ts — Step 7: Organization Summary
 *
 * Collects all entity names (assignors/assignees), normalizes them,
 * groups them via Levenshtein distance, writes canonical entities
 * and aliases, and computes org-level summary metrics.
 *
 * Business Rules: BR-013 → BR-020
 */

import { Worker, type Job } from 'bullmq';
import { groupEntities, normalizeName } from '../../../../packages/business-rules/src/index';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { schema } from '../../../../packages/db/src/index';
import { eq, sql } from 'drizzle-orm';
import { generateJsonQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface SummaryJobData {
  organizationId: string;
  pipelineRunId?: string;
  dashboardCounts?: {
    totalAssets: number;
    completeChains: number;
    brokenChains: number;
    encumbrances: number;
  };
}

const log = workerLogger('summary');

async function processSummary(job: Job<SummaryJobData>) {
  const { organizationId, pipelineRunId, dashboardCounts } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting summary generation');

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      currentStep: 'summary',
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  // Collect all unique entity names from assignors and assignees
  // for assignments related to this org
  const assignorNames = await db
    .select({
      name: schema.assignmentAssignors.name,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.assignmentAssignors)
    .innerJoin(
      schema.orgAssignments,
      eq(schema.assignmentAssignors.rfId, schema.orgAssignments.rfId),
    )
    .where(eq(schema.orgAssignments.orgId, organizationId))
    .groupBy(schema.assignmentAssignors.name);

  const assigneeNames = await db
    .select({
      name: schema.assignmentAssignees.name,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.assignmentAssignees)
    .innerJoin(
      schema.orgAssignments,
      eq(schema.assignmentAssignees.rfId, schema.orgAssignments.rfId),
    )
    .where(eq(schema.orgAssignments.orgId, organizationId))
    .groupBy(schema.assignmentAssignees.name);

  // Combine and deduplicate, normalize names
  const nameMap = new Map<string, number>();
  for (const row of [...assignorNames, ...assigneeNames]) {
    const normalized = normalizeName(row.name);
    nameMap.set(normalized, (nameMap.get(normalized) ?? 0) + row.count);
  }

  // Build entity candidates for grouping
  const candidates = Array.from(nameMap.entries()).map(([name, count], idx) => ({
    id: idx,
    name,
    occurrenceCount: count,
  }));

  const groups = groupEntities(candidates);

  // Clear existing entities/aliases for this org, then write fresh
  await db.delete(schema.entityAliases).where(eq(schema.entityAliases.orgId, organizationId));
  await db.delete(schema.entities).where(eq(schema.entities.orgId, organizationId));

  let entitiesWritten = 0;

  for (const group of groups) {
    // Insert canonical entity
    const [entity] = await db.insert(schema.entities).values({
      orgId: organizationId,
      canonicalName: group.canonicalName,
    }).returning({ id: schema.entities.id });

    if (!entity) continue;

    // Insert aliases
    for (const name of group.names) {
      await db.insert(schema.entityAliases).values({
        entityId: entity.id,
        orgId: organizationId,
        name,
        occurrenceCount: nameMap.get(name) ?? 1,
      });
    }

    entitiesWritten++;
  }

  // Count transactions and employees
  const transactionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orgAssignments)
    .where(eq(schema.orgAssignments.orgId, organizationId));

  const employeeCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orgAssignments)
    .where(
      sql`${schema.orgAssignments.orgId} = ${organizationId} AND ${schema.orgAssignments.isEmployerAssignment} = true`,
    );

  // Upsert summary metrics
  await db
    .insert(schema.summaryMetrics)
    .values({
      orgId: organizationId,
      companyId: null,
      totalAssets: dashboardCounts?.totalAssets ?? 0,
      totalEntities: entitiesWritten,
      totalTransactions: transactionCount[0]?.count ?? 0,
      totalEmployees: employeeCount[0]?.count ?? 0,
      totalParties: nameMap.size,
      completeChains: dashboardCounts?.completeChains ?? 0,
      brokenChains: dashboardCounts?.brokenChains ?? 0,
      encumbrances: dashboardCounts?.encumbrances ?? 0,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.summaryMetrics.orgId, schema.summaryMetrics.companyId],
      set: {
        totalAssets: dashboardCounts?.totalAssets ?? 0,
        totalEntities: entitiesWritten,
        totalTransactions: transactionCount[0]?.count ?? 0,
        totalEmployees: employeeCount[0]?.count ?? 0,
        totalParties: nameMap.size,
        completeChains: dashboardCounts?.completeChains ?? 0,
        brokenChains: dashboardCounts?.brokenChains ?? 0,
        encumbrances: dashboardCounts?.encumbrances ?? 0,
        computedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  if (pipelineRunId) {
    await db.update(schema.pipelineRuns).set({
      stepsCompleted: sql`array_append(steps_completed, 'summary')`,
    }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  }

  await generateJsonQueue.add('generate-json', { organizationId, pipelineRunId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, entitiesWritten, jobId: job.id }, 'Summary generation complete');
  return { entitiesWritten, totalParties: nameMap.size };
}

const summaryWorker = new Worker<SummaryJobData>(
  'patentrack-summary',
  processSummary,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);

summaryWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Summary job failed');
});

export default summaryWorker;
