import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, index,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';

// =============================================================================
// Share Links (BR-044, BR-045, BR-046, BR-047)
// =============================================================================

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    createdBy: uuid('created_by').references(() => users.id),
    code: text('code').notNull().unique(), // CUID2 24-32 chars (BR-044, fixing S-03)
    name: text('name').notNull(),
    assetIds: uuid('asset_ids').array(), // Scoped to specific assets (BR-045)
    permissions: jsonb('permissions').$type<SharePermissions>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // BR-046
    maxUses: integer('max_uses'),
    useCount: integer('use_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_share_links_code').on(table.code),
    index('idx_share_links_org_id').on(table.orgId),
    index('idx_share_links_is_active').on(table.isActive),
  ],
);

// =============================================================================
// Share Access Log (BR-047)
// =============================================================================

export const shareAccessLog = pgTable(
  'share_access_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shareLinkId: uuid('share_link_id').notNull().references(() => shareLinks.id, { onDelete: 'cascade' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_share_access_link_id').on(table.shareLinkId),
    index('idx_share_access_accessed_at').on(table.accessedAt),
  ],
);

// =============================================================================
// Types
// =============================================================================

export interface SharePermissions {
  diagram: boolean;
  assetList: boolean;
  connections: boolean;
  familyData: boolean;
  maintenanceFees: boolean;
}
