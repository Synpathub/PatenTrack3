/**
 * Ingestion Worker — Entry Point
 *
 * Starts all BullMQ workers, registers recurring schedules,
 * and handles graceful shutdown on SIGTERM / SIGINT.
 */

import { logger } from './utils/logger';
import { allQueues } from './queues';
import { registerSchedules } from './schedulers/schedules';

// ── Import all workers (side-effect: registers them with BullMQ) ─────────

import classifyWorker from './processing/classify.worker';
import flagWorker from './processing/flag.worker';
import treeWorker from './processing/tree.worker';
import timelineWorker from './processing/timeline.worker';
import brokenTitleWorker from './processing/broken-title.worker';
import dashboardWorker from './processing/dashboard.worker';
import summaryWorker from './processing/summary.worker';
import generateJsonWorker from './processing/generate-json.worker';
import assignmentsWorker from './ingestion/assignments.worker';

const workers = [
  classifyWorker,
  flagWorker,
  treeWorker,
  timelineWorker,
  brokenTitleWorker,
  dashboardWorker,
  summaryWorker,
  generateJsonWorker,
  assignmentsWorker,
];

// ── Startup ──────────────────────────────────────────────────────────────

async function main() {
  logger.info(
    { workerCount: workers.length },
    'PatenTrack ingestion workers starting',
  );

  logger.info(
    'Pipeline order: assignments → classify → flag → tree → timeline → broken-title → dashboard → summary → generate-json',
  );

  await registerSchedules();

  logger.info('All workers running. Waiting for jobs…');
}

// ── Graceful Shutdown ────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received — draining workers');

  // Close all workers (let in-progress jobs finish)
  await Promise.allSettled(workers.map((w) => w.close()));

  // Close all queues
  await Promise.allSettled(allQueues.map((q) => q.close()));

  logger.info('All workers and queues closed. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

// ── Go ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start workers');
  process.exit(1);
});
