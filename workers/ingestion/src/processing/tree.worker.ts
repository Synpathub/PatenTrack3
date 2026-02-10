/**
 * tree.worker.ts — Step 3: Ownership Tree Construction
 *
 * Builds the ownership tree (D3-compatible) for each patent
 * in the organization, assigning node types and tabs.
 *
 * Business Rules: BR-024 → BR-031
 */

import { Worker, type Job } from 'bullmq';
import { isOwnershipTransfer, isEncumbrance, isRelease } from '@patentrack/business-rules';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { timelineQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface TreeJobData {
  organizationId: string;
}

const log = workerLogger('tree');

async function processTree(job: Job<TreeJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting tree construction');

  // TODO: Query classified assignments for this org's patents
  // TODO: Build tree structure using TREE_NODE_TYPES from @patentrack/shared
  // TODO: Assign conveyance colors via getConveyanceColor()
  // TODO: Persist tree nodes to patent_trees / ownership data tables
  // TODO: Record progress in pipeline_runs

  await timelineQueue.add('timeline', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Tree construction complete');
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
