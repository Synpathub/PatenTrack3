import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Connection for queries (pooled)
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

// Connection for migrations (single, non-pooled)
export function createMigrationClient() {
  return postgres(connectionString!, { max: 1 });
}

export { schema };
export type Database = typeof db;
