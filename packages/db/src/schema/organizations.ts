import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { orgStatusEnum, environmentModeEnum } from './enums';

// =============================================================================
// Organizations
// =============================================================================

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: orgStatusEnum('status').notNull().default('active'),
    environmentMode: environmentModeEnum('environment_mode').notNull().default('PRO'),
    settings: jsonb('settings').$type<OrgSettings>().default({}),
    legacyDbName: text('legacy_db_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_organizations_slug').on(table.slug),
    index('idx_organizations_status').on(table.status),
  ],
);

// =============================================================================
// Types
// =============================================================================

export interface OrgSettings {
  darkMode?: boolean;
  defaultShareExpiry?: string;
  slackWebhookUrl?: string;
  googleDriveEnabled?: boolean;
  teamsWebhookUrl?: string;
}
