import { Worker } from 'bullmq';
import { createLogger } from './lib/logger.js';
import { redisConnection } from './lib/redis.js';
import { registerCronJobs } from './cron/scheduler.js';

const logger = createLogger('worker');

async function main() {
  logger.info('Starting PatenTrack worker...');

  // Register cron jobs
  await registerCronJobs();
  logger.info('Cron jobs registered');

  // Start ingestion worker
  const ingestionWorker = new Worker(
    'ingestion',
    async (job) => {
      logger.info({ jobName: job.name, jobId: job.id }, 'Processing ingestion job');
      // TODO: Implement processors in Phase 3
      logger.info({ jobName: job.name }, 'Job complete (stub)');
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  // Start pipeline worker
  const pipelineWorker = new Worker(
    'pipeline',
    async (job) => {
      logger.info({ jobName: job.name, jobId: job.id, orgId: job.data.orgId }, 'Processing pipeline job');
      // TODO: Implement 8-step DAG orchestrator in Phase 3
      logger.info({ jobName: job.name }, 'Job complete (stub)');
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  // Start enrichment worker
  const enrichmentWorker = new Worker(
    'enrichment',
    async (job) => {
      logger.info({ jobName: job.name, jobId: job.id }, 'Processing enrichment job');
      // TODO: Implement enrichment processors in Phase 3
      logger.info({ jobName: job.name }, 'Job complete (stub)');
    },
    {
      connection: redisConnection,
      concurrency: 3,
    },
  );

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([
      ingestionWorker.close(),
      pipelineWorker.close(),
      enrichmentWorker.close(),
    ]);
    logger.info('Workers shut down');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Worker started. Waiting for jobs...');
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
