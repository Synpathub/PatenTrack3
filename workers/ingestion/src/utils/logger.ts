import pino from 'pino';
import { LOG_LEVEL } from '../config';

export const logger = pino({
  level: LOG_LEVEL,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
  base: { service: 'ingestion-worker' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Create a child logger scoped to a specific worker. */
export function workerLogger(workerName: string) {
  return logger.child({ worker: workerName });
}
