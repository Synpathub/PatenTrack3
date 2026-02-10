import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis.js';

export const ingestionQueue = new Queue('ingestion', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

export const pipelineQueue = new Queue('pipeline', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

export const enrichmentQueue = new Queue('enrichment', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 3 * 24 * 3600 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});
