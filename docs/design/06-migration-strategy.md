# PatenTrack3 Migration Strategy

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Complete

---

## Table of Contents

1. [Migration Overview](#1-migration-overview)
2. [Database Migration](#2-database-migration)
3. [Data Migration](#3-data-migration)
4. [Application Migration](#4-application-migration)
5. [Feature Parity Checklist](#5-feature-parity-checklist)
6. [Cutover Plan](#6-cutover-plan)
7. [Rollback Strategy](#7-rollback-strategy)
8. [Risk Register](#8-risk-register)

---

## 1. Migration Overview

### 1.1 Migration Scope

Migrate from PatenTrack's legacy system (7 repositories, 9 databases, 3 frontends, PHP pipeline) to the new PatenTrack3 platform (1 monorepo, 1 PostgreSQL database, 1 Next.js app, TypeScript pipeline).

| Component | Legacy | New |
|-----------|--------|-----|
| **Frontend** | PT-App (React 17), PT-Admin (React 16), PT-Share (React 16) | Single Next.js 15+ app |
| **API** | PT-API (Express, 388 endpoints) | Next.js API routes + Fastify worker (70 endpoints) |
| **Database** | 9 MySQL databases (1 shared + N per-customer `db_{orgId}{uniqid}`) | 1 PostgreSQL database (shared schema + RLS) |
| **Pipeline** | PHP scripts via `exec()`, Node cron | BullMQ workers (TypeScript) |
| **Auth** | 3 separate implementations, localStorage tokens | Unified auth, httpOnly cookies |
| **Infrastructure** | AWS (unclear setup, hardcoded credentials) | Vercel + Railway + Neon + Upstash |

### 1.2 Migration Principles

1. **Zero data loss** — Every patent record, assignment, entity, and user account must survive migration
2. **Minimal downtime** — Target < 4 hours for final cutover
3. **Reversible** — Rollback plan for every phase
4. **Incremental** — Migrate in phases, not all at once
5. **Parallel run** — New system runs alongside old for validation before cutover
6. **Feature parity first** — No new features during migration; match existing functionality exactly

### 1.3 Migration Phases

```
Phase 1: Foundation (Week 1-2)
  └─ Infrastructure setup, CI/CD, PostgreSQL schema deployment

Phase 2: Database Migration (Week 3-4)
  └─ Schema creation, data migration scripts, validation

Phase 3: Backend Migration (Week 5-8)
  └─ API endpoints, auth system, ingestion pipeline

Phase 4: Frontend Migration (Week 9-12)
  └─ Dashboard, admin panel, share viewer, D3 diagram

Phase 5: Parallel Run (Week 13-14)
  └─ Both systems running, data sync, comparison testing

Phase 6: Cutover (Week 15)
  └─ DNS switch, final data sync, legacy shutdown

Phase 7: Post-Migration (Week 16+)
  └─ Monitoring, cleanup, legacy decommission
```

### 1.4 Timeline Summary

| Phase | Duration | Key Deliverable |
|-------|----------|----------------|
| Phase 1: Foundation | 2 weeks | Infrastructure running, empty schema deployed |
| Phase 2: Database | 2 weeks | All data migrated to PostgreSQL, validated |
| Phase 3: Backend | 4 weeks | All 70 API endpoints working, pipeline running |
| Phase 4: Frontend | 4 weeks | Full UI with feature parity, D3 diagram verified |
| Phase 5: Parallel Run | 2 weeks | Both systems running, data consistency verified |
| Phase 6: Cutover | 1 week | Production switch, DNS update |
| Phase 7: Post-Migration | 2+ weeks | Monitoring, legacy decommission |
| **Total** | **~17 weeks** | |

---

## 2. Database Migration

### 2.1 Source Database Inventory

**Legacy MySQL Databases:**

| Database | Purpose | Estimated Size | Tables |
|----------|---------|---------------|--------|
| `paborern_patentrack` | Shared data (assignments, biblio, CPC) | ~50GB | ~30 |
| `db_{orgId}{uniqid}` × N | Per-customer data (trees, dashboards, entities) | ~0.5-2GB each | ~15 each |
| **Total** | | ~60-80GB | ~30 + (15 × N) |

**Target PostgreSQL (Neon):**

| Schema | Purpose | Estimated Size |
|--------|---------|---------------|
| `public` | All tables (40+), RLS policies, partitions | ~80-100GB |

### 2.2 Schema Migration

The PostgreSQL schema is defined in `docs/design/01-domain-model.md`. Key transformations from MySQL:

| MySQL | PostgreSQL | Notes |
|-------|-----------|-------|
| `INT AUTO_INCREMENT` | `UUID` (gen_random_uuid()) | All PKs change to UUID |
| `DATETIME` | `TIMESTAMPTZ` | Timezone-aware everywhere |
| `VARCHAR(N)` | `TEXT` (with check constraints) | PostgreSQL TEXT is preferred |
| `TINYINT(1)` for booleans | `BOOLEAN` | Native boolean type |
| `JSON` columns | `JSONB` | Indexable JSON |
| No row-level security | RLS policies on every tenant table | Multi-tenancy enforcement |
| Per-customer databases | Single schema + `org_id` column | Consolidation |
| No audit columns | `created_at`, `updated_at`, `deleted_at` on all tables | Soft delete support |
| No partitioning | Year-based partitioning on assignments (50M+ rows) | Performance |

**Migration script approach:**

```sql
-- Phase 2, Step 1: Create schema
-- Run from: docs/design/01-domain-model.md DDL section
-- Includes: tables, indexes, constraints, RLS policies, partitions

-- Phase 2, Step 2: Create migration functions
CREATE OR REPLACE FUNCTION migrate_org(
  p_legacy_org_db TEXT,
  p_new_org_id UUID
) RETURNS TABLE(table_name TEXT, rows_migrated BIGINT) AS $$
BEGIN
  -- Migration logic per org (see Section 2.3)
END;
$$ LANGUAGE plpgsql;
```

### 2.3 Per-Customer Database Consolidation

The most complex part of the migration: consolidating N separate MySQL databases into one PostgreSQL database with RLS.

**Legacy structure** (per customer database `db_{orgId}{uniqid}`):

```
dashboard_items     → dashboardItems (add org_id, UUID PK)
summary_metrics     → summaryMetrics (add org_id, UUID PK)
entities            → entities (add org_id, UUID PK)
entity_aliases      → entityAliases (add org_id, UUID PK)
companies           → companies (add org_id, UUID PK)
org_assets          → orgAssets (add org_id, UUID PK)
users               → users (add org_id, UUID PK)
settings            → org settings column in organizations table
share_links         → shareLinks (add org_id, UUID PK, add expiry + scope)
```

**Migration script per org:**

```typescript
// scripts/migrate-org.ts
import mysql from 'mysql2/promise';
import { db } from '@patentrack/db';

async function migrateOrg(legacyDbName: string, newOrgId: string) {
  const legacyDb = await mysql.createConnection({
    host: process.env.LEGACY_MYSQL_HOST,
    database: legacyDbName,
    // ... credentials from secrets manager
  });

  const report = { table: '', rowsMigrated: 0, errors: [] };

  // 1. Migrate dashboard_items
  const [dashboardItems] = await legacyDb.query('SELECT * FROM dashboard_items');
  for (const item of dashboardItems as any[]) {
    await db.insert(schema.dashboardItems).values({
      id: crypto.randomUUID(),
      orgId: newOrgId,
      assetId: await resolveAssetId(item.patent_number),  // Map legacy patent number → UUID
      type: item.type,
      tab: item.tab,
      color: item.color,
      treeJson: item.tree_json,
      // Map remaining fields...
    }).onConflictDoNothing();  // Idempotent
    report.rowsMigrated++;
  }

  // 2. Migrate entities + aliases
  const [entities] = await legacyDb.query('SELECT * FROM entities');
  for (const entity of entities as any[]) {
    const entityId = crypto.randomUUID();
    await db.insert(schema.entities).values({
      id: entityId,
      orgId: newOrgId,
      canonicalName: entity.canonical_name,
      representativeId: await resolveRepresentativeId(entity.representative_id),
      // ...
    }).onConflictDoNothing();

    // Migrate aliases for this entity
    const [aliases] = await legacyDb.query(
      'SELECT * FROM entity_aliases WHERE entity_id = ?', [entity.id]
    );
    for (const alias of aliases as any[]) {
      await db.insert(schema.entityAliases).values({
        id: crypto.randomUUID(),
        entityId,
        orgId: newOrgId,
        name: alias.name,
        occurrenceCount: alias.count,
        levenshteinDistance: alias.distance,
      }).onConflictDoNothing();
    }
  }

  // 3. Migrate companies
  const [companies] = await legacyDb.query('SELECT * FROM companies');
  for (const company of companies as any[]) {
    await db.insert(schema.companies).values({
      id: crypto.randomUUID(),
      orgId: newOrgId,
      name: company.name,
      domain: company.domain,
      logoUrl: company.logo_url,  // Will need S3 migration too
    }).onConflictDoNothing();
  }

  // 4. Migrate users
  const [users] = await legacyDb.query('SELECT * FROM users');
  for (const user of users as any[]) {
    await db.insert(schema.users).values({
      id: crypto.randomUUID(),
      orgId: newOrgId,
      email: user.email,
      name: user.name || user.email,
      passwordHash: await rehashPassword(user.password),  // bcrypt → Argon2id
      role: mapUserType(user.type),  // 0/1 → 'admin', default → 'member', 9 → 'super_admin'
      emailVerified: true,           // Existing users are pre-verified
      createdAt: user.created_at,
    }).onConflictDoNothing();
  }

  // 5. Migrate share_links (with new security model)
  const [shares] = await legacyDb.query('SELECT * FROM share_links');
  for (const share of shares as any[]) {
    await db.insert(schema.shareLinks).values({
      id: crypto.randomUUID(),
      orgId: newOrgId,
      code: share.code,
      name: `Migrated share: ${share.code}`,
      // SECURITY FIX (BR-045, BR-046): Migrate with 90-day expiry
      // Legacy shares were permanent and gave admin access
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      maxUses: null,
      permissions: {
        diagram: true,
        assetList: true,
        connections: false,        // Restricted by default
      },
      createdAt: share.created_at,
    }).onConflictDoNothing();
  }

  // 6. Migrate settings → organization record
  const [settings] = await legacyDb.query('SELECT * FROM settings LIMIT 1');
  if ((settings as any[]).length > 0) {
    const s = (settings as any[])[0];
    await db.update(schema.organizations)
      .set({
        environmentMode: s.environment_mode || 'PRO',
        settings: {
          darkMode: s.dark_mode === 1,
        },
      })
      .where(eq(schema.organizations.id, newOrgId));
  }

  return report;
}
```

### 2.4 Shared Data Migration

The shared `paborern_patentrack` database contains global patent data (assignments, bibliographic, CPC). This migrates into the `patent_data` bounded context.

```typescript
// scripts/migrate-shared.ts

async function migrateSharedData() {
  const legacyDb = await mysql.createConnection({
    host: process.env.LEGACY_MYSQL_HOST,
    database: 'paborern_patentrack',
  });

  // 1. Assignments (largest table — 50M+ rows)
  // Use streaming to avoid memory issues
  const assignmentStream = legacyDb.queryStream('SELECT * FROM assignments ORDER BY id');

  let batch: any[] = [];
  const BATCH_SIZE = 5000;

  for await (const row of assignmentStream) {
    batch.push({
      id: crypto.randomUUID(),
      rfId: row.rf_id,
      conveyanceText: row.conveyance_text,
      recordDate: row.record_date,
      // ... map all fields
    });

    if (batch.length >= BATCH_SIZE) {
      await db.insert(schema.assignments).values(batch).onConflictDoNothing();
      batch = [];
      // Log progress every 100k rows
    }
  }
  if (batch.length > 0) {
    await db.insert(schema.assignments).values(batch).onConflictDoNothing();
  }

  // 2. Patents (bibliographic data)
  // Similar streaming approach...

  // 3. CPC classifications
  // Full table copy (200MB)...

  // 4. Maintenance fee events
  // Streaming copy...

  // 5. Patent families (EPO data)
  // Streaming copy...
}
```

### 2.5 ID Mapping

Legacy uses MySQL `AUTO_INCREMENT` integers. New system uses UUIDs. A mapping table is required during migration:

```sql
-- Temporary migration mapping table
CREATE TABLE _migration_id_map (
  legacy_table TEXT NOT NULL,
  legacy_id BIGINT NOT NULL,
  legacy_db TEXT,                -- NULL for shared DB, org DB name for per-customer
  new_id UUID NOT NULL,
  PRIMARY KEY (legacy_table, legacy_id, legacy_db)
);

-- Index for reverse lookups during migration
CREATE INDEX idx_migration_new_id ON _migration_id_map(new_id);
```

This table is used during migration to resolve foreign key references (e.g., a dashboard_item references a patent by legacy integer ID → needs new UUID). It is dropped after migration validation is complete.

### 2.6 Password Rehashing

Legacy uses bcrypt (acceptable but not optimal). New system uses Argon2id (BR-051, fixing S-23).

**Strategy:** Lazy rehashing — don't migrate passwords at all. Instead:

1. During migration, store the bcrypt hash as-is with a `hash_algorithm` flag
2. On first login after migration, verify against bcrypt
3. If valid, rehash with Argon2id and update the record
4. After 90 days, force password reset for any remaining bcrypt accounts

```typescript
// Lazy rehashing during login
async function verifyPassword(inputPassword: string, user: User): Promise<boolean> {
  if (user.hashAlgorithm === 'bcrypt') {
    const valid = await bcrypt.compare(inputPassword, user.passwordHash);
    if (valid) {
      // Rehash with Argon2id
      const newHash = await argon2.hash(inputPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });
      await db.update(users).set({
        passwordHash: newHash,
        hashAlgorithm: 'argon2id',
      }).where(eq(users.id, user.id));
    }
    return valid;
  }

  // Normal Argon2id verification
  return argon2.verify(user.passwordHash, inputPassword);
}
```

### 2.7 Validation Queries

After each migration phase, run validation queries to ensure data integrity:

```sql
-- Validation: Row count comparison
-- Run against both legacy MySQL and new PostgreSQL

-- Assignments count
SELECT 'assignments' AS table_name,
  (SELECT COUNT(*) FROM legacy.assignments) AS legacy_count,
  (SELECT COUNT(*) FROM new.assignments) AS new_count,
  (SELECT COUNT(*) FROM legacy.assignments) -
  (SELECT COUNT(*) FROM new.assignments) AS difference;

-- Per-org dashboard items
SELECT o.name,
  (SELECT COUNT(*) FROM legacy_db.dashboard_items) AS legacy_count,
  (SELECT COUNT(*) FROM new.dashboard_items WHERE org_id = o.id) AS new_count
FROM organizations o;

-- Entity count per org
-- Company count per org
-- User count per org
-- Share link count per org
```

**Automated validation script:**

```typescript
// scripts/validate-migration.ts
interface ValidationResult {
  table: string;
  legacyCount: number;
  newCount: number;
  difference: number;
  status: 'PASS' | 'FAIL' | 'WARN';
}

async function validateMigration(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // Global tables
  for (const table of ['assignments', 'patents', 'cpc_classifications', 'maintenance_fee_events']) {
    const legacyCount = await getLegacyCount(table);
    const newCount = await getNewCount(table);
    results.push({
      table,
      legacyCount,
      newCount,
      difference: legacyCount - newCount,
      status: legacyCount === newCount ? 'PASS' : Math.abs(legacyCount - newCount) < 10 ? 'WARN' : 'FAIL',
    });
  }

  // Per-org tables
  const orgs = await db.select().from(schema.organizations);
  for (const org of orgs) {
    for (const table of ['dashboard_items', 'entities', 'companies', 'users']) {
      // Compare legacy per-customer DB count with new filtered count
      const legacyCount = await getLegacyOrgCount(org.legacyDbName, table);
      const newCount = await getNewOrgCount(org.id, table);
      results.push({
        table: `${org.name}/${table}`,
        legacyCount,
        newCount,
        difference: legacyCount - newCount,
        status: legacyCount === newCount ? 'PASS' : 'FAIL',
      });
    }
  }

  return results;
}
```

---

## 3. Data Migration

### 3.1 Migration Order

Data must be migrated in dependency order (foreign keys):

```
Step 1: Organizations (create org records with UUIDs)
Step 2: Users (depends on organizations)
Step 3: Shared patent data (assignments, patents, CPC, maintenance fees, families)
Step 4: Per-org computed data (entities, entity_aliases, companies)
Step 5: Per-org dashboard data (dashboard_items, summary_metrics, org_assets)
Step 6: Share links (depends on organizations)
Step 7: Run validation queries
Step 8: Run initial pipeline for each org (recompute trees, dashboards from new schema)
```

### 3.2 Step 8 — Recomputation

After raw data is migrated, run the full 8-step pipeline for every organization. This recomputes:

- Assignment classifications (using the new business rules engine)
- Entity normalization (using the new Levenshtein implementation)
- Ownership trees (fresh computation, not migrated from legacy)
- Broken title detection (fresh computation)
- Dashboard metrics (fresh computation)

**Why recompute instead of migrate computed data?**

1. Legacy computed data was generated by PHP — the new TypeScript pipeline may produce slightly different (more correct) results
2. Recomputation validates that the new pipeline works correctly end-to-end
3. It surfaces any data issues early (before cutover)
4. Dashboard metrics and trees will be in the new format (JSON structure, UUIDs, etc.)

**Recomputation time estimate:** 5-15 minutes per org (depending on asset count). Can be parallelized — 5 orgs at a time.

### 3.3 File Migration (S3)

Legacy system uses a mix of public S3 buckets (S-09) and local file storage. New system uses private S3 with signed URLs.

| Legacy Location | New Location | Action |
|----------------|-------------|--------|
| Public S3 bucket (PDFs) | Private S3 bucket | Copy objects, change ACL to private |
| Company logos (public URLs) | Private S3 bucket | Download and re-upload |
| Generated diagrams (local) | Redis cache (regenerated) | Not migrated — recomputed |

```bash
# S3 migration: copy objects from public to private bucket
aws s3 sync s3://legacy-public-bucket/ s3://patentrack3-private/ \
  --acl private \
  --metadata-directive COPY

# Verify object count
aws s3 ls s3://legacy-public-bucket/ --recursive | wc -l
aws s3 ls s3://patentrack3-private/ --recursive | wc -l
```

### 3.4 Secrets Migration

Legacy hardcoded API keys and database credentials directly in source code (S-04, S-05, S-06, S-10, S-12). All secrets move to Infisical (secrets manager).

| Secret | Legacy Location | New Location |
|--------|----------------|-------------|
| MySQL credentials | `.env` files in repos, some hardcoded | Infisical `DB_*` |
| JWT secret | Hardcoded in PT-API source | Infisical `JWT_SECRET` |
| Stripe keys | `.env` in PT-API | Infisical `STRIPE_*` |
| Google OAuth | `.env` scattered | Infisical `GOOGLE_*` |
| Microsoft OAuth | `.env` scattered | Infisical `MICROSOFT_*` |
| EPO API credentials | `.env` in PT-API | Infisical `EPO_*` |
| RiteKit API key | Hardcoded | Infisical `RITEKIT_API_KEY` |
| Clearbit API key | `.env` | Infisical `CLEARBIT_API_KEY` |
| Slack bot token | `.env` in PT-API | Infisical `SLACK_*` |
| S3 credentials | `.env` + hardcoded | IAM roles (no keys needed on Vercel/Railway) |
| Pusher credentials | `.env` in PT-Admin | Removed (SSE replaces Pusher) |

**Action:** Audit all 7 legacy repos for credentials before decommission. Use `git log --all --full-history -S "password\|secret\|key\|token" -- *.js *.json *.env` to find exposed secrets. Rotate all credentials after migration.

---

## 4. Application Migration

### 4.1 Backend Migration Strategy

Build the new API endpoint by endpoint, validating against legacy responses:

**Phase 3A (Week 5-6): Auth + Core APIs**

| Priority | Endpoints | Legacy Replacement | Validation |
|----------|-----------|-------------------|-----------|
| P0 | `POST /auth/login`, `/refresh`, `/logout` | `POST /signin`, `/signin/refresh` | Login flow works end-to-end |
| P0 | `GET /dashboards/summary` | `POST /dashboards/parties + /kpi + /counts` | Metrics match legacy (within tolerance) |
| P0 | `GET /assets` | `GET /assets/collections/...` | Asset list matches legacy |
| P0 | `GET /assets/:id` | `GET /assets/:asset` | Detail data matches |
| P0 | `GET /assets/:id/diagram` | `generate_json.php` output | Diagram JSON produces same visual |

**Phase 3B (Week 7-8): Remaining APIs + Pipeline**

| Priority | Endpoints | Notes |
|----------|-----------|-------|
| P0 | All remaining dashboard endpoints (trees, broken-titles, timeline) | |
| P0 | Ingestion pipeline (all 8 steps) | Validate against legacy pipeline output |
| P1 | Organization endpoints (entities, companies, users) | |
| P1 | Admin endpoints | |
| P1 | Share endpoints (with new security model) | |
| P2 | Integration endpoints (Slack, Teams, Google Drive) | Can be deferred post-cutover |

**API response comparison testing:**

```typescript
// scripts/compare-api-responses.ts
// For each endpoint, call both legacy and new API, compare responses

async function compareEndpoint(
  legacyUrl: string,
  newUrl: string,
  transformLegacy: (data: any) => any,  // Normalize legacy response format
) {
  const [legacyRes, newRes] = await Promise.all([
    fetch(legacyUrl, { headers: legacyAuthHeaders }),
    fetch(newUrl, { headers: newAuthHeaders }),
  ]);

  const legacyData = transformLegacy(await legacyRes.json());
  const newData = await newRes.json();

  const diff = deepDiff(legacyData, newData.data);
  if (diff.length > 0) {
    console.error(`MISMATCH: ${newUrl}`, diff);
  }
}
```

### 4.2 Frontend Migration Strategy

Build the new frontend page by page, using the new API:

**Phase 4A (Week 9-10): Core Dashboard**

| Page | Legacy Component | New Route | Validation |
|------|-----------------|-----------|-----------|
| Dashboard summary | PT-App root widget | `/` | All metrics display correctly |
| Asset list | PT-App asset collection | `/assets` | Pagination, search, filtering work |
| Asset detail | PT-App asset view | `/assets/:id` | All tabs render correctly |
| **Ownership diagram** | PT-App PatentrackDiagram (1,700 lines) | `/assets/:id/diagram` | **Visual pixel comparison with legacy** |
| Tree list | PT-App events widget | `/trees` | Tab filtering works |

**Phase 4B (Week 11-12): Admin + Share + Settings**

| Page | Legacy App | New Route |
|------|-----------|-----------|
| Admin dashboard | PT-Admin | `/admin` |
| Org management | PT-Admin | `/admin/organizations` |
| Ingestion status | New feature | `/admin/ingestion` |
| Share viewer | PT-Share | `/shared/:code` |
| Settings | PT-App settings | `/settings/*` |

### 4.3 D3 Diagram Migration

The ownership diagram is the highest-risk migration item. It must look and behave identically to the legacy version.

**Validation approach:**

1. **Visual regression testing:** Screenshot legacy and new diagrams for the same patent, pixel-diff
2. **Data comparison:** Compare diagram JSON structures (node count, link count, colors, types)
3. **User acceptance:** Uzi manually verifies 10 representative diagrams across different tree types

```typescript
// Playwright visual comparison test
test('diagram matches legacy for patent X', async ({ page }) => {
  // Screenshot legacy diagram
  await page.goto(LEGACY_URL + '/assets/12345');
  const legacyScreenshot = await page.locator('.diagram-container').screenshot();

  // Screenshot new diagram
  await page.goto(NEW_URL + '/assets/' + MIGRATED_UUID + '/diagram');
  await page.waitForSelector('svg.diagram-svg circle');
  const newScreenshot = await page.locator('.diagram-container').screenshot();

  // Compare with tolerance for font rendering differences
  expect(newScreenshot).toMatchSnapshot('diagram-patent-12345.png', {
    maxDiffPixelRatio: 0.02,  // 2% tolerance
  });
});
```

---

## 5. Feature Parity Checklist

Every feature in the legacy system must be present in the new system before cutover. Organized by legacy application.

### 5.1 PT-App (Customer Dashboard) Features

| # | Feature | Legacy Implementation | New Implementation | Status |
|---|---------|----------------------|-------------------|--------|
| 1 | Login/register | Express + localStorage JWT | Next.js + httpOnly cookies | ☐ |
| 2 | Google OAuth login | Express OAuth | Next.js + PKCE | ☐ |
| 3 | Microsoft OAuth login | Express OAuth | Next.js + PKCE | ☐ |
| 4 | Dashboard summary (KPI cards) | 3 API calls → Redux | 1 API call → Server Component | ☐ |
| 5 | Asset list with search | Redux actions + Axios | TanStack Query + URL params | ☐ |
| 6 | Asset detail (bibliographic) | Redux + API | Server Component | ☐ |
| 7 | Assignment history per asset | Embedded in asset response | Separate endpoint, paginated | ☐ |
| 8 | **Ownership diagram (D3)** | PatentrackDiagram.js (1,700 lines) | DiagramCanvas.tsx (shared component) | ☐ |
| 9 | Ownership tree list (tabs 0-3) | Event tab widgets | `/trees` with tab filter | ☐ |
| 10 | Broken title detection | Dashboard type=1 filter | Dedicated `/broken-titles` page | ☐ |
| 11 | Transaction timeline | Timeline widget | `/timeline` page | ☐ |
| 12 | CPC word cloud | CPC widget | `/dashboards/cpc-wordcloud` | ☐ |
| 13 | Patent family (EPO) | Family widget | `/assets/:id/family` | ☐ |
| 14 | Maintenance fee events | Event tabs | `/events/maintenance` | ☐ |
| 15 | Entity list | Entity widget | `/entities` | ☐ |
| 16 | Company portfolio | Company widget | `/companies` | ☐ |
| 17 | Search (global) | Search widget | `/search` | ☐ |
| 18 | Share link creation | Share dialog | `/settings/shares` | ☐ |
| 19 | Dark mode toggle | localStorage (BR-064) | Org settings via API | ☐ |
| 20 | Slack notifications | Integration settings | `/settings/integrations` | ☐ |
| 21 | Google Sheets export | Export dialog | `/settings/integrations` | ☐ |
| 22 | PDF download (assignment docs) | Public S3 URL | Signed S3 URL | ☐ |
| 23 | Connection popup (diagram click) | Modal over D3 | ConnectionPopup component | ☐ |

### 5.2 PT-Admin Features

| # | Feature | New Implementation | Status |
|---|---------|-------------------|--------|
| 24 | Admin login | Same auth, role=super_admin guard | ☐ |
| 25 | List all organizations | `/admin/organizations` | ☐ |
| 26 | Create organization | `/admin/organizations/new` | ☐ |
| 27 | Rebuild ownership tree | `/admin/organizations/:id` → button | ☐ |
| 28 | Run full pipeline | `/admin/organizations/:id` → button | ☐ |
| 29 | Transaction review | `/admin/transactions` | ☐ |
| 30 | Entity normalization trigger | `/organizations/:id/entities/normalize` | ☐ |
| 31 | Data quality fix-items | `/admin/fix-items` | ☐ |
| 32 | Ingestion status dashboard | `/admin/ingestion` (new — better than legacy) | ☐ |
| 33 | Job queue browser | `/admin/ingestion/jobs` (new) | ☐ |

### 5.3 PT-Share Features

| # | Feature | New Implementation | Status |
|---|---------|-------------------|--------|
| 34 | Public share landing | `/shared/:code` | ☐ |
| 35 | Shared asset list | `/shared/:code/assets` | ☐ |
| 36 | **Shared ownership diagram** | `/shared/:code/assets/:id/diagram` | ☐ |
| 37 | Connection popup (shared) | ConnectionPopup (readOnly mode) | ☐ |
| 38 | Mobile responsive share | New (legacy was 800px min-width) | ☐ |

### 5.4 Acceptance Criteria per Feature

Each feature is marked ☑ only when:

1. ✅ Endpoint returns correct data (validated against legacy)
2. ✅ UI renders correctly (visual comparison)
3. ✅ User interactions work (click, filter, paginate, search)
4. ✅ Automated test exists (unit, component, or E2E)
5. ✅ Uzi has reviewed and approved

---

## 6. Cutover Plan

### 6.1 Pre-Cutover Checklist

All items must be ☑ before cutover proceeds:

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | All 38 features at parity (Section 5) | Dev team | ☐ |
| 2 | All 70 API endpoints return correct data | Dev team | ☐ |
| 3 | Parallel run: 2 weeks with no critical issues | Dev team | ☐ |
| 4 | Data validation: all counts match (Section 2.7) | Dev team | ☐ |
| 5 | D3 diagram: 10 representative diagrams manually verified | Uzi | ☐ |
| 6 | Performance: dashboard loads < 200ms (p95) | Dev team | ☐ |
| 7 | Security: all 30 vulnerabilities (S-01–S-30) resolved | Dev team | ☐ |
| 8 | E2E tests pass: login → dashboard → diagram flow | CI/CD | ☐ |
| 9 | E2E tests pass: share viewer flow | CI/CD | ☐ |
| 10 | E2E tests pass: admin create org → pipeline → data appears | CI/CD | ☐ |
| 11 | Rollback plan tested (Section 7) | Dev team | ☐ |
| 12 | DNS TTL lowered to 60s (prepare for quick switch) | Infra | ☐ |
| 13 | All secrets rotated and in Infisical | Dev team | ☐ |
| 14 | Legacy credential audit complete (no exposed secrets) | Dev team | ☐ |
| 15 | Monitoring and alerting configured (Sentry, BetterUptime, Slack) | Dev team | ☐ |

### 6.2 Cutover Sequence (Target: < 4 hours)

```
T-24h:  Lower DNS TTL to 60 seconds
T-4h:   Send user notification: "Planned maintenance 02:00-06:00 UTC"

T+0:00  BEGIN CUTOVER
        - Enable maintenance mode on legacy system
        - Freeze legacy databases (read-only)

T+0:15  Final data sync
        - Run incremental migration for any data changed since parallel run started
        - Focus: new assignments (last 24h), user changes, new share links

T+0:45  Validation
        - Run automated validation queries (Section 2.7)
        - Spot-check 5 orgs manually
        - Run full pipeline for any orgs with new data

T+1:30  Smoke test new system
        - Login with test account
        - Verify dashboard loads
        - Verify D3 diagram renders
        - Verify share link works
        - Verify admin panel works

T+2:00  DNS switch
        - Update DNS to point to new system (Vercel)
        - Legacy system stays running (but read-only) for rollback

T+2:15  Verify DNS propagation
        - Test from multiple locations/devices
        - Verify HTTPS certificate

T+2:30  Post-switch smoke test
        - Login as real user
        - Full workflow test

T+3:00  Open to users
        - Disable maintenance mode
        - Send "migration complete" notification

T+4:00  END CUTOVER WINDOW
```

### 6.3 Post-Cutover Monitoring (24-48 hours)

| Check | Frequency | Alert Threshold |
|-------|-----------|----------------|
| Error rate (Sentry) | Continuous | > 1% of requests |
| Dashboard load time | Every 5 min | p95 > 500ms |
| Login success rate | Every 15 min | < 95% |
| Ingestion pipeline health | Every hour | Any failure |
| SSE connection count | Every 15 min | 0 connections (indicates auth issue) |
| API 4xx/5xx rates | Continuous | 5xx > 0.5% |

### 6.4 Legacy Decommission Timeline

| Timeframe | Action |
|-----------|--------|
| Cutover + 24h | Legacy stays read-only (rollback option) |
| Cutover + 7 days | Disable legacy API (keep database online) |
| Cutover + 30 days | Final database backup, delete legacy databases |
| Cutover + 60 days | Decommission legacy infrastructure |
| Cutover + 90 days | Expire migrated share links (BR-046 grace period ends) |
| Cutover + 90 days | Force password reset for any remaining bcrypt accounts |
| Cutover + 90 days | Archive legacy repositories (read-only on GitHub) |

---

## 7. Rollback Strategy

### 7.1 Rollback Decision Criteria

Rollback is triggered if any of these occur within 24 hours of cutover:

- **Critical:** Users cannot log in
- **Critical:** Dashboard shows incorrect data (wrong counts, missing orgs)
- **Critical:** D3 diagram fails to render for any org
- **Major:** > 5% error rate on API requests
- **Major:** Ingestion pipeline fails to process daily assignments

### 7.2 Rollback Procedure

```
1. DNS revert (5 min)
   - Point DNS back to legacy system
   - Legacy is still running read-only

2. Re-enable legacy writes (5 min)
   - Remove read-only flag on legacy MySQL
   - Re-enable legacy cron jobs

3. Data reconciliation (30-60 min)
   - Any data created in new system during cutover window must be
     manually migrated back to legacy (share links, user accounts)
   - Assignments/patents are ingested from USPTO directly — no data loss

4. User notification
   - "We've temporarily reverted to the previous system while we
     address an issue. Your data is safe."

5. Root cause analysis
   - Fix the issue
   - Re-validate
   - Schedule new cutover
```

### 7.3 Rollback Limitations

| Scenario | Rollback Impact |
|----------|----------------|
| Users created new share links post-cutover | Must recreate in legacy (new share model → old model is lossy) |
| Users changed passwords post-cutover | Must reset passwords in legacy |
| New assignments ingested by new pipeline | Re-ingest in legacy pipeline (no data loss — same USPTO source) |
| New org created by admin post-cutover | Must recreate in legacy admin |

### 7.4 Point-of-No-Return

After **7 days** post-cutover, the legacy system is disabled. Rollback after this point requires:

1. Re-deploying legacy infrastructure from backup
2. Restoring MySQL databases from backup
3. Significantly more effort (estimate: 1-2 days)

After **30 days**, legacy databases are deleted. Rollback is no longer feasible.

---

## 8. Risk Register

### 8.1 Technical Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | D3 diagram renders differently in new system | High | Critical | Visual regression tests, manual review of 10+ representative diagrams |
| R2 | PostgreSQL performance differs from MySQL for legacy queries | Medium | High | Load testing with production-scale data during Phase 5 |
| R3 | RLS policy misconfiguration leaks data between tenants | Low | Critical | Automated RLS tests: each test creates 2 orgs, verifies isolation |
| R4 | UUID migration breaks foreign key relationships | Medium | High | Migration mapping table, validation queries after each step |
| R5 | 12GB bibliographic ingestion fails under new streaming parser | Medium | Medium | Test with production-size XML files during Phase 3 |
| R6 | Password rehashing disrupts login for some users | Low | Medium | Lazy rehashing approach (Section 2.6) — no impact until user logs in |
| R7 | Legacy share links break after migration | Medium | Medium | Migrate with 90-day grace period, notify users of expiry |
| R8 | Neon PostgreSQL hits scaling limits with 50M+ assignment rows | Low | High | Test with production data volume, have AWS RDS fallback plan |
| R9 | BullMQ pipeline takes longer than legacy PHP pipeline | Medium | Low | Benchmark during Phase 5, optimize concurrency settings |
| R10 | Third-party integrations (Slack, Teams, Google) require re-auth | High | Low | Notify users, provide clear re-connection flow in settings |

### 8.2 Operational Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R11 | Cutover takes longer than 4-hour window | Medium | Medium | Practice cutover on staging first, have extended window available |
| R12 | Users encounter issues during business hours | Medium | High | Schedule cutover for low-traffic window (02:00-06:00 UTC Saturday) |
| R13 | DNS propagation delays cause intermittent issues | Low | Medium | Lower TTL 24h before, test from multiple locations |
| R14 | Rollback is needed but legacy is already degraded | Low | Critical | Keep legacy fully running for 7 days post-cutover |

### 8.3 Risk Acceptance

| Decision | Risk Accepted | Rationale |
|----------|--------------|-----------|
| Share links expire after 90 days post-migration | Users may need to recreate | Security fix (BR-045, BR-046) — legacy shares were permanent admin access |
| Integration tokens require re-auth | Minor user friction | Tokens stored with new encryption, old tokens incompatible |
| Computed data recomputed (not migrated) | Slight differences possible | New pipeline may produce more correct results |
| Legacy system offline after 7 days | Rollback becomes harder | 7 days is sufficient validation window |

---

## Cross-References

- **Domain Model:** `docs/design/01-domain-model.md` — Target PostgreSQL schema (Section 5: migration path)
- **System Architecture:** `docs/design/02-system-architecture.md` — Section 8 (deployment), Section 9 (security fixes)
- **API Contracts:** `docs/design/03-api-contracts.md` — All 70 endpoints that must work before cutover
- **Frontend Architecture:** `docs/design/04-frontend-architecture.md` — Pages that must reach feature parity
- **Ingestion Pipeline:** `docs/design/05-ingestion-pipeline.md` — Pipeline that must be operational before cutover
- **Security Vulnerabilities:** `docs/analysis/07-cross-application-summary.md` — S-01 through S-30 (all resolved by design)
- **Business Rules:** `docs/analysis/07-cross-application-summary.md` — BR-001 through BR-065 (all implemented)

---

**Document Status:** Complete  
**Stage B Status:** All 6 design documents complete.

### Stage B Deliverables Summary

| Document | File | Lines | Status |
|----------|------|-------|--------|
| 01 Domain Model & Database Design | `01-domain-model.md` | 4,234 | ✅ Complete |
| 02 System Architecture | `02-system-architecture.md` | ~2,200 | ✅ Complete |
| 03 API Contracts | `03-api-contracts.md` | 2,847 | ✅ Complete |
| 04 Frontend Architecture | `04-frontend-architecture.md` | ~1,200 | ✅ Complete |
| 05 Ingestion Pipeline | `05-ingestion-pipeline.md` | 1,431 | ✅ Complete |
| 06 Migration Strategy | `06-migration-strategy.md` | ~1,400 | ✅ Complete |

**Next:** Stage C — Implementation
