import { Queue } from 'bullmq';
import { redis } from './config';

const defaultOpts = { connection: redis };

// ── Processing pipeline queues (in execution order) ──────────────────────────

export const classifyQueue = new Queue('patentrack:classify', defaultOpts);
export const flagQueue = new Queue('patentrack:flag', defaultOpts);
export const treeQueue = new Queue('patentrack:tree', defaultOpts);
export const timelineQueue = new Queue('patentrack:timeline', defaultOpts);
export const brokenTitleQueue = new Queue('patentrack:broken-title', defaultOpts);
export const dashboardQueue = new Queue('patentrack:dashboard', defaultOpts);
export const summaryQueue = new Queue('patentrack:summary', defaultOpts);
export const generateJsonQueue = new Queue('patentrack:generate-json', defaultOpts);

// ── Ingestion queues ─────────────────────────────────────────────────────────

export const assignmentsQueue = new Queue('patentrack:assignments', defaultOpts);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** All queues — useful for health checks and graceful shutdown. */
export const allQueues = [
  classifyQueue,
  flagQueue,
  treeQueue,
  timelineQueue,
  brokenTitleQueue,
  dashboardQueue,
  summaryQueue,
  generateJsonQueue,
  assignmentsQueue,
] as const;
