import {
  pgTable, uuid, text, timestamp, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { userRoleEnum, hashAlgorithmEnum, oauthProviderEnum } from './enums.js';
import { organizations } from './organizations.js';

// =============================================================================
// Users
// =============================================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    hashAlgorithm: hashAlgorithmEnum('hash_algorithm').default('argon2id'),
    role: userRoleEnum('role').notNull().default('member'),
    emailVerified: boolean('email_verified').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    avatarUrl: text('avatar_url'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_users_email').on(table.email),
    index('idx_users_org_id').on(table.organizationId),
    index('idx_users_role').on(table.role),
  ],
);

// =============================================================================
// Refresh Tokens
// =============================================================================

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(), // For rotation detection (S-02)
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_family_id').on(table.familyId),
    index('idx_refresh_tokens_expires_at').on(table.expiresAt),
  ],
);

// =============================================================================
// OAuth Accounts
// =============================================================================

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: oauthProviderEnum('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_oauth_provider_account').on(table.provider, table.providerAccountId),
    index('idx_oauth_user_id').on(table.userId),
  ],
);

// =============================================================================
// Verification Codes (email verify, password reset)
// =============================================================================

export const verificationCodes = pgTable(
  'verification_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // 8-char alphanumeric (S-24)
    purpose: text('purpose').notNull(), // 'email_verify' | 'password_reset'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_verification_user_id').on(table.userId),
    index('idx_verification_code').on(table.code),
  ],
);
