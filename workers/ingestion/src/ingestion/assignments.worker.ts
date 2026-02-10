/**
 * assignments.worker.ts — Data Ingestion: USPTO Assignment Download
 *
 * Downloads and parses patent assignment data from the USPTO bulk
 * data feed, normalises it, and stores it in the database.
 * After ingestion, kicks off the processing pipeline starting
 * with the classify step.
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { classifyQueue } from '../queues';
import { workerLogger } from '../utils/logger';

interface AssignmentsJobData {
  organizationId: string;
  /** Optional: restrict to a specific date range for incremental ingestion. */
  since?: string;
}

const log = workerLogger('assignments');

async function processAssignments(job: Job<AssignmentsJobData>) {
  const { organizationId, since } = job.data;
  log.info({ organizationId, since, jobId: job.id }, 'Starting assignment ingestion');

  // TODO: Determine date range (full vs incremental based on `since`)
  // TODO: Download assignment XML/ZIP from USPTO bulk data endpoint
  // TODO: Parse XML into structured assignment records
  // TODO: Upsert assignments into org_assignments table
  // TODO: Record ingestion metadata in ingestion_runs table
  // TODO: Update data_freshness table

  // Kick off the processing pipeline
  await classifyQueue.add('classify', { organizationId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  log.info({ organizationId, jobId: job.id }, 'Assignment ingestion complete — pipeline started');
}

const assignmentsWorker = new Worker<AssignmentsJobData>(
  'patentrack:assignments',
  processAssignments,
  {
    connection: redis,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
);

assignmentsWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err }, 'Assignments ingestion job failed');
});

export default assignmentsWorker;
