/**
 * generate-json.worker.ts — Step 8: JSON Artifact Generation
 *
 * Final pipeline step. Generates the pre-computed JSON payloads
 * served to the frontend (ownership diagrams, timelines, etc.).
 *
 * This is the last step — no further queue is enqueued.
 */

import { Worker, type Job } from 'bullmq';
import { db, redis, WORKER_CONCURRENCY } from '../config';
import { workerLogger } from '../utils/logger';

interface GenerateJsonJobData {
  organizationId: string;
}

const log = workerLogger('generate-json');

async function processGenerateJson(job: Job<GenerateJsonJobData>) {
  const { organizationId } = job.data;
  log.info({ organizationId, jobId: job.id }, 'Starting JSON generation');

  // TODO: Query tree, timeline, dashboard, summary data for the org
  // TODO: Build JSON payloads for each patent (ownership diagram, timeline)
  // TODO: Build org-level JSON (dashboard, summary)
  // TODO: Write JSON artifacts to patent_json / org_json tables
  // TODO: Update data_freshness table with completion timestamp
  // TODO: Mark pipeline_run as completed

  log.info({ organizationId, jobId: job.id }, 'JSON generation complete — pipeline finished');
}

const generateJsonWorker = new Worker<GenerateJsonJobData>(
  'patentrack:generate-json',
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
