# PatenTrack3 Domain Model & Database Design

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-08  
**Status:** Draft

---

## Table of Contents

1. [Domain Model Overview](#1-domain-model-overview)
2. [Consolidated Schema Design](#2-consolidated-schema-design)
3. [Migration Path](#3-migration-path)
4. [Business Rule Preservation Matrix](#4-business-rule-preservation-matrix)
5. [Enum and Lookup Definitions](#5-enum-and-lookup-definitions)
6. [Index Strategy](#6-index-strategy)
7. [Data Integrity Constraints](#7-data-integrity-constraints)

---

## Executive Summary

This document consolidates PatenTrack's current **9-database architecture** into a **single unified PostgreSQL schema** while preserving all **65 business rules** (BR-001 through BR-065).

### Current State
- **9 separate databases**: `db_uspto`, `db_business`, `db_new_application`, `db_patent_grant_bibliographic`, `db_patent_application_bibliographic`, `db_patent_maintainence_fee`, `db_inventor`, `big_data`, and N × `db_{orgId}{uniqid}` per-customer databases
- **Database-per-tenant architecture** for customer isolation
- **50M+ assignments**, **200M+ document IDs**, **30M+ inventors**
- **388 API endpoints** → consolidating to ~80
- **17 external data sources** with varying schedules

### Target State
- **Single PostgreSQL database** with multi-tenant Row-Level Security (RLS)
- **UUID primary keys** for all tables
- **Soft deletes** with `deleted_at` timestamps
- **Audit columns** on every table
- **Prisma/Drizzle ORM compatible** schema
- **Scale targets**: 50M+ assignments, 200M+ document IDs, <100 tenants

---

## 1. Domain Model Overview

The domain is organized into **4 bounded contexts** representing distinct business capabilities:


### 1.1 Context 1 — Patent Data (USPTO Source)

Core domain for patent assignment and bibliographic data ingested from USPTO sources.

```mermaid
erDiagram
    PATENT ||--o{ DOCUMENT_ID : "identified_by"
    PATENT ||--o{ PATENT_CPC : "classified_by"
    PATENT ||--o{ MAINTENANCE_FEE_EVENT : "has_fees"
    PATENT ||--o{ INVENTOR : "invented_by"
    PATENT ||--o{ PATENT_FAMILY_MEMBER : "member_of"
    
    ASSIGNMENT ||--o{ DOCUMENT_ID : "affects"
    ASSIGNMENT ||--o{ ASSIGNOR : "from"
    ASSIGNMENT ||--o{ ASSIGNEE : "to"
    ASSIGNMENT ||--|| ASSIGNMENT_CONVEYANCE : "classified_as"
    
    ASSIGNOR ||--|| ENTITY : "is_entity"
    ASSIGNEE ||--|| ENTITY : "is_entity"
    
    ENTITY ||--|| REPRESENTATIVE : "canonical_name"
    
    CPC_CLASSIFICATION ||--o{ PATENT_CPC : "classifies"
    CPC_CLASSIFICATION ||--o{ CPC_CLASSIFICATION : "parent"
    
    PATENT_FAMILY ||--o{ PATENT_FAMILY_MEMBER : "contains"

    PATENT {
        uuid id PK
        string appno_doc_num UK "Application number"
        string grant_doc_num UK "Grant number"
        date appno_date
        date grant_date
        string pgpub_doc_num "Publication number"
        string title
        int layout_id "14=app only, 15=standard"
        timestamp created_at
        timestamp updated_at
    }
    
    ASSIGNMENT {
        uuid id PK
        string rf_id UK "Reel/frame ID from USPTO"
        string reel_no
        string frame_no
        text convey_text "Raw conveyance text"
        date record_dt "Recording date"
        date exec_dt "Execution date"
        string cname "Correspondent name"
        int page_count
        string status "active/void"
        timestamp created_at
        timestamp updated_at
    }
    
    DOCUMENT_ID {
        uuid id PK
        uuid assignment_id FK
        string appno_doc_num
        string grant_doc_num
        string pgpub_doc_num
        string title
        date appno_date
        date grant_date
    }
    
    ASSIGNOR {
        uuid id PK
        uuid assignment_id FK
        uuid entity_id FK
        string or_name "Original name as recorded"
        date exec_dt "Execution date"
    }
    
    ASSIGNEE {
        uuid id PK
        uuid assignment_id FK
        uuid entity_id FK
        string ee_name "Original name as recorded"
        string ee_address_1
        string ee_address_2
        string ee_city
        string ee_state
        string ee_postcode
        string ee_country
    }
    
    ENTITY {
        uuid id PK
        string name UK "Normalized entity name"
        int instances "Occurrence count"
        uuid representative_id FK
        timestamp created_at
        timestamp updated_at
    }
    
    REPRESENTATIVE {
        uuid id PK
        string representative_name UK "Canonical name"
        int total_instances "Sum of all entity instances"
        timestamp created_at
        timestamp updated_at
    }
    
    ASSIGNMENT_CONVEYANCE {
        uuid id PK
        uuid assignment_id FK UK
        string convey_ty "assignment/employee/merger/etc"
        boolean employer_assign "Is employee assignment"
        timestamp created_at
    }
    
    PATENT_CPC {
        uuid id PK
        string patent_doc_num FK "appno_doc_num or grant_doc_num"
        string patent_type "application/grant"
        uuid cpc_classification_id FK
        string cpc_code "e.g., H04L29/06"
        int cpc_level "1-9, depth in hierarchy"
    }
    
    CPC_CLASSIFICATION {
        uuid id PK
        string cpc_code UK "Full CPC code"
        string section "A-H"
        string class "01-99"
        string subclass "A-Z"
        string group "1-9999"
        string subgroup "00-9999"
        uuid parent_id FK "Self-reference"
        string title
        int level "1-9"
    }
    
    MAINTENANCE_FEE_EVENT {
        uuid id PK
        string grant_doc_num FK
        string event_code "M1,M2,M3,etc"
        date event_date
        decimal fee_amount
        timestamp created_at
    }
    
    INVENTOR {
        uuid id PK
        string patent_doc_num "appno_doc_num or grant_doc_num"
        string patent_type "application/grant"
        uuid entity_id FK "Link to entity if matched"
        string name "Original inventor name"
        string canonical_name "Normalized name"
        string city
        string state
        string country
        int sequence "Order in patent"
    }
    
    PATENT_FAMILY {
        uuid id PK
        string family_id UK "EPO family ID"
        string family_type "simple/extended"
        timestamp created_at
    }
    
    PATENT_FAMILY_MEMBER {
        uuid id PK
        uuid patent_family_id FK
        string doc_num "Patent number"
        string country_code
        string kind_code
        date publication_date
    }
```

**Key Design Decisions:**

1. **Patent Identification**: Patents identified by both `appno_doc_num` (application) and `grant_doc_num` (grant). A single patent can have both if granted, or only application if pending.

2. **Assignment Document Model**: 
   - `assignment` = header record (rf_id, dates, text)
   - `document_id` = join table linking assignments to patents (many-to-many)
   - One assignment can affect multiple patents; one patent can have multiple assignments

3. **Entity Resolution**:
   - `assignor`/`assignee` → `entity` → `representative`
   - Levenshtein matching creates `entity` records
   - Canonical grouping creates `representative` records
   - Preserves original names at assignor/assignee level

4. **CPC Classification**: Hierarchical self-referencing tree with denormalized code components for efficient querying.

5. **Data Volumes**:
   - Assignments: 50M+ rows
   - Document IDs: 200M+ rows (4:1 ratio to assignments)
   - Inventors: 70M+ rows (30M grant + 40M application)
   - CPC Classifications: ~300K nodes in hierarchy

---

### 1.2 Context 2 — Organization Intelligence (Derived/Computed)

Computed domain representing ownership analysis, chain-of-title validation, and dashboard metrics.

```mermaid
erDiagram
    ORGANIZATION ||--o{ OWNERSHIP_TREE_NODE : "owns"
    REPRESENTATIVE ||--o{ OWNERSHIP_TREE_NODE : "root_entity"
    OWNERSHIP_TREE_NODE ||--o{ OWNERSHIP_TREE_NODE : "parent"
    
    ORGANIZATION ||--o{ DASHBOARD_ITEM : "has"
    REPRESENTATIVE ||--o{ DASHBOARD_ITEM : "for_entity"
    
    ORGANIZATION ||--o{ TIMELINE_ENTRY : "has"
    ORGANIZATION ||--o{ SUMMARY_METRIC : "has"
    
    ASSIGNMENT ||--o{ TIMELINE_ENTRY : "source"
    ASSIGNMENT ||--o{ DASHBOARD_ITEM : "source"

    OWNERSHIP_TREE_NODE {
        uuid id PK
        uuid organization_id FK
        uuid representative_id FK "Root entity"
        uuid entity_id FK "This node's entity"
        string name "Entity name"
        uuid parent_id FK "Self-reference"
        int tree_type "0-13: employee/purchase/sale/etc"
        int tree_tab "0-3: grouping for UI"
        string color "red/blue/orange/green/yellow"
        int depth "Tree depth from root"
        timestamp created_at
        timestamp updated_at
    }
    
    BROKEN_TITLE_CHAIN {
        uuid id PK
        uuid organization_id FK
        string patent_doc_num "appno_doc_num or grant_doc_num"
        uuid current_owner_id FK "Entity ID"
        uuid break_point_assignment_id FK "Where chain broke"
        text reason "e.g., missing link, non-continuous"
        boolean has_employee_start "Chain starts with employee"
        timestamp detected_at
        timestamp created_at
    }
    
    DASHBOARD_ITEM {
        uuid id PK
        uuid organization_id FK
        uuid representative_id FK
        uuid entity_id FK "assignor_and_assignee_id"
        int type "0=complete,1=broken,18=encumbrance,20=lawfirm,30-36=bank"
        string patent "grant_doc_num"
        string application "appno_doc_num"
        uuid assignment_id FK "rf_id"
        int total "Count metric"
        string lawfirm "Law firm name"
        uuid lawfirm_id FK
        timestamp created_at
    }
    
    DASHBOARD_ITEM_COUNT {
        uuid id PK
        uuid organization_id FK
        uuid representative_id FK
        uuid entity_id FK
        int type "Dashboard type"
        int number "Primary count"
        int other_number "Secondary count"
        int total "Sum"
        text other "JSON metadata"
        timestamp created_at
    }
    
    TIMELINE_ENTRY {
        uuid id PK
        uuid organization_id FK
        uuid representative_id FK
        uuid assignment_id FK
        string rf_id "Reel/frame ID"
        string reel_no
        string frame_no
        date record_dt "Recording date"
        date exec_dt "Execution date"
        string type "assignment/employee/merger/etc"
        string original_name "Party name"
        uuid entity_id FK
        string convey_ty "Transaction type"
        boolean employer_assign
        int sequence "Display order"
        timestamp created_at
    }
    
    SUMMARY_METRIC {
        uuid id PK
        uuid organization_id FK
        uuid representative_id FK "NULL for org-level"
        int company_count "Number of companies"
        int activity_count "Number of activities"
        int entity_count "Number of entities"
        int party_count "Number of parties"
        int employee_count "Number of employee assignments"
        int transaction_count "Number of transactions"
        int asset_count "Number of assets"
        int arrow_count "Number of ownership arrows"
        jsonb metadata "Additional metrics"
        timestamp calculated_at
        timestamp created_at
    }
```

**Key Design Decisions:**

1. **Ownership Trees**: 
   - Materialized view of entity relationships
   - Tree type (0-13) determines transaction category (employee, purchase, sale, merger, security, release, administrative)
   - Tab (0-3) groups types for UI rendering
   - Color coding for visual distinction (BR-031)
   - Regenerated when new assignments arrive

2. **Broken Title Chains**:
   - Separate table for explicit tracking
   - Records break point and reason
   - CPU-intensive detection warrants materialization
   - Links to specific assignment where chain broke

3. **Dashboard Items**:
   - Pre-aggregated for fast dashboard loads (10-30 queries → target <5)
   - Type codes: 0=complete chain, 1=broken, 18=encumbrance, 20=law firms, 30-36=bank transactions
   - Organization + representative scoped
   - Regenerated daily or on-demand

4. **Timeline**: 
   - Chronological view of all organization transactions
   - Denormalized for query performance
   - Sequence field for custom ordering

5. **Summary Metrics**:
   - Pre-calculated counts for dashboard header
   - Organization-level (representative_id = NULL, uses company_id = 0 in legacy)
   - Representative-level for drill-down
   - JSONB metadata for extensibility

**Materialization Strategy:**
- **Stored (materialized)**: Trees, broken title chains, dashboard items, summaries
  - Rationale: CPU-intensive chain traversal, shown on every login, changes only when new data arrives
- **Computed on-demand**: Activity groupings, filtered views
  - Rationale: Simple aggregations, user-specific filters

---

### 1.3 Context 3 — Multi-Tenant Platform

Multi-tenant SaaS platform with organization management, user authentication, and integrations.

```mermaid
erDiagram
    ORGANIZATION ||--o{ USER : "has"
    ORGANIZATION ||--o{ CUSTOMER_CONFIGURATION : "configured_by"
    ORGANIZATION ||--o{ SHARE_LINK : "creates"
    ORGANIZATION ||--o{ INTEGRATION : "connects"
    ORGANIZATION ||--o{ ASSET : "owns"
    
    USER ||--o{ ACTIVITY : "performs"
    USER ||--o{ COMMENT : "creates"
    USER ||--o{ COLLECTION : "manages"
    
    SHARE_LINK ||--o{ SHARE_ACCESS_LOG : "tracks"
    
    REPRESENTATIVE ||--o{ ASSET : "owns_patents"

    ORGANIZATION {
        uuid id PK
        string name UK
        string slug UK "URL-safe identifier"
        uuid representative_id FK "Primary entity"
        string status "active/suspended/trial"
        timestamp trial_ends_at
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    
    USER {
        uuid id PK
        uuid organization_id FK
        string email UK
        string username UK
        string password_hash "bcrypt, salt factor 12"
        string first_name
        string last_name
        int role_type "0/1=admin, 9=super_admin, NULL=regular"
        string status "active/inactive/pending"
        string email_verification_token "6 hex chars"
        timestamp email_verified_at
        string password_reset_token "40 hex chars"
        timestamp password_reset_expires_at
        timestamp last_login_at
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
        uuid created_by FK
        uuid updated_by FK
    }
    
    CUSTOMER_CONFIGURATION {
        uuid id PK
        uuid organization_id FK UK
        string environment_mode "PRO/KPI/DASHBOARD/SAMPLE/STANDARD"
        jsonb feature_flags "Enabled features"
        jsonb ui_settings "Theme, layout preferences"
        int default_layout_id "14 or 15"
        date filter_date_from "Default filter (e.g., 1999)"
        jsonb api_limits "Rate limits, quotas"
        timestamp created_at
        timestamp updated_at
    }
    
    SHARE_LINK {
        uuid id PK
        uuid organization_id FK
        string share_code UK "CUID2, 24-32 chars"
        string resource_type "patent/timeline/dashboard"
        string resource_id "Patent number or entity ID"
        string access_scope "read_only/full_admin"
        timestamp expires_at "NULL = no expiry (VULNERABILITY)"
        int max_uses "NULL = unlimited (VULNERABILITY)"
        int use_count "Track usage"
        uuid created_by FK
        timestamp created_at
        timestamp deleted_at
    }
    
    SHARE_ACCESS_LOG {
        uuid id PK
        uuid share_link_id FK
        string ip_address "Visitor IP"
        string user_agent
        timestamp accessed_at
    }
    
    INTEGRATION {
        uuid id PK
        uuid organization_id FK
        string provider "slack/teams/google_drive"
        string access_token_encrypted
        string refresh_token_encrypted
        jsonb config "Provider-specific settings"
        string status "active/error/disabled"
        timestamp last_sync_at
        timestamp created_at
        timestamp updated_at
    }
    
    ASSET {
        uuid id PK
        uuid organization_id FK
        uuid representative_id FK "Owner entity"
        string appno_doc_num
        string grant_doc_num
        int layout_id "14=app_only, 15=standard"
        uuid company_id FK "Legacy: internal company grouping"
        jsonb metadata "Additional asset data"
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    
    ACTIVITY {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        uuid professional_id FK "Related entity"
        string subject "Activity title"
        text comment
        int activity_type "1-16, grouped per BR-038"
        string subject_type "patent/entity/transaction"
        string document_id "Related patent/doc"
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    
    COMMENT {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        string resource_type "patent/transaction/entity"
        string resource_id
        text content
        uuid parent_id FK "For threaded comments"
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    
    COLLECTION {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        string name
        text description
        string collection_type "patents/entities/mixed"
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    
    COLLECTION_ITEM {
        uuid id PK
        uuid collection_id FK
        string item_type "patent/entity"
        string item_id "Patent number or entity ID"
        int sequence "Display order"
        timestamp added_at
    }
```

**Key Design Decisions:**

1. **Multi-Tenancy Strategy**: 
   - **Shared schema with Row-Level Security (RLS)**
   - Rationale:
     - <100 tenants (not thousands) → shared schema is manageable
     - Simplified operations (single database, migrations, backups)
     - Cost-effective for moderate scale
     - RLS provides security isolation at database level
     - Prisma/Drizzle ORM support for RLS policies
   - Alternative considered: Database-per-tenant (current architecture)
     - Rejected due to: operational complexity, migration overhead, connection pool limits

2. **Row-Level Security Policies**:
   ```sql
   -- Example RLS policy
   CREATE POLICY org_isolation ON users
     USING (organization_id = current_setting('app.current_org_id')::uuid);
   ```

3. **Share Links**:
   - Fixed BR-045: Scope to `read_only` instead of `full_admin` JWT
   - Fixed BR-046: Add `expires_at` and `max_uses` limits
   - CUID2 for cryptographically secure share codes
   - Access logging for security audit trail

4. **User Roles** (BR-048, BR-049):
   - `role_type`: NULL=regular user, 0/1=admin, 9=super_admin
   - Super admin: system-wide access (cross-org)
   - Admin: full organization access
   - Regular: scoped by RLS + application-level permissions

5. **Soft Deletes**: All tenant-facing tables have `deleted_at` for audit trail and recovery.

6. **Audit Trail**: `created_by`, `updated_by`, `created_at`, `updated_at` on all mutable tables.

---

### 1.4 Context 4 — Ingestion & Processing

Data ingestion pipeline and processing state management.

```mermaid
erDiagram
    DATA_SOURCE ||--o{ INGESTION_JOB : "has"
    INGESTION_JOB ||--o{ INGESTION_ERROR : "records"
    ORGANIZATION ||--o{ PROCESSING_JOB : "triggers"
    PROCESSING_JOB ||--o{ PROCESSING_STEP : "contains"

    DATA_SOURCE {
        uuid id PK
        string name UK "USPTO_BULK_GRANTS, etc"
        string source_type "bulk_download/api/file_system"
        string schedule_type "daily/weekly/monthly/on_demand"
        string schedule_cron "Cron expression"
        string endpoint_url
        jsonb auth_config "API keys, OAuth tokens (encrypted)"
        string file_pattern "Glob pattern for files"
        string format "xml/json/pdf/tab_delimited"
        boolean is_active
        timestamp last_run_at
        timestamp next_run_at
        timestamp created_at
        timestamp updated_at
    }
    
    INGESTION_JOB {
        uuid id PK
        uuid data_source_id FK
        string status "pending/running/success/failed"
        timestamp started_at
        timestamp completed_at
        int records_processed
        int records_inserted
        int records_updated
        int records_failed
        string file_name "Downloaded file"
        bigint file_size_bytes
        jsonb metadata "Source-specific data"
        text error_message
        timestamp created_at
    }
    
    INGESTION_ERROR {
        uuid id PK
        uuid ingestion_job_id FK
        string record_identifier "rf_id, patent number, etc"
        string error_type "validation/parse/duplicate/constraint"
        text error_message
        jsonb raw_data "Failed record data"
        timestamp created_at
    }
    
    PROCESSING_JOB {
        uuid id PK
        uuid organization_id FK
        string job_type "full_rebuild/incremental/manual"
        string status "pending/running/success/failed"
        int current_step "1-8"
        timestamp started_at
        timestamp completed_at
        jsonb summary "Step durations, records processed"
        text error_message
        uuid triggered_by FK "User ID"
        timestamp created_at
    }
    
    PROCESSING_STEP {
        uuid id PK
        uuid processing_job_id FK
        int step_number "1-8"
        string step_name "classify/flag/tree/timeline/broken_title/dashboard/summary/generate_json"
        string status "pending/running/success/failed/skipped"
        timestamp started_at
        timestamp completed_at
        int records_processed
        text error_message
        jsonb metrics "Step-specific metrics"
        timestamp created_at
    }
```

**Key Design Decisions:**

1. **Data Source Registry**: 
   - 17 external sources configured as data
   - Schedule managed at database level (cron expressions)
   - Auth credentials encrypted at rest
   - Supports BR-054 through BR-059 (source-specific rules)

2. **Ingestion Jobs**:
   - Each download/API call = one job
   - Tracks volume metrics (processed, inserted, updated, failed)
   - Error records stored separately for retry/analysis
   - Immutable once completed (temporal record)

3. **Processing Pipeline** (BR-060):
   - 8-step customer data pipeline
   - Steps: classify → flag → tree → timeline → broken_title → dashboard → summary → generate_json
   - Per-organization processing
   - Tracks step-level status and metrics
   - Can be triggered: automatically (new data), manually (admin), incrementally (delta)

4. **Error Handling**:
   - Separate error table for failed records
   - Preserves raw data for debugging
   - Enables selective retry without re-running entire job

5. **Idempotency**:
   - `INSERT ... ON CONFLICT DO NOTHING` for duplicate handling (BR-059)
   - Job records never deleted (soft delete for data lineage)

---

## 2. Consolidated Schema Design


This section provides complete PostgreSQL DDL for all tables, mapping legacy databases to the new unified schema.

### 2.1 Core Patent Data Tables

#### Table: `patents`

**Purpose**: Unified patent record (grants + applications)

**Legacy Sources**:
- `db_patent_grant_bibliographic.grant_application`
- `db_patent_application_bibliographic.*` (inferred from applications)
- `db_uspto.documentid` (patent identifiers)

```sql
CREATE TABLE patents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appno_doc_num VARCHAR(20) UNIQUE,
    grant_doc_num VARCHAR(20) UNIQUE,
    pgpub_doc_num VARCHAR(20),
    title TEXT,
    appno_date DATE,
    grant_date DATE,
    layout_id INTEGER DEFAULT 15 CHECK (layout_id IN (14, 15)),
    -- 14 = application only, 15 = standard (grant or grant+app)
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT patent_has_identifier CHECK (
        appno_doc_num IS NOT NULL OR grant_doc_num IS NOT NULL
    )
);

CREATE INDEX idx_patents_appno ON patents(appno_doc_num) WHERE appno_doc_num IS NOT NULL;
CREATE INDEX idx_patents_grant ON patents(grant_doc_num) WHERE grant_doc_num IS NOT NULL;
CREATE INDEX idx_patents_appno_date ON patents(appno_date) WHERE appno_date > '1999-01-01';
CREATE INDEX idx_patents_layout ON patents(layout_id);
```

---

#### Table: `assignments`

**Purpose**: USPTO patent assignment documents (reel/frame records)

**Legacy Sources**:
- `db_uspto.assignment`

**Scale**: 50M+ rows

```sql
CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rf_id VARCHAR(50) UNIQUE NOT NULL, -- USPTO reel/frame identifier
    reel_no VARCHAR(20),
    frame_no VARCHAR(20),
    convey_text TEXT, -- Raw conveyance text from USPTO
    record_dt DATE, -- Recording date
    exec_dt DATE, -- Execution date
    cname VARCHAR(500), -- Correspondent name
    page_count INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'void')),
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_rf_id ON assignments(rf_id);
CREATE INDEX idx_assignments_record_dt ON assignments(record_dt DESC);
CREATE INDEX idx_assignments_status ON assignments(status);

-- Partitioning strategy for 50M+ rows
-- Partition by record_dt (yearly partitions)
-- This will be implemented during migration
```

---

#### Table: `document_ids`

**Purpose**: Join table linking assignments to patents (many-to-many)

**Legacy Sources**:
- `db_uspto.documentid`

**Scale**: 200M+ rows (4:1 ratio to assignments)

```sql
CREATE TABLE document_ids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    appno_doc_num VARCHAR(20),
    grant_doc_num VARCHAR(20),
    pgpub_doc_num VARCHAR(20),
    title TEXT,
    appno_date DATE,
    grant_date DATE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- At least one patent identifier required
    CONSTRAINT has_patent_id CHECK (
        appno_doc_num IS NOT NULL OR grant_doc_num IS NOT NULL
    )
);

CREATE INDEX idx_document_ids_assignment ON document_ids(assignment_id);
CREATE INDEX idx_document_ids_appno ON document_ids(appno_doc_num) WHERE appno_doc_num IS NOT NULL;
CREATE INDEX idx_document_ids_grant ON document_ids(grant_doc_num) WHERE grant_doc_num IS NOT NULL;
CREATE INDEX idx_document_ids_appno_date ON document_ids(appno_date) WHERE appno_date > '1999-01-01';

-- Composite index for common join pattern
CREATE INDEX idx_document_ids_composite ON document_ids(assignment_id, grant_doc_num, appno_doc_num);

-- Partitioning by assignment record year (via JOIN to assignments)
-- This will be co-located with assignments partitions
```

---

#### Table: `entities`

**Purpose**: Normalized entity names (assignors + assignees)

**Legacy Sources**:
- `db_uspto.assignor_and_assignee`

**Scale**: 5M+ unique entities

```sql
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(500) NOT NULL,
    instances INTEGER DEFAULT 1, -- Occurrence count
    representative_id UUID REFERENCES representatives(id),
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_entities_name ON entities(LOWER(name));
CREATE INDEX idx_entities_representative ON entities(representative_id);
CREATE INDEX idx_entities_instances ON entities(instances DESC);

-- Full-text search on entity names
CREATE INDEX idx_entities_name_fts ON entities USING gin(to_tsvector('english', name));
```

---

#### Table: `representatives`

**Purpose**: Canonical entity names (Levenshtein-matched groups)

**Legacy Sources**:
- `db_uspto.representative`

**Scale**: 2M+ representatives

```sql
CREATE TABLE representatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    representative_name VARCHAR(500) UNIQUE NOT NULL,
    total_instances INTEGER DEFAULT 0, -- Sum of all linked entity instances
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_representatives_name ON representatives(LOWER(representative_name));
CREATE INDEX idx_representatives_instances ON representatives(total_instances DESC);

-- Full-text search on representative names
CREATE INDEX idx_representatives_name_fts ON representatives USING gin(to_tsvector('english', representative_name));
```

---

#### Table: `assignors`

**Purpose**: Assignment grantors (from entity)

**Legacy Sources**:
- `db_uspto.assignor`

```sql
CREATE TABLE assignors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id),
    or_name VARCHAR(500) NOT NULL, -- Original name as recorded
    exec_dt DATE, -- Execution date
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignors_assignment ON assignors(assignment_id);
CREATE INDEX idx_assignors_entity ON assignors(entity_id);
CREATE INDEX idx_assignors_composite ON assignors(assignment_id, entity_id);
```

---

#### Table: `assignees`

**Purpose**: Assignment grantees (to entity)

**Legacy Sources**:
- `db_uspto.assignee`

```sql
CREATE TABLE assignees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id),
    ee_name VARCHAR(500) NOT NULL, -- Original name as recorded
    ee_address_1 VARCHAR(500),
    ee_address_2 VARCHAR(500),
    ee_city VARCHAR(200),
    ee_state VARCHAR(100),
    ee_postcode VARCHAR(50),
    ee_country VARCHAR(100),
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignees_assignment ON assignees(assignment_id);
CREATE INDEX idx_assignees_entity ON assignees(entity_id);
CREATE INDEX idx_assignees_composite ON assignees(assignment_id, entity_id);
CREATE INDEX idx_assignees_location ON assignees(ee_country, ee_state, ee_city);
```

---

#### Table: `assignment_conveyances`

**Purpose**: Transaction type classification

**Legacy Sources**:
- `db_uspto.assignment_conveyance`
- `db_uspto.representative_assignment_conveyance`

```sql
CREATE TABLE assignment_conveyances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID UNIQUE NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    convey_ty VARCHAR(50) NOT NULL CHECK (convey_ty IN (
        'assignment', 'employee', 'merger', 'namechg', 'correct', 
        'govern', 'license', 'release', 'security', 'missing'
    )),
    employer_assign BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conveyances_assignment ON assignment_conveyances(assignment_id);
CREATE INDEX idx_conveyances_type ON assignment_conveyances(convey_ty);
CREATE INDEX idx_conveyances_employer ON assignment_conveyances(employer_assign) WHERE employer_assign = TRUE;
```

---

#### Table: `cpc_classifications`

**Purpose**: Cooperative Patent Classification hierarchy

**Legacy Sources**:
- EPO Linked Data SPARQL endpoint

**Scale**: ~300K classification codes

```sql
CREATE TABLE cpc_classifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cpc_code VARCHAR(50) UNIQUE NOT NULL, -- e.g., "H04L29/06"
    
    -- Denormalized components for querying
    section VARCHAR(1), -- A-H
    class VARCHAR(2), -- 01-99
    subclass VARCHAR(1), -- A-Z
    main_group VARCHAR(10), -- 1-9999
    subgroup VARCHAR(10), -- 00-9999
    
    parent_id UUID REFERENCES cpc_classifications(id),
    title TEXT,
    level INTEGER CHECK (level BETWEEN 1 AND 9), -- Hierarchy depth
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cpc_code ON cpc_classifications(cpc_code);
CREATE INDEX idx_cpc_parent ON cpc_classifications(parent_id);
CREATE INDEX idx_cpc_section ON cpc_classifications(section);
CREATE INDEX idx_cpc_class ON cpc_classifications(section, class);
CREATE INDEX idx_cpc_level ON cpc_classifications(level);

-- Tree traversal optimization
CREATE INDEX idx_cpc_tree ON cpc_classifications(parent_id, level, cpc_code);
```

---

#### Table: `patent_cpc_codes`

**Purpose**: Link patents to CPC classifications

**Legacy Sources**:
- `db_uspto.patent_cpc` (grants)
- `db_uspto.application_cpc` (applications)

```sql
CREATE TABLE patent_cpc_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patent_doc_num VARCHAR(20) NOT NULL, -- appno_doc_num or grant_doc_num
    patent_type VARCHAR(20) NOT NULL CHECK (patent_type IN ('application', 'grant')),
    cpc_classification_id UUID NOT NULL REFERENCES cpc_classifications(id),
    cpc_code VARCHAR(50) NOT NULL, -- Denormalized for performance
    cpc_level INTEGER, -- 1-9, depth in hierarchy
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patent_cpc_doc_num ON patent_cpc_codes(patent_doc_num, patent_type);
CREATE INDEX idx_patent_cpc_classification ON patent_cpc_codes(cpc_classification_id);
CREATE INDEX idx_patent_cpc_code ON patent_cpc_codes(cpc_code);
CREATE INDEX idx_patent_cpc_level ON patent_cpc_codes(cpc_level);

-- Composite for common query pattern
CREATE INDEX idx_patent_cpc_composite ON patent_cpc_codes(patent_doc_num, cpc_code, patent_type);
```

---

#### Table: `inventors`

**Purpose**: Inventor information from grants and applications

**Legacy Sources**:
- `db_patent_grant_bibliographic.inventor`
- `db_patent_application_bibliographic.inventor`
- `db_inventor.inventors` (canonical names)

**Scale**: 70M+ rows (30M grant + 40M application)

```sql
CREATE TABLE inventors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patent_doc_num VARCHAR(20) NOT NULL, -- appno_doc_num or grant_doc_num
    patent_type VARCHAR(20) NOT NULL CHECK (patent_type IN ('application', 'grant')),
    entity_id UUID REFERENCES entities(id), -- NULL until matched
    
    -- Original inventor data
    name VARCHAR(500) NOT NULL,
    canonical_name VARCHAR(500), -- Normalized name
    city VARCHAR(200),
    state VARCHAR(100),
    country VARCHAR(100),
    sequence INTEGER, -- Order in patent
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventors_patent ON inventors(patent_doc_num, patent_type);
CREATE INDEX idx_inventors_entity ON inventors(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_inventors_name ON inventors(canonical_name);
CREATE INDEX idx_inventors_location ON inventors(country, state, city);

-- Full-text search on inventor names
CREATE INDEX idx_inventors_name_fts ON inventors USING gin(to_tsvector('english', canonical_name));
```

---

#### Table: `maintenance_fee_events`

**Purpose**: USPTO maintenance fee payment tracking

**Legacy Sources**:
- `db_patent_maintainence_fee.event_maintainence_fees`

**Scale**: Millions of events

```sql
CREATE TABLE maintenance_fee_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grant_doc_num VARCHAR(20) NOT NULL,
    event_code VARCHAR(10) NOT NULL, -- M1, M2, M3, EXP, REI, etc.
    event_date DATE NOT NULL,
    fee_amount DECIMAL(10,2),
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maint_fee_grant ON maintenance_fee_events(grant_doc_num);
CREATE INDEX idx_maint_fee_event_code ON maintenance_fee_events(event_code);
CREATE INDEX idx_maint_fee_event_date ON maintenance_fee_events(event_date DESC);
CREATE INDEX idx_maint_fee_composite ON maintenance_fee_events(grant_doc_num, event_code, event_date);
```

---

#### Table: `patent_families`

**Purpose**: EPO patent family groupings

**Legacy Sources**:
- EPO OPS API

```sql
CREATE TABLE patent_families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id VARCHAR(50) UNIQUE NOT NULL, -- EPO family ID
    family_type VARCHAR(20) CHECK (family_type IN ('simple', 'extended')),
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patent_families_family_id ON patent_families(family_id);
```

---

#### Table: `patent_family_members`

**Purpose**: Patents in a family

**Legacy Sources**:
- EPO OPS API

```sql
CREATE TABLE patent_family_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patent_family_id UUID NOT NULL REFERENCES patent_families(id) ON DELETE CASCADE,
    doc_num VARCHAR(20) NOT NULL,
    country_code VARCHAR(2),
    kind_code VARCHAR(2),
    publication_date DATE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_family_members_family ON patent_family_members(patent_family_id);
CREATE INDEX idx_family_members_doc_num ON patent_family_members(doc_num);
CREATE INDEX idx_family_members_country ON patent_family_members(country_code);
```

---

### 2.2 Organization Intelligence Tables

#### Table: `organizations`

**Purpose**: Customer/tenant master

**Legacy Sources**:
- `db_business.organisation`

**Scale**: <100 organizations (tenants)

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(500) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL, -- URL-safe identifier
    representative_id UUID REFERENCES representatives(id), -- Primary tracked entity
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
    trial_ends_at TIMESTAMP,
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP -- Soft delete
);

CREATE UNIQUE INDEX idx_organizations_name ON organizations(LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_status ON organizations(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_representative ON organizations(representative_id);

-- Row-Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON organizations
    USING (id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY org_super_admin ON organizations
    USING (current_setting('app.user_role', true) = '9'); -- Super admin bypass
```

---

#### Table: `users`

**Purpose**: User accounts

**Legacy Sources**:
- Per-customer databases: `db_{orgId}{uniqid}.user`

**Scale**: Thousands of users across all tenants

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    email VARCHAR(500) NOT NULL,
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- bcrypt, salt factor 12
    
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    
    role_type INTEGER CHECK (role_type IN (0, 1, 9)), 
    -- NULL = regular user, 0/1 = admin, 9 = super admin
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('active', 'inactive', 'pending')),
    
    -- Email verification (BR-052)
    email_verification_token VARCHAR(6), -- 6 hex chars
    email_verified_at TIMESTAMP,
    
    -- Password reset (BR-053)
    password_reset_token VARCHAR(40), -- 40 hex chars
    password_reset_expires_at TIMESTAMP,
    
    last_login_at TIMESTAMP,
    
    -- Audit columns
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP, -- Soft delete
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_users_email ON users(LOWER(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_users_username ON users(organization_id, LOWER(username)) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_organization ON users(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_verification ON users(email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX idx_users_reset ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;

-- Row-Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_org_isolation ON users
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY user_super_admin ON users
    USING (current_setting('app.user_role', true) = '9');
```

---

#### Table: `customer_configurations`

**Purpose**: Per-organization settings

**Legacy Sources**:
- Implicit from per-customer database configurations

```sql
CREATE TABLE customer_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    environment_mode VARCHAR(50) DEFAULT 'STANDARD' CHECK (environment_mode IN (
        'PRO', 'KPI', 'DASHBOARD', 'SAMPLE', 'SAMPLE-1', 'STANDARD'
    )), -- BR-061
    
    feature_flags JSONB DEFAULT '{}', -- Feature toggles
    ui_settings JSONB DEFAULT '{}', -- Theme, layout preferences
    
    default_layout_id INTEGER DEFAULT 15 CHECK (default_layout_id IN (14, 15)),
    filter_date_from DATE DEFAULT '1999-01-01', -- BR-039
    
    api_limits JSONB DEFAULT '{"rate_limit": 1000, "quota_monthly": 100000}',
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_config_org ON customer_configurations(organization_id);

-- RLS
ALTER TABLE customer_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_org_isolation ON customer_configurations
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `ownership_tree_nodes`

**Purpose**: Ownership hierarchy visualization

**Legacy Sources**:
- `db_new_application.tree`
- Per-customer databases: `db_{orgId}{uniqid}.representative` (tree structure)

**Scale**: Millions of tree nodes across all organizations

```sql
CREATE TABLE ownership_tree_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID NOT NULL REFERENCES representatives(id), -- Root entity
    entity_id UUID NOT NULL REFERENCES entities(id), -- This node's entity
    
    name VARCHAR(500) NOT NULL, -- Denormalized for performance
    parent_id UUID REFERENCES ownership_tree_nodes(id), -- Self-reference
    
    tree_type INTEGER NOT NULL CHECK (tree_type BETWEEN 0 AND 13),
    -- 0/1=employee, 1=purchase, 2=sale, 3/4=merger, 5/6=security, 
    -- 7/8=release, 9-13=admin (namechg, govern, correct, missing, other)
    
    tree_tab INTEGER NOT NULL CHECK (tree_tab BETWEEN 0 AND 3),
    -- 0/1=employee/purchase/sale, 2=security/release, 3=administrative
    
    color VARCHAR(20), -- red, blue, orange, green, yellow (BR-031)
    depth INTEGER DEFAULT 0, -- Tree depth from root
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tree_organization ON ownership_tree_nodes(organization_id);
CREATE INDEX idx_tree_representative ON ownership_tree_nodes(representative_id);
CREATE INDEX idx_tree_entity ON ownership_tree_nodes(entity_id);
CREATE INDEX idx_tree_parent ON ownership_tree_nodes(parent_id);
CREATE INDEX idx_tree_type ON ownership_tree_nodes(tree_type);
CREATE INDEX idx_tree_tab ON ownership_tree_nodes(tree_tab);
CREATE INDEX idx_tree_composite ON ownership_tree_nodes(organization_id, representative_id, tree_tab);

-- Tree traversal optimization
CREATE INDEX idx_tree_path ON ownership_tree_nodes(parent_id, depth, id);

-- RLS
ALTER TABLE ownership_tree_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tree_org_isolation ON ownership_tree_nodes
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `broken_title_chains`

**Purpose**: Explicit tracking of ownership chain breaks

**Legacy Sources**:
- Implicit in `db_new_application.dashboard_items` (type=1)

```sql
CREATE TABLE broken_title_chains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    patent_doc_num VARCHAR(20) NOT NULL, -- appno_doc_num or grant_doc_num
    current_owner_id UUID REFERENCES entities(id),
    break_point_assignment_id UUID REFERENCES assignments(id),
    
    reason TEXT, -- e.g., "missing link between entities X and Y"
    has_employee_start BOOLEAN DEFAULT FALSE, -- Chain starts with employee assignment
    
    detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_broken_chains_org ON broken_title_chains(organization_id);
CREATE INDEX idx_broken_chains_patent ON broken_title_chains(patent_doc_num);
CREATE INDEX idx_broken_chains_owner ON broken_title_chains(current_owner_id);
CREATE INDEX idx_broken_chains_detected ON broken_title_chains(detected_at DESC);

-- RLS
ALTER TABLE broken_title_chains ENABLE ROW LEVEL SECURITY;

CREATE POLICY broken_chains_org_isolation ON broken_title_chains
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `dashboard_items`

**Purpose**: Pre-aggregated dashboard data

**Legacy Sources**:
- `db_new_application.dashboard_items`

```sql
CREATE TABLE dashboard_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID REFERENCES representatives(id),
    entity_id UUID REFERENCES entities(id),
    
    type INTEGER NOT NULL CHECK (type IN (0, 1, 18, 20, 30, 31, 32, 33, 34, 35, 36)),
    -- 0=complete chain, 1=broken, 18=encumbrance, 20=law firms, 30-36=bank
    
    patent VARCHAR(20), -- grant_doc_num
    application VARCHAR(20), -- appno_doc_num
    assignment_id UUID REFERENCES assignments(id),
    
    total INTEGER DEFAULT 0, -- Count metric
    lawfirm VARCHAR(500),
    lawfirm_id UUID,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dashboard_org ON dashboard_items(organization_id);
CREATE INDEX idx_dashboard_representative ON dashboard_items(representative_id);
CREATE INDEX idx_dashboard_entity ON dashboard_items(entity_id);
CREATE INDEX idx_dashboard_type ON dashboard_items(type);
CREATE INDEX idx_dashboard_composite ON dashboard_items(organization_id, representative_id, type);
CREATE INDEX idx_dashboard_assignment ON dashboard_items(assignment_id);

-- RLS
ALTER TABLE dashboard_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_org_isolation ON dashboard_items
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `timeline_entries`

**Purpose**: Chronological transaction timeline

**Legacy Sources**:
- `db_new_application.timeline`

```sql
CREATE TABLE timeline_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID REFERENCES representatives(id),
    assignment_id UUID NOT NULL REFERENCES assignments(id),
    
    rf_id VARCHAR(50) NOT NULL, -- Denormalized for performance
    reel_no VARCHAR(20),
    frame_no VARCHAR(20),
    
    record_dt DATE, -- Recording date
    exec_dt DATE, -- Execution date
    
    type VARCHAR(50) NOT NULL, -- assignment/employee/merger/etc
    original_name VARCHAR(500), -- Party name
    entity_id UUID REFERENCES entities(id),
    
    convey_ty VARCHAR(50),
    employer_assign BOOLEAN DEFAULT FALSE,
    
    sequence INTEGER, -- Display order
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timeline_org ON timeline_entries(organization_id);
CREATE INDEX idx_timeline_representative ON timeline_entries(representative_id);
CREATE INDEX idx_timeline_assignment ON timeline_entries(assignment_id);
CREATE INDEX idx_timeline_record_dt ON timeline_entries(record_dt DESC);
CREATE INDEX idx_timeline_sequence ON timeline_entries(sequence);
CREATE INDEX idx_timeline_composite ON timeline_entries(organization_id, representative_id, record_dt DESC);

-- RLS
ALTER TABLE timeline_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY timeline_org_isolation ON timeline_entries
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `summary_metrics`

**Purpose**: Pre-calculated dashboard summary counts

**Legacy Sources**:
- `db_new_application.summary`

```sql
CREATE TABLE summary_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID REFERENCES representatives(id), -- NULL for org-level (company_id=0)
    
    company_count INTEGER DEFAULT 0,
    activity_count INTEGER DEFAULT 0,
    entity_count INTEGER DEFAULT 0,
    party_count INTEGER DEFAULT 0,
    employee_count INTEGER DEFAULT 0,
    transaction_count INTEGER DEFAULT 0,
    asset_count INTEGER DEFAULT 0,
    arrow_count INTEGER DEFAULT 0,
    
    metadata JSONB DEFAULT '{}', -- Extensible metrics
    
    calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_summary_org_rep ON summary_metrics(organization_id, COALESCE(representative_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_summary_org ON summary_metrics(organization_id);
CREATE INDEX idx_summary_representative ON summary_metrics(representative_id) WHERE representative_id IS NOT NULL;
CREATE INDEX idx_summary_calculated ON summary_metrics(calculated_at DESC);

-- RLS
ALTER TABLE summary_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY summary_org_isolation ON summary_metrics
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `assets`

**Purpose**: Organization-owned patent assets

**Legacy Sources**:
- `db_new_application.assets`

```sql
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    representative_id UUID REFERENCES representatives(id), -- Owner entity
    
    appno_doc_num VARCHAR(20),
    grant_doc_num VARCHAR(20),
    
    layout_id INTEGER DEFAULT 15 CHECK (layout_id IN (14, 15)),
    company_id UUID, -- Legacy: internal company grouping
    
    metadata JSONB DEFAULT '{}', -- Additional asset data
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP, -- Soft delete
    
    CONSTRAINT asset_has_patent CHECK (
        appno_doc_num IS NOT NULL OR grant_doc_num IS NOT NULL
    )
);

CREATE INDEX idx_assets_org ON assets(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_representative ON assets(representative_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_appno ON assets(appno_doc_num) WHERE deleted_at IS NULL AND appno_doc_num IS NOT NULL;
CREATE INDEX idx_assets_grant ON assets(grant_doc_num) WHERE deleted_at IS NULL AND grant_doc_num IS NOT NULL;
CREATE INDEX idx_assets_layout ON assets(layout_id) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_org_isolation ON assets
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

### 2.3 Multi-Tenant Platform Tables

#### Table: `share_links`

**Purpose**: Secure share links with proper scoping (fixes BR-045, BR-046)

**Legacy Sources**:
- Share link functionality (not well-documented in schemas)

```sql
CREATE TABLE share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    share_code VARCHAR(32) UNIQUE NOT NULL, -- CUID2, cryptographically secure
    
    resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN (
        'patent', 'timeline', 'dashboard', 'tree', 'asset'
    )),
    resource_id VARCHAR(255) NOT NULL, -- Patent number, entity ID, etc.
    
    access_scope VARCHAR(20) NOT NULL DEFAULT 'read_only' CHECK (access_scope IN (
        'read_only', 'comment', 'annotate'
    )),
    -- FIXED BR-045: No longer 'full_admin'
    
    expires_at TIMESTAMP, -- FIXED BR-046: NULL still allowed but deprecated
    max_uses INTEGER, -- FIXED BR-046: NULL still allowed but deprecated
    use_count INTEGER DEFAULT 0,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP -- Soft delete for revocation
);

CREATE UNIQUE INDEX idx_share_code ON share_links(share_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_share_org ON share_links(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_share_resource ON share_links(resource_type, resource_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_share_expires ON share_links(expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL;
CREATE INDEX idx_share_created_by ON share_links(created_by);

-- RLS
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY share_org_isolation ON share_links
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `share_access_logs`

**Purpose**: Share link access tracking (BR-047)

```sql
CREATE TABLE share_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_link_id UUID NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    
    ip_address INET, -- Store as INET type for querying
    user_agent TEXT,
    
    accessed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_share_log_link ON share_access_logs(share_link_id);
CREATE INDEX idx_share_log_accessed ON share_access_logs(accessed_at DESC);
CREATE INDEX idx_share_log_ip ON share_access_logs(ip_address);

-- RLS: Share logs inherit organization via share_link JOIN
ALTER TABLE share_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY share_log_via_link ON share_access_logs
    USING (
        EXISTS (
            SELECT 1 FROM share_links
            WHERE share_links.id = share_access_logs.share_link_id
              AND share_links.organization_id = current_setting('app.current_org_id', true)::uuid
        )
    );
```

---

#### Table: `integrations`

**Purpose**: Third-party integrations (Slack, Teams, Google Drive)

**Legacy Sources**:
- Implicit from integration code

```sql
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    provider VARCHAR(50) NOT NULL CHECK (provider IN (
        'slack', 'microsoft_teams', 'google_drive', 'dropbox'
    )),
    
    access_token_encrypted TEXT, -- pgcrypto encrypted
    refresh_token_encrypted TEXT,
    
    config JSONB DEFAULT '{}', -- Provider-specific settings (webhook URLs, channels, etc.)
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'error', 'disabled')),
    last_sync_at TIMESTAMP,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integrations_org ON integrations(organization_id);
CREATE INDEX idx_integrations_provider ON integrations(provider);
CREATE INDEX idx_integrations_status ON integrations(status);

-- RLS
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY integrations_org_isolation ON integrations
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `activities`

**Purpose**: User activity tracking

**Legacy Sources**:
- Per-customer databases: `db_{orgId}{uniqid}.activity`

```sql
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    professional_id UUID REFERENCES entities(id), -- Related entity
    
    subject VARCHAR(500) NOT NULL, -- Activity title
    comment TEXT,
    
    activity_type INTEGER NOT NULL CHECK (activity_type BETWEEN 1 AND 16),
    -- BR-038: Activities 11,12,13,16 grouped as activity 5 in reporting
    
    subject_type VARCHAR(50) CHECK (subject_type IN ('patent', 'entity', 'transaction', 'asset')),
    document_id VARCHAR(255), -- Related patent/doc
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP -- Soft delete
);

CREATE INDEX idx_activities_org ON activities(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_activities_user ON activities(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_activities_professional ON activities(professional_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_activities_type ON activities(activity_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_activities_subject_type ON activities(subject_type, document_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_activities_created ON activities(created_at DESC) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_org_isolation ON activities
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `comments`

**Purpose**: Threaded comments on resources

**Legacy Sources**:
- Per-customer databases: `db_{orgId}{uniqid}.comment`

```sql
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN (
        'patent', 'transaction', 'entity', 'asset', 'activity'
    )),
    resource_id VARCHAR(255) NOT NULL,
    
    content TEXT NOT NULL,
    parent_id UUID REFERENCES comments(id), -- For threaded replies
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP -- Soft delete
);

CREATE INDEX idx_comments_org ON comments(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_user ON comments(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_resource ON comments(resource_type, resource_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_parent ON comments(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_created ON comments(created_at DESC) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_org_isolation ON comments
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `collections`

**Purpose**: User-created collections of patents/entities

**Legacy Sources**:
- Per-customer databases: `db_{orgId}{uniqid}.collection`

```sql
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    name VARCHAR(500) NOT NULL,
    description TEXT,
    collection_type VARCHAR(50) CHECK (collection_type IN ('patents', 'entities', 'mixed')),
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP -- Soft delete
);

CREATE INDEX idx_collections_org ON collections(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_user ON collections(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_type ON collections(collection_type) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY collections_org_isolation ON collections
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `collection_items`

**Purpose**: Items in collections

**Legacy Sources**:
- Per-customer databases: `db_{orgId}{uniqid}.collection_patent`, `collection_company`

```sql
CREATE TABLE collection_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    
    item_type VARCHAR(50) NOT NULL CHECK (item_type IN ('patent', 'entity', 'asset')),
    item_id VARCHAR(255) NOT NULL, -- Patent number, entity ID, etc.
    
    sequence INTEGER DEFAULT 0, -- Display order
    added_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX idx_collection_items_type_id ON collection_items(item_type, item_id);
CREATE INDEX idx_collection_items_sequence ON collection_items(collection_id, sequence);

-- Prevent duplicates in same collection
CREATE UNIQUE INDEX idx_collection_items_unique ON collection_items(collection_id, item_type, item_id);

-- RLS: Collection items inherit organization via collection JOIN
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_items_via_collection ON collection_items
    USING (
        EXISTS (
            SELECT 1 FROM collections
            WHERE collections.id = collection_items.collection_id
              AND collections.organization_id = current_setting('app.current_org_id', true)::uuid
        )
    );
```

---

### 2.4 Ingestion & Processing Tables

#### Table: `data_sources`

**Purpose**: External data source registry

**Legacy Sources**:
- `db_uspto.download_tracking` (partial)

**Scale**: 17 configured sources

```sql
CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL, -- e.g., 'USPTO_BULK_GRANTS'
    
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN (
        'bulk_download', 'rest_api', 'file_system', 'sparql'
    )),
    
    schedule_type VARCHAR(50) CHECK (schedule_type IN (
        'daily', 'weekly', 'monthly', 'on_demand'
    )),
    schedule_cron VARCHAR(100), -- Cron expression for automation
    
    endpoint_url TEXT,
    auth_config JSONB, -- API keys, OAuth tokens (encrypt in app layer)
    
    file_pattern VARCHAR(500), -- Glob pattern for downloads
    format VARCHAR(50) CHECK (format IN (
        'xml', 'json', 'pdf', 'tab_delimited', 'csv', 'tar', 'zip'
    )),
    
    is_active BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_data_sources_name ON data_sources(name);
CREATE INDEX idx_data_sources_active ON data_sources(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_data_sources_next_run ON data_sources(next_run_at) WHERE is_active = TRUE;
```

---

#### Table: `ingestion_jobs`

**Purpose**: Data ingestion job tracking

**Legacy Sources**:
- `db_uspto.download_tracking` (enhanced)

```sql
CREATE TABLE ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'running', 'success', 'failed', 'partial'
    )),
    
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    records_processed INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    
    file_name VARCHAR(500),
    file_size_bytes BIGINT,
    
    metadata JSONB DEFAULT '{}', -- Source-specific metadata
    error_message TEXT,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingestion_jobs_source ON ingestion_jobs(data_source_id);
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_started ON ingestion_jobs(started_at DESC);
CREATE INDEX idx_ingestion_jobs_completed ON ingestion_jobs(completed_at DESC);
```

---

#### Table: `ingestion_errors`

**Purpose**: Detailed error tracking for failed records

```sql
CREATE TABLE ingestion_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_job_id UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
    
    record_identifier VARCHAR(500), -- rf_id, patent number, etc.
    
    error_type VARCHAR(50) CHECK (error_type IN (
        'validation', 'parse', 'duplicate', 'constraint', 'foreign_key', 'other'
    )),
    error_message TEXT,
    
    raw_data JSONB, -- Failed record data for debugging
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingestion_errors_job ON ingestion_errors(ingestion_job_id);
CREATE INDEX idx_ingestion_errors_type ON ingestion_errors(error_type);
CREATE INDEX idx_ingestion_errors_identifier ON ingestion_errors(record_identifier);
```

---

#### Table: `processing_jobs`

**Purpose**: Customer data processing pipeline tracking

**Legacy Sources**:
- Implicit from PHP processing scripts

```sql
CREATE TABLE processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN (
        'full_rebuild', 'incremental', 'manual'
    )),
    
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'running', 'success', 'failed', 'partial'
    )),
    
    current_step INTEGER DEFAULT 0 CHECK (current_step BETWEEN 0 AND 8),
    -- 1=classify, 2=flag, 3=tree, 4=timeline, 5=broken_title, 6=dashboard, 7=summary, 8=generate_json
    
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    summary JSONB DEFAULT '{}', -- Step durations, records processed
    error_message TEXT,
    
    triggered_by UUID REFERENCES users(id), -- NULL for automatic jobs
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processing_jobs_org ON processing_jobs(organization_id);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX idx_processing_jobs_started ON processing_jobs(started_at DESC);
CREATE INDEX idx_processing_jobs_triggered_by ON processing_jobs(triggered_by);

-- RLS
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY processing_jobs_org_isolation ON processing_jobs
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

---

#### Table: `processing_steps`

**Purpose**: Individual step tracking within processing jobs

```sql
CREATE TABLE processing_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processing_job_id UUID NOT NULL REFERENCES processing_jobs(id) ON DELETE CASCADE,
    
    step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 8),
    step_name VARCHAR(50) NOT NULL CHECK (step_name IN (
        'classify', 'flag', 'tree', 'timeline', 'broken_title', 'dashboard', 'summary', 'generate_json'
    )),
    
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'running', 'success', 'failed', 'skipped'
    )),
    
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    metrics JSONB DEFAULT '{}', -- Step-specific metrics
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processing_steps_job ON processing_steps(processing_job_id);
CREATE INDEX idx_processing_steps_step_number ON processing_steps(step_number);
CREATE INDEX idx_processing_steps_status ON processing_steps(status);

-- Unique constraint: one step per job
CREATE UNIQUE INDEX idx_processing_steps_unique ON processing_steps(processing_job_id, step_number);

-- RLS: Steps inherit organization via processing_job JOIN
ALTER TABLE processing_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY processing_steps_via_job ON processing_steps
    USING (
        EXISTS (
            SELECT 1 FROM processing_jobs
            WHERE processing_jobs.id = processing_steps.processing_job_id
              AND processing_jobs.organization_id = current_setting('app.current_org_id', true)::uuid
        )
    );
```

---

## 3. Migration Path


This section documents the migration strategy from 9 legacy databases to the unified PostgreSQL schema.

### 3.1 Migration Overview

**Approach**: Phased migration with per-database validation

**Migration Order** (respecting FK dependencies):
1. Core Patent Data (no FK dependencies)
2. Bibliographic Data (references patents)
3. Organization & User Data (multi-tenant foundation)
4. Derived/Computed Data (depends on core + org)
5. Ingestion/Processing State (metadata, can be rebuilt)

**Timeline Estimate**: 4-6 weeks for full migration + validation

---

### 3.2 Phase 1: Core Patent Data Migration

#### Source: `db_uspto` → Target Schema

**Priority**: Critical path (all other data depends on this)

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `assignment` | `assignments` | - Generate UUIDs<br>- Keep `rf_id` as UK<br>- Map status values | 50M+ |
| `documentid` | `document_ids` | - Link to `assignments` via `rf_id`<br>- Create UUID FKs<br>- Denormalize patent identifiers | 200M+ |
| `assignor_and_assignee` | `entities` | - Generate UUIDs<br>- Link to `representatives` | 5M+ |
| `representative` | `representatives` | - Generate UUIDs<br>- Keep canonical names | 2M+ |
| `assignor` | `assignors` | - Link to `assignments` and `entities` via UUIDs | 75M+ |
| `assignee` | `assignees` | - Link to `assignments` and `entities` via UUIDs<br>- Preserve address data | 75M+ |
| `assignment_conveyance` | `assignment_conveyances` | - Link to `assignments` via UUID<br>- Validate `convey_ty` enum | 45M+ |
| `representative_assignment_conveyance` | `assignment_conveyances` | - Merge with above (same target)<br>- Prioritize representative-linked classifications | 10M+ |
| `patent_cpc` | `patent_cpc_codes` | - Link to `cpc_classifications`<br>- Set `patent_type='grant'` | 150M+ |
| `application_cpc` | `patent_cpc_codes` | - Link to `cpc_classifications`<br>- Set `patent_type='application'` | 200M+ |
| `bank_security_transactions` | `dashboard_items` + metadata | - Transform to `type=30-36`<br>- Link entities | 1M+ |
| `bank_release_transactions` | `dashboard_items` + metadata | - Link to security transactions<br>- type=release metadata | 500K+ |

**Migration Script Pattern**:
```sql
-- Example: Migrate assignments
INSERT INTO assignments (id, rf_id, reel_no, frame_no, convey_text, record_dt, exec_dt, cname, page_count, status, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    rf_id,
    reel_no,
    frame_no,
    convey_text,
    record_dt,
    exec_dt,
    cname,
    page_count,
    CASE WHEN status = 'active' THEN 'active' ELSE 'void' END,
    NOW(),
    NOW()
FROM db_uspto.assignment
ON CONFLICT (rf_id) DO NOTHING;

-- Create mapping table for UUID lookups
CREATE TEMP TABLE assignment_id_map AS
SELECT rf_id, id FROM assignments;
```

**Partitioning Strategy** for `assignments` and `document_ids`:
```sql
-- Partition assignments by recording year
CREATE TABLE assignments_2020 PARTITION OF assignments
    FOR VALUES FROM ('2020-01-01') TO ('2021-01-01');
    
CREATE TABLE assignments_2021 PARTITION OF assignments
    FOR VALUES FROM ('2021-01-01') TO ('2022-01-01');
-- ... continue for all years

-- Co-locate document_ids with assignments via hash partitioning by assignment_id
```

**Validation Queries**:
```sql
-- Verify row counts match
SELECT 'assignments' as table_name, COUNT(*) FROM assignments
UNION ALL
SELECT 'legacy', COUNT(*) FROM db_uspto.assignment;

-- Verify FK integrity
SELECT COUNT(*) FROM document_ids d
LEFT JOIN assignments a ON d.assignment_id = a.id
WHERE a.id IS NULL; -- Should be 0
```

---

#### Source: EPO Linked Data → Target: `cpc_classifications`

**Transformation**:
- Fetch CPC hierarchy via SPARQL
- Build parent-child tree
- Denormalize section/class/subclass components

```sql
-- Populate CPC hierarchy
INSERT INTO cpc_classifications (id, cpc_code, section, class, subclass, main_group, subgroup, parent_id, title, level)
VALUES ...;
```

**Est. Rows**: 300K classification nodes

---

### 3.3 Phase 2: Bibliographic Data Migration

#### Source: `db_patent_grant_bibliographic` → Target Schema

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `grant_application` | `patents` | - Merge grant + application identifiers<br>- Set `layout_id=15` for grants<br>- Generate UUIDs | 10M+ |
| `inventor` | `inventors` | - Set `patent_type='grant'`<br>- Link to `entities` if matched | 30M+ |
| `assignee_grant` | (Skip - data in `assignees`) | - Biographical assignee data already in USPTO data | - |

#### Source: `db_patent_application_bibliographic` → Target Schema

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| *(inferred from structure)* | `patents` | - Set `layout_id=14` for app-only<br>- Merge with grant data where applicable | 15M+ |
| `inventor` | `inventors` | - Set `patent_type='application'`<br>- Deduplicate with grant inventors | 40M+ |
| `assignee_application` | (Skip - data in `assignees`) | - Data already in USPTO data | - |

**Merge Logic** for `patents` table:
```sql
-- Create unified patent records
INSERT INTO patents (id, appno_doc_num, grant_doc_num, appno_date, grant_date, title, layout_id)
SELECT 
    gen_random_uuid(),
    appno_doc_num,
    grant_doc_num,
    appno_date,
    grant_date,
    COALESCE(grant_title, app_title) as title,
    CASE 
        WHEN grant_doc_num IS NOT NULL THEN 15 -- grant exists
        ELSE 14 -- application only
    END as layout_id
FROM (
    SELECT DISTINCT
        d.appno_doc_num,
        d.grant_doc_num,
        d.appno_date,
        d.grant_date,
        g.title as grant_title,
        a.title as app_title
    FROM db_uspto.documentid d
    LEFT JOIN db_patent_grant_bibliographic.grant_application g ON d.grant_doc_num = g.grant_doc_num
    LEFT JOIN db_patent_application_bibliographic.* a ON d.appno_doc_num = a.appno_doc_num
) merged
ON CONFLICT (appno_doc_num, grant_doc_num) DO NOTHING;
```

---

#### Source: `db_patent_maintainence_fee` → Target: `maintenance_fee_events`

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `event_maintainence_fees` | `maintenance_fee_events` | - Direct mapping<br>- Link to `patents` | 5M+ |

---

#### Source: `db_inventor` (Separate Host) → Target: `inventors`

**Special Considerations**: Database on separate host, needs network connectivity during migration

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `inventors` | `inventors` (update canonical names) | - Update `canonical_name` for matched inventors<br>- Link `entity_id` for assignor matches | 70M updates |

```sql
-- Update canonical names from inventor DB
UPDATE inventors i
SET canonical_name = inv.canonical_name,
    entity_id = e.id
FROM db_inventor.inventors inv
LEFT JOIN entities e ON inv.assignor_and_assignee_id = e.id
WHERE i.name = inv.name;
```

---

### 3.4 Phase 3: Organization & Multi-Tenant Data Migration

#### Source: `db_business` → Target: `organizations`, `customer_configurations`

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `organisation` | `organizations` | - Generate UUIDs and slugs<br>- Extract `representative_id`<br>- Set status from implicit state | <100 |
| (derived from `organisation`) | `customer_configurations` | - Extract environment modes<br>- Set default filters (date>1999, layout=15)<br>- Initialize feature flags | <100 |

**Transformation Logic**:
```sql
-- Migrate organizations
INSERT INTO organizations (id, name, slug, representative_id, status, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    name,
    LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')), -- Generate slug
    rep.id as representative_id,
    'active', -- Assume all active initially
    created_at,
    COALESCE(updated_at, created_at)
FROM db_business.organisation o
LEFT JOIN representatives rep ON rep.representative_name = o.representative_name;

-- Create mapping table
CREATE TEMP TABLE org_id_map AS
SELECT organisation_id as old_id, id as new_id FROM organizations;
```

---

#### Source: Per-Customer Databases `db_{orgId}{uniqid}` → Target Schema

**Challenge**: N separate databases need to be merged into single schema with `organization_id` foreign keys.

**Discovery Process**:
```sql
-- Query db_business to get list of customer databases
SELECT organisation_id, org_db FROM db_business.organisation;
-- Result: List of N database names to migrate
```

**Migration per Customer Database**:

| Legacy Table | Target Table | Transformation | Per-DB Rows |
|--------------|--------------|----------------|-------------|
| `user` | `users` | - Add `organization_id` FK<br>- Re-hash passwords (upgrade to bcrypt factor 12)<br>- Map `role_id` → `role_type` (0/1/9) | 10-50 |
| `representative` | `ownership_tree_nodes` | - Transform tree structure<br>- Link to canonical `representatives`<br>- Add `organization_id` | 1K-10K |
| `activity` | `activities` | - Add `organization_id`<br>- Map `type` codes<br>- Link to `users` | 100-1K |
| `comment` | `comments` | - Add `organization_id`<br>- Link to `users` | 50-500 |
| `collection` | `collections` | - Add `organization_id`<br>- Link to `users` | 10-100 |
| `collection_company` / `collection_patent` | `collection_items` | - Merge into single table<br>- Set `item_type` | 100-1K |
| `assets_channel` | `assets` | - Add `organization_id`<br>- Link to `representatives` | 1K-50K |

**Script Pattern** (run for each customer DB):
```bash
#!/bin/bash
# migrate_customer_db.sh

ORG_ID=$1
DB_NAME=$2

psql -c "
  -- Migrate users
  INSERT INTO users (id, organization_id, email, username, password_hash, first_name, last_name, role_type, status, created_at)
  SELECT 
    gen_random_uuid(),
    '$ORG_ID'::uuid,
    email_address,
    username,
    password_hash,  -- Will need re-hashing
    first_name,
    last_name,
    CASE 
      WHEN role_id IN (SELECT id FROM $DB_NAME.role WHERE name IN ('Admin', 'Administrator')) THEN 0
      WHEN role_id IN (SELECT id FROM $DB_NAME.role WHERE name = 'Super Admin') THEN 9
      ELSE NULL
    END,
    status,
    NOW()
  FROM $DB_NAME.user;
  
  -- Migrate collections
  INSERT INTO collections (id, organization_id, user_id, name, description, collection_type, created_at)
  SELECT 
    gen_random_uuid(),
    '$ORG_ID'::uuid,
    u.id,
    c.name,
    c.description,
    'mixed',
    NOW()
  FROM $DB_NAME.collection c
  JOIN users u ON u.username = (SELECT username FROM $DB_NAME.user WHERE user_id = c.user_id) AND u.organization_id = '$ORG_ID'::uuid;
  
  -- ... continue for other tables
"
```

**Validation**:
- Verify all users from N databases exist in unified `users` table
- Verify `organization_id` distribution matches customer count
- Test RLS policies with sample organization

---

### 3.5 Phase 4: Derived/Computed Data Migration

#### Source: `db_new_application` → Target Schema

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `assets` | `assets` | - Add `organization_id` from context<br>- Link to `representatives` | 1M+ |
| `tree` | `ownership_tree_nodes` | - Add `organization_id`<br>- Link to `entities` and `representatives`<br>- Validate tree types 0-13 | 5M+ |
| `timeline` | `timeline_entries` | - Add `organization_id`<br>- Link to `assignments` and `entities` | 10M+ |
| `dashboard_items` | `dashboard_items` | - Add `organization_id`<br>- Validate type codes<br>- Link to `assignments` | 20M+ |
| `dashboard_items_count` | `dashboard_items` (merge) | - Merge counts into main dashboard | - |
| `summary` | `summary_metrics` | - Add `organization_id`<br>- Extract metrics into columns | 1K+ |

**Note**: Most of these tables will be **rebuilt** from source data during migration rather than directly migrated, to ensure consistency.

**Rebuild Strategy**:
```sql
-- After migrating core data, run processing pipeline for each organization
SELECT id FROM organizations;

-- For each org, run 8-step pipeline:
-- 1. classify
-- 2. flag (inventor matching)
-- 3. tree (ownership tree build)
-- 4. timeline (transaction timeline)
-- 5. broken_title (chain validation)
-- 6. dashboard (populate dashboard items)
-- 7. summary (calculate metrics)
-- 8. generate_json (visualization data)
```

---

### 3.6 Phase 5: Ingestion & Processing Metadata

#### Source: `db_uspto.download_tracking` → Target: `data_sources`, `ingestion_jobs`

| Legacy Table | Target Table | Transformation | Est. Rows |
|--------------|--------------|----------------|-----------|
| `download_tracking` | `data_sources` | - Extract unique data sources<br>- Configure schedules | 17 |
| `download_tracking` | `ingestion_jobs` | - Historical job records<br>- Link to `data_sources` | 10K+ |

**Transformation**:
```sql
-- Create data sources (one-time setup)
INSERT INTO data_sources (id, name, source_type, schedule_type, schedule_cron, endpoint_url, format, is_active)
VALUES 
  (gen_random_uuid(), 'USPTO_BULK_GRANTS', 'bulk_download', 'weekly', '0 0 * * 2', 'https://bulkdata.uspto.gov/...', 'xml', true),
  (gen_random_uuid(), 'USPTO_PASDL_DAILY', 'rest_api', 'daily', '0 2 * * *', 'https://assignment-api.uspto.gov/...', 'xml', true),
  -- ... 15 more sources
;

-- Migrate historical jobs
INSERT INTO ingestion_jobs (id, data_source_id, status, started_at, completed_at, file_name, created_at)
SELECT 
  gen_random_uuid(),
  ds.id,
  CASE WHEN dt.status = 'complete' THEN 'success' ELSE 'failed' END,
  dt.download_date,
  dt.download_date + INTERVAL '1 hour', -- Estimate
  dt.file_name,
  dt.download_date
FROM db_uspto.download_tracking dt
JOIN data_sources ds ON ds.name = dt.data_source;
```

---

#### Source: `big_data` → Archive/Warehouse

**Recommendation**: 
- **Do not migrate** `big_data` into production schema
- Purpose unclear from analysis docs
- Likely archive/backup data or experimental tables
- **Action**: Keep as separate archive database or migrate to cold storage (S3/Glacier)
- Query as needed for historical data retrieval

---

### 3.7 Migration Tools & Scripts

**Recommended Tools**:
- **Flyway** or **Liquibase**: Database migration version control
- **pgloader**: Fast data transfer between PostgreSQL databases
- **Custom Python/Node.js scripts**: Complex transformations and validation

**pgloader Example**:
```
LOAD DATABASE
  FROM mysql://user:pass@legacyhost/db_uspto
  INTO postgresql://user:pass@newhost/patentrack_unified
  
WITH include drop, create tables, create indexes, reset sequences

SET work_mem to '256MB', maintenance_work_mem to '512MB'

CAST column assignment.record_dt to date drop not null,
     column assignment.exec_dt to date drop not null

BEFORE LOAD DO
  $$ CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; $$;

AFTER LOAD DO
  $$ UPDATE assignments SET id = gen_random_uuid() WHERE id IS NULL; $$;
```

---

### 3.8 Migration Validation Checklist

After each phase:

- [ ] **Row count validation**: Legacy vs. new tables match
- [ ] **Foreign key integrity**: No orphaned records
- [ ] **Data type validation**: All columns have correct types and constraints
- [ ] **Index creation**: All indexes created and valid
- [ ] **RLS policy testing**: Organization isolation works correctly
- [ ] **Sample query testing**: Run representative queries from each API endpoint
- [ ] **Performance benchmarking**: Query times within acceptable ranges
- [ ] **Application smoke testing**: PT-App, PT-Admin, PT-Share load correctly

**Final Validation**:
```sql
-- Comprehensive validation queries
SELECT 'assignments' as check, COUNT(*) as new_count, 
  (SELECT COUNT(*) FROM db_uspto.assignment) as legacy_count,
  COUNT(*) - (SELECT COUNT(*) FROM db_uspto.assignment) as diff
UNION ALL
SELECT 'users', COUNT(*), 
  (SELECT SUM(cnt) FROM (
    SELECT COUNT(*) as cnt FROM db_1234abc567def.user
    UNION ALL SELECT COUNT(*) FROM db_5678xyz890ghi.user
    -- ... for all N customer DBs
  ) sub), ...
;

-- Verify FK integrity across all tables
SELECT 
  tc.table_name, 
  COUNT(*) as orphaned_records
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND NOT EXISTS (
  SELECT 1 FROM ... -- Check FK target exists
)
GROUP BY tc.table_name
HAVING COUNT(*) > 0;
```

---

## 4. Business Rule Preservation Matrix


This section maps all 65 business rules to the new schema, enforcement strategy, and testing approach.

### 4.1 Transaction Classification Rules (BR-001 to BR-012)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-001 | "correct"/"re-record" → type `correct` | `assignment_conveyances.convey_ty` | Application layer (ingestion pipeline) | Unit test: convey_text → convey_ty mapping |
| BR-002 | "employee"/"employment" → type `employee`, `employer_assign=1` | `assignment_conveyances.convey_ty`, `employer_assign` | Application layer | Unit test: employee detection + flag |
| BR-003 | "confirmator" → type `govern` | `assignment_conveyances.convey_ty` | Application layer | Unit test: govern classification |
| BR-004 | "merger" → type `merger` | `assignment_conveyances.convey_ty` | Application layer | Unit test: merger detection |
| BR-005 | "change of name/address" → type `namechg` | `assignment_conveyances.convey_ty` | Application layer | Unit test: name change detection |
| BR-006 | "license"/"letters of testamentary" → type `license` | `assignment_conveyances.convey_ty` | Application layer | Unit test: license classification |
| BR-007 | "release" → type `release` | `assignment_conveyances.convey_ty` | Application layer | Unit test: release detection |
| BR-008 | "security"/"mortgage" → type `security` | `assignment_conveyances.convey_ty` | Application layer | Unit test: security interest detection |
| BR-009 | "assignment" → type `assignment` | `assignment_conveyances.convey_ty` | Application layer | Unit test: assignment classification |
| BR-010 | No match → type `missing` | `assignment_conveyances.convey_ty` | Application layer (default) | Unit test: fallback to missing |
| BR-011 | Lookup table match overrides string matching | `assignment_conveyances` (Phase 1 lookup) | Application layer (two-phase classification) | Integration test: lookup priority over regex |
| BR-012 | Priority order: correct > employee > ... > missing | Enum ordering in application logic | Application layer | Integration test: priority cascade |

**Enforcement**: Application layer during Step 1 (classify) of processing pipeline

**Database Support**:
```sql
-- Enum constraint ensures only valid types
ALTER TABLE assignment_conveyances 
  ADD CONSTRAINT valid_convey_ty CHECK (convey_ty IN (
    'assignment', 'employee', 'merger', 'namechg', 'correct', 
    'govern', 'license', 'release', 'security', 'missing'
  ));
```

**Test Cases**:
1. Conveyance text samples for each type → correct classification
2. Ambiguous text with multiple keywords → priority order respected
3. Lookup table entry → overrides regex matching
4. Empty/null convey_text → type='missing'

---

### 4.2 Name Normalization Rules (BR-013 to BR-023)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-013 | Remove "corporation" suffix, append " corp" | `entities.name`, `representatives.representative_name` | Application layer (normalization function) | Unit test: suffix removal + append |
| BR-014 | Remove "incorporated" suffix, append " inc" | `entities.name`, `representatives.representative_name` | Application layer | Unit test: inc normalization |
| BR-015 | Remove "limited" suffix, append " ltd" | `entities.name`, `representatives.representative_name` | Application layer | Unit test: ltd normalization |
| BR-016 | Remove "company" suffix, append " co" | `entities.name`, `representatives.representative_name` | Application layer | Unit test: co normalization |
| BR-017 | International suffix normalization (regex) | `entities.name`, `representatives.representative_name` | Application layer | Unit test: gmbh, kk, sarl, etc. |
| BR-018 | Levenshtein distance < 3-5 → same entity | `entities` → `representatives` grouping | Application layer (entity resolution) | Integration test: fuzzy matching threshold |
| BR-019 | Canonical name = highest occurrence count | `representatives.representative_name` | Application layer (select max instances) | Unit test: canonical selection logic |
| BR-020 | Sort by word count (descending) before matching | Entity resolution algorithm | Application layer | Unit test: word count sorting |
| BR-021 | Inventor variations: 6 formats | `inventors` matching logic | Application layer (Step 2: flag) | Unit test: name variation generation |
| BR-022 | Inventor-assignor Levenshtein < 5 | `inventors.entity_id` link | Application layer | Integration test: inventor → entity matching |
| BR-023 | Match found → `employer_assign=1`, `convey_ty='employee'` | `assignment_conveyances.employer_assign` | Application layer | Integration test: employee assignment marking |

**Enforcement**: Application layer during ingestion (entity normalization) and Step 2 (flag) of processing pipeline

**Database Support**:
```sql
-- Levenshtein extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Example query for entity matching (simplified)
SELECT a.name, b.name, levenshtein(LOWER(a.name), LOWER(b.name)) as distance
FROM entities a
CROSS JOIN entities b
WHERE a.id < b.id
  AND levenshtein(LOWER(a.name), LOWER(b.name)) < 5
ORDER BY distance;
```

**Test Cases**:
1. Known entity name variations → grouped into same representative
2. Similar names above threshold → separate representatives
3. Inventor name in 6 formats → match to assignor
4. Non-matching inventor → no entity link
5. Employee assignment → employer_assign=1 flag set

---

### 4.3 Ownership Tree & Dashboard Rules (BR-024 to BR-037)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-024 | Employee assignments: tree type 0/1, tab 0/1 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer (Step 3: tree) | Unit test: employee tree classification |
| BR-025 | Purchases: tree type 1, tab 1 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer | Unit test: purchase detection |
| BR-026 | Sales: tree type 2, tab 1 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer | Unit test: sale detection |
| BR-027 | Mergers: tree type 3/4, tab 1 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer | Unit test: merger tree classification |
| BR-028 | Security: tree type 5/6, tab 2 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer | Unit test: security tree type |
| BR-029 | Release: tree type 7/8, tab 2 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer | Unit test: release tree type |
| BR-030 | Administrative: tree type 9-13, tab 3 | `ownership_tree_nodes.tree_type`, `tree_tab` | Application layer | Unit test: admin tree types |
| BR-031 | Color mapping: assignment→red, namechg→blue, etc. | `ownership_tree_nodes.color` | Application layer | Unit test: color assignment |
| BR-032 | Broken title definition | `broken_title_chains` table | Application layer (Step 5: broken_title) | Integration test: chain continuity validation |
| BR-033 | Chain continuity: Assignee(N) = Assignor(N+1) | `broken_title_chains.reason` | Application layer | Integration test: chain traversal |
| BR-034 | Employee chain starter allowed | Chain validation logic | Application layer | Integration test: employee exception |
| BR-035 | Complete chain without employee start → broken | `broken_title_chains.has_employee_start` | Application layer | Integration test: chain validation |
| BR-036 | Broken chain → `dashboard_items.type=1` | `dashboard_items.type` | Application layer (Step 6: dashboard) | Integration test: broken chain in dashboard |
| BR-037 | Dashboard type codes: 0=complete, 1=broken, 18=encumbrance, 20=law firms, 30-36=bank | `dashboard_items.type` | Database constraint + application layer | Unit test: valid type codes |

**Enforcement**: Primarily application layer during processing pipeline (Steps 3-6)

**Database Support**:
```sql
-- Enum constraints for tree types and tabs
ALTER TABLE ownership_tree_nodes
  ADD CONSTRAINT valid_tree_type CHECK (tree_type BETWEEN 0 AND 13),
  ADD CONSTRAINT valid_tree_tab CHECK (tree_tab BETWEEN 0 AND 3);

-- Dashboard type constraint
ALTER TABLE dashboard_items
  ADD CONSTRAINT valid_dashboard_type CHECK (type IN (0, 1, 18, 20, 30, 31, 32, 33, 34, 35, 36));

-- Color enum
ALTER TABLE ownership_tree_nodes
  ADD CONSTRAINT valid_color CHECK (color IN ('red', 'blue', 'orange', 'green', 'yellow', NULL));
```

**Test Cases**:
1. Employee assignment → tree_type=0/1, tab=0/1, employer_assign=1
2. Purchase transaction → tree_type=1, tab=1
3. Security interest → tree_type=5/6, tab=2, color='orange'
4. Continuous chain (inventor → A → B → C) → type=0 (complete)
5. Broken chain (A → B, gap, D → E) → broken_title_chains entry + dashboard_items type=1
6. Employee start (employee → A → B) → complete chain

---

### 4.4 Data Processing & Filter Rules (BR-038 to BR-043)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-038 | Activity grouping: 11,12,13,16 → 5 | `activities.activity_type` (reporting layer) | Application layer (API/reporting) | Unit test: activity grouping logic |
| BR-039 | Date filter: `appno_date > 1999` | `customer_configurations.filter_date_from` | Application layer (default filter) | Integration test: API respects filter |
| BR-040 | Layout filter: `layout_id = 15` | `customer_configurations.default_layout_id` | Application layer | Integration test: layout filtering |
| BR-041 | Employee date range: 1998-2001 | Inventor matching logic (Step 2: flag) | Application layer | Integration test: date range in matching |
| BR-042 | Org-level summary: `representative_id = NULL` | `summary_metrics.representative_id IS NULL` | Application layer | Unit test: org-level aggregation |
| BR-043 | Summary metrics: companies, activities, entities, etc. | `summary_metrics` columns | Application layer (Step 7: summary) | Integration test: metric calculations |

**Enforcement**: Application layer (API filtering, processing pipeline)

**Test Cases**:
1. Activity types 11-16 → grouped as activity 5 in reports
2. API query without date filter → defaults to appno_date > 1999
3. Organization summary → representative_id IS NULL, aggregates all representatives
4. Summary calculation → all 8 metrics populated correctly

---

### 4.5 Share & Access Rules (BR-044 to BR-047)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-044 | CUID2 share code (24-32 chars) | `share_links.share_code` | Application layer (CUID2 library) | Unit test: share code generation |
| BR-045 | **FIXED**: Share returns read-only JWT, not admin | `share_links.access_scope='read_only'` | Application layer (JWT scoping) | Security test: share JWT cannot modify data |
| BR-046 | **FIXED**: Share link expiration + usage limits | `share_links.expires_at`, `max_uses` | Application layer + database constraint | Integration test: expired/over-limit share rejected |
| BR-047 | IP logging | `share_access_logs.ip_address` | Application layer | Integration test: access log created on share view |

**Enforcement**: Application layer (share link service) + database constraints

**Database Support**:
```sql
-- Enforce access scope restrictions (no more full_admin)
ALTER TABLE share_links
  ADD CONSTRAINT valid_access_scope CHECK (access_scope IN ('read_only', 'comment', 'annotate'));

-- Trigger to check expiration and usage limits
CREATE OR REPLACE FUNCTION check_share_link_validity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < NOW() THEN
    RAISE EXCEPTION 'Share link has expired';
  END IF;
  
  IF NEW.max_uses IS NOT NULL AND NEW.use_count >= NEW.max_uses THEN
    RAISE EXCEPTION 'Share link usage limit exceeded';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_share_link_validity
  BEFORE INSERT OR UPDATE ON share_access_logs
  FOR EACH ROW
  EXECUTE FUNCTION check_share_link_validity();
```

**Test Cases**:
1. Generate share link → CUID2 format (24-32 chars, URL-safe)
2. Access shared resource → read-only permissions, cannot create/update/delete
3. Expired share link → 403 Forbidden
4. Share link with max_uses=5 → 6th access rejected
5. Each share access → IP logged in share_access_logs

---

### 4.6 Auth & RBAC Rules (BR-048 to BR-053)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-048 | Admin user: type 0 or 1 | `users.role_type IN (0, 1)` | Database constraint + application RBAC | Integration test: admin permissions |
| BR-049 | Super admin: type 9 | `users.role_type = 9` | Database constraint + RLS bypass | Integration test: super admin cross-org access |
| BR-050 | JWT 24hr expiry | JWT configuration | Application layer | Security test: JWT expires after 24hrs |
| BR-051 | bcrypt salt factor 12 (upgrade from 8) | `users.password_hash` | Application layer (bcrypt library) | Unit test: password hashing with factor 12 |
| BR-052 | Email verification: 6 hex chars, 1-hour expiry | `users.email_verification_token` | Application layer | Integration test: email verification flow |
| BR-053 | Password reset: 40 hex chars, 1-hour expiry | `users.password_reset_token`, `password_reset_expires_at` | Application layer | Integration test: password reset flow |

**Enforcement**: Mix of database constraints and application layer

**Database Support**:
```sql
-- Role type constraint
ALTER TABLE users
  ADD CONSTRAINT valid_role_type CHECK (role_type IN (0, 1, 9) OR role_type IS NULL);

-- RLS policy for super admin bypass
CREATE POLICY super_admin_bypass ON users
  USING (current_setting('app.user_role', true) = '9');

-- Token expiration index for cleanup
CREATE INDEX idx_users_expired_tokens ON users(password_reset_expires_at)
  WHERE password_reset_expires_at < NOW();
```

**Test Cases**:
1. Regular user (role_type=NULL) → org-scoped access only
2. Admin (role_type=0/1) → full org access, cannot access other orgs
3. Super admin (role_type=9) → cross-org access, RLS bypass
4. JWT issued → expires after 24 hours
5. Password hashed → bcrypt factor 12 (verify with bcrypt.getRounds())
6. Email verification token → 6 hex chars, expires after 1 hour
7. Password reset token → 40 hex chars, single-use, expires after 1 hour

---

### 4.7 Data Ingestion Rules (BR-054 to BR-060)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-054 | USPTO daily API: API key via `x-api-key` header | `data_sources.auth_config` | Application layer (HTTP client) | Integration test: API authentication |
| BR-055 | Weekly downloads: date-based incremental | `data_sources.schedule_cron` | Application layer (scheduler) | Integration test: incremental ingestion |
| BR-056 | Monthly CPC: full replacement dataset | `data_sources.schedule_type='monthly'` | Application layer | Integration test: full refresh |
| BR-057 | EPO OAuth2: client credentials flow | `data_sources.auth_config` | Application layer (OAuth2 library) | Integration test: token refresh |
| BR-058 | API retry logic: 429 → 1 second sleep, 5 retries | Ingestion service | Application layer | Unit test: retry backoff |
| BR-059 | Duplicate handling: silent skip | `INSERT ... ON CONFLICT DO NOTHING` | Database + application layer | Integration test: duplicate insertion ignored |
| BR-060 | 8-step pipeline: classify → flag → tree → timeline → broken_title → dashboard → summary → generate_json | `processing_steps.step_name` | Application layer (pipeline orchestration) | Integration test: full pipeline execution |

**Enforcement**: Application layer (data ingestion service)

**Database Support**:
```sql
-- Unique constraints to enforce duplicates = skip
ALTER TABLE assignments ADD CONSTRAINT assignments_rf_id_unique UNIQUE (rf_id);
ALTER TABLE document_ids ADD CONSTRAINT document_ids_unique UNIQUE (assignment_id, appno_doc_num, grant_doc_num);

-- On conflict behavior
INSERT INTO assignments (rf_id, ...) VALUES (...)
ON CONFLICT (rf_id) DO NOTHING;
```

**Test Cases**:
1. USPTO API call with API key → authentication succeeds
2. Weekly download → incremental (new records only)
3. Monthly CPC → full table replacement
4. EPO API call → OAuth2 token obtained and cached
5. API returns 429 → retry with exponential backoff (1s, 2s, 4s, 8s, 16s)
6. Duplicate assignment ingestion → silent skip, no error
7. Processing pipeline → all 8 steps execute in order
8. Pipeline failure at step 4 → steps 5-8 not executed, job status='failed'

---

### 4.8 Frontend-Specific Rules (BR-061 to BR-065)

| Rule | Description | New Schema Entity | Enforcement | Test Strategy |
|------|-------------|-------------------|-------------|---------------|
| BR-061 | Environment modes: PRO, KPI, DASHBOARD, SAMPLE, STANDARD | `customer_configurations.environment_mode` | Application layer (feature flags) | E2E test: mode controls feature visibility |
| BR-062 | PT-Admin routing: Redux state, not URL | Frontend state management | Frontend layer (not database) | Frontend test: navigation updates Redux |
| BR-063 | PT-Share URL pattern: last segment = share code | Route parsing | Frontend + API layer | E2E test: share URL routing |
| BR-064 | Dark mode: localStorage | Frontend state | Frontend layer (not database) | Frontend test: theme persistence |
| BR-065 | Token storage: localStorage + cookie | Frontend + HTTP headers | Frontend + backend layer | Security test: token in both locations |

**Enforcement**: Primarily frontend layer, some backend support

**Database Support**:
```sql
-- Environment mode constraint
ALTER TABLE customer_configurations
  ADD CONSTRAINT valid_environment_mode CHECK (environment_mode IN (
    'PRO', 'KPI', 'DASHBOARD', 'SAMPLE', 'SAMPLE-1', 'STANDARD'
  ));
```

**Test Cases**:
1. Organization with environment_mode='DASHBOARD' → dashboard-only features shown
2. PT-Admin navigation → Redux state updated, URL unchanged
3. PT-Share URL `/share/illustrate/show/abc123xyz` → share code='abc123xyz'
4. Dark mode toggle → saved to localStorage, persists on reload
5. Login → JWT in localStorage AND domain cookie (.patentrack.com)

---

### 4.9 Business Rule Compliance Summary

**Total Business Rules**: 65

**Enforcement Breakdown**:
- **Database constraints**: 15 rules (enums, check constraints, unique constraints)
- **Database triggers**: 2 rules (share link validation, token expiration)
- **Application layer**: 43 rules (ingestion, processing, API logic)
- **Frontend layer**: 5 rules (UI state, routing, storage)

**Critical Rules** (security/data integrity):
- BR-011: Lookup table priority (prevents incorrect classification)
- BR-032-036: Broken title chain detection (core business logic)
- BR-045: Share link scope restriction (security fix)
- BR-046: Share link expiration (security fix)
- BR-048-049: RBAC enforcement (authorization)
- BR-051: Password hashing strength (security)
- BR-059: Duplicate handling (data integrity)

**Testing Coverage**:
- Unit tests: 25 rules (isolated function testing)
- Integration tests: 30 rules (multi-component workflows)
- E2E tests: 10 rules (full system behavior)

---

## 5. Enum and Lookup Definitions


This section extracts all magic numbers and string constants into explicit enum types and lookup tables.

### 5.1 Transaction/Conveyance Types

**Purpose**: Classification of assignment transactions (BR-001 to BR-012)

**Implementation**: PostgreSQL enum type + lookup table

```sql
-- Enum type for type safety
CREATE TYPE conveyance_type AS ENUM (
  'assignment',   -- Standard ownership transfer (BR-009)
  'employee',     -- Employee-to-employer assignment (BR-002)
  'merger',       -- Corporate merger (BR-004)
  'namechg',      -- Name or address change (BR-005)
  'correct',      -- Correction/re-record (BR-001)
  'govern',       -- Government confirmatory (BR-003)
  'license',      -- License agreement (BR-006)
  'release',      -- Security interest release (BR-007)
  'security',     -- Security interest/mortgage (BR-008)
  'missing'       -- Unclassified (BR-010)
);

-- Lookup table for metadata and priority
CREATE TABLE conveyance_type_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convey_ty conveyance_type UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  priority INTEGER UNIQUE NOT NULL, -- BR-012: Classification priority
  color VARCHAR(20), -- BR-031: Visual color mapping
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO conveyance_type_lookup (convey_ty, display_name, description, priority, color) VALUES
  ('correct', 'Correction', 'Correction or re-record of prior assignment', 1, NULL),
  ('employee', 'Employee Assignment', 'Employment or pre-employment agreement', 2, 'blue'),
  ('govern', 'Government', 'Government confirmatory assignment', 3, 'yellow'),
  ('merger', 'Merger', 'Corporate merger or consolidation', 4, 'purple'),
  ('namechg', 'Name Change', 'Change of name or address', 5, 'blue'),
  ('license', 'License', 'License agreement or letters testamentary', 6, 'yellow'),
  ('release', 'Release', 'Release of security interest', 7, 'green'),
  ('security', 'Security Interest', 'Security agreement or mortgage', 8, 'orange'),
  ('assignment', 'Assignment', 'Standard assignment of rights', 9, 'red'),
  ('missing', 'Unclassified', 'Could not classify from text', 10, NULL);
```

**Usage in Tables**:
```sql
-- Option 1: Use enum type directly
ALTER TABLE assignment_conveyances ALTER COLUMN convey_ty TYPE conveyance_type USING convey_ty::conveyance_type;

-- Option 2: Keep as VARCHAR with FK to lookup table
ALTER TABLE assignment_conveyances
  ADD CONSTRAINT fk_convey_ty FOREIGN KEY (convey_ty) REFERENCES conveyance_type_lookup(convey_ty);
```

**Recommended**: Option 1 (enum) for type safety and performance

---

### 5.2 Ownership Tree Types

**Purpose**: Tree node classification (BR-024 to BR-030)

```sql
-- Enum for tree types
CREATE TYPE tree_type AS ENUM (
  'employee_type0',      -- 0: Employee assignment (employee link)
  'employee_type1',      -- 1: Employee assignment OR purchase (assignee matches org)
  'sale',                -- 2: Sale (assignor matches org)
  'merger_type3',        -- 3: Merger (direction 1)
  'merger_type4',        -- 4: Merger (direction 2)
  'security_type5',      -- 5: Security interest (direction 1)
  'security_type6',      -- 6: Security interest (direction 2)
  'release_type7',       -- 7: Release (direction 1)
  'release_type8',       -- 8: Release (direction 2)
  'namechg_admin',       -- 9: Name change (administrative)
  'govern_admin',        -- 10: Government (administrative)
  'correct_admin',       -- 11: Correction (administrative)
  'missing_admin',       -- 12: Unclassified (administrative)
  'other_admin'          -- 13: Other (administrative)
);

-- Lookup table
CREATE TABLE tree_type_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_type_code INTEGER UNIQUE NOT NULL CHECK (tree_type_code BETWEEN 0 AND 13),
  tree_type_enum tree_type UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  tree_tab INTEGER NOT NULL CHECK (tree_tab BETWEEN 0 AND 3), -- BR-024 to BR-030
  tab_name VARCHAR(50),
  color VARCHAR(20), -- BR-031
  is_administrative BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO tree_type_lookup (tree_type_code, tree_type_enum, display_name, description, tree_tab, tab_name, color, is_administrative) VALUES
  (0, 'employee_type0', 'Employee (Type 0)', 'Employee assignment (employee link)', 0, 'Employee/Purchase/Sale', 'blue', FALSE),
  (1, 'employee_type1', 'Employee/Purchase (Type 1)', 'Employee assignment or purchase', 1, 'Employee/Purchase/Sale', 'blue', FALSE),
  (2, 'sale', 'Sale', 'Sale (assignor matches org)', 1, 'Employee/Purchase/Sale', 'red', FALSE),
  (3, 'merger_type3', 'Merger (Type 3)', 'Merger direction 1', 1, 'Employee/Purchase/Sale', 'purple', FALSE),
  (4, 'merger_type4', 'Merger (Type 4)', 'Merger direction 2', 1, 'Employee/Purchase/Sale', 'purple', FALSE),
  (5, 'security_type5', 'Security (Type 5)', 'Security interest direction 1', 2, 'Security/Release', 'orange', FALSE),
  (6, 'security_type6', 'Security (Type 6)', 'Security interest direction 2', 2, 'Security/Release', 'orange', FALSE),
  (7, 'release_type7', 'Release (Type 7)', 'Release direction 1', 2, 'Security/Release', 'green', FALSE),
  (8, 'release_type8', 'Release (Type 8)', 'Release direction 2', 2, 'Security/Release', 'green', FALSE),
  (9, 'namechg_admin', 'Name Change (Admin)', 'Name change (administrative)', 3, 'Administrative', 'blue', TRUE),
  (10, 'govern_admin', 'Government (Admin)', 'Government confirmatory (administrative)', 3, 'Administrative', 'yellow', TRUE),
  (11, 'correct_admin', 'Correction (Admin)', 'Correction (administrative)', 3, 'Administrative', NULL, TRUE),
  (12, 'missing_admin', 'Unclassified (Admin)', 'Unclassified (administrative)', 3, 'Administrative', NULL, TRUE),
  (13, 'other_admin', 'Other (Admin)', 'Other (administrative)', 3, 'Administrative', NULL, TRUE);
```

**Usage**:
```sql
-- Store as integer with lookup FK
ALTER TABLE ownership_tree_nodes
  ADD CONSTRAINT fk_tree_type FOREIGN KEY (tree_type) REFERENCES tree_type_lookup(tree_type_code);
```

---

### 5.3 Dashboard Item Types

**Purpose**: Dashboard categorization (BR-037)

```sql
-- Enum for dashboard types
CREATE TYPE dashboard_item_type AS ENUM (
  'complete_chain',      -- 0: Complete chain of title
  'broken_chain',        -- 1: Broken chain of title
  'encumbrance',         -- 18: Encumbrance/lien
  'law_firm',            -- 20: Law firm relationship
  'bank_type30',         -- 30: Bank security transaction type 30
  'bank_type31',         -- 31: Bank security transaction type 31
  'bank_type32',         -- 32: Bank security transaction type 32
  'bank_type33',         -- 33: Bank security transaction type 33
  'bank_type34',         -- 34: Bank security transaction type 34
  'bank_type35',         -- 35: Bank security transaction type 35
  'bank_type36'          -- 36: Bank security transaction type 36
);

-- Lookup table
CREATE TABLE dashboard_item_type_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code INTEGER UNIQUE NOT NULL,
  type_enum dashboard_item_type UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- 'chain', 'encumbrance', 'law_firm', 'bank'
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO dashboard_item_type_lookup (type_code, type_enum, display_name, description, category) VALUES
  (0, 'complete_chain', 'Complete Chain', 'Complete chain of title from inventor to current owner', 'chain'),
  (1, 'broken_chain', 'Broken Chain', 'Broken or incomplete chain of title', 'chain'),
  (18, 'encumbrance', 'Encumbrance', 'Active encumbrance or lien on patent', 'encumbrance'),
  (20, 'law_firm', 'Law Firm', 'Law firm relationship or correspondence', 'law_firm'),
  (30, 'bank_type30', 'Bank Security (30)', 'Bank security transaction type 30', 'bank'),
  (31, 'bank_type31', 'Bank Security (31)', 'Bank security transaction type 31', 'bank'),
  (32, 'bank_type32', 'Bank Security (32)', 'Bank security transaction type 32', 'bank'),
  (33, 'bank_type33', 'Bank Security (33)', 'Bank security transaction type 33', 'bank'),
  (34, 'bank_type34', 'Bank Security (34)', 'Bank security transaction type 34', 'bank'),
  (35, 'bank_type35', 'Bank Security (35)', 'Bank security transaction type 35', 'bank'),
  (36, 'bank_type36', 'Bank Security (36)', 'Bank security transaction type 36', 'bank');
```

---

### 5.4 User Role Types

**Purpose**: RBAC role definitions (BR-048, BR-049)

```sql
-- Enum for user roles
CREATE TYPE user_role AS ENUM (
  'regular',       -- NULL in legacy: Regular user
  'admin_type0',   -- 0: Admin (type 0)
  'admin_type1',   -- 1: Admin (type 1)
  'super_admin'    -- 9: Super admin
);

-- Lookup table
CREATE TABLE user_role_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code INTEGER UNIQUE, -- NULL for regular
  role_enum user_role UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  permissions JSONB, -- Detailed permission matrix
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO user_role_lookup (role_code, role_enum, display_name, description, permissions) VALUES
  (NULL, 'regular', 'Regular User', 'Standard user with limited access', '{"read": true, "write": true, "admin": false, "super_admin": false}'),
  (0, 'admin_type0', 'Admin (Type 0)', 'Organization administrator (type 0)', '{"read": true, "write": true, "admin": true, "super_admin": false, "manage_users": true}'),
  (1, 'admin_type1', 'Admin (Type 1)', 'Organization administrator (type 1)', '{"read": true, "write": true, "admin": true, "super_admin": false, "manage_users": true}'),
  (9, 'super_admin', 'Super Admin', 'System-wide super administrator', '{"read": true, "write": true, "admin": true, "super_admin": true, "cross_org_access": true}');
```

**Note**: Store as `role_type INTEGER` in users table to maintain compatibility with legacy logic (0/1/9/NULL).

---

### 5.5 Environment Modes

**Purpose**: Customer environment configuration (BR-061)

```sql
-- Enum for environment modes
CREATE TYPE environment_mode AS ENUM (
  'PRO',
  'KPI',
  'DASHBOARD',
  'SAMPLE',
  'SAMPLE-1',
  'STANDARD'
);

-- Lookup table
CREATE TABLE environment_mode_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode environment_mode UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  feature_set JSONB, -- Features enabled in this mode
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO environment_mode_lookup (mode, display_name, description, feature_set) VALUES
  ('PRO', 'Professional', 'Full professional feature set', '{"dashboard": true, "analytics": true, "integrations": true, "api_access": true}'),
  ('KPI', 'KPI Dashboard', 'Key performance indicator dashboard', '{"dashboard": true, "analytics": true, "integrations": false, "api_access": false}'),
  ('DASHBOARD', 'Dashboard Only', 'Dashboard view only', '{"dashboard": true, "analytics": false, "integrations": false, "api_access": false}'),
  ('SAMPLE', 'Sample Data', 'Sample data environment', '{"dashboard": true, "analytics": false, "integrations": false, "api_access": false, "read_only": true}'),
  ('SAMPLE-1', 'Sample Data (Variant 1)', 'Sample data environment variant 1', '{"dashboard": true, "analytics": false, "integrations": false, "api_access": false, "read_only": true}'),
  ('STANDARD', 'Standard', 'Standard feature set', '{"dashboard": true, "analytics": true, "integrations": false, "api_access": false}');
```

---

### 5.6 Activity Types & Groupings

**Purpose**: Activity tracking and grouping (BR-038)

```sql
-- Activity type lookup
CREATE TABLE activity_type_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code INTEGER UNIQUE NOT NULL CHECK (type_code BETWEEN 1 AND 16),
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  group_code INTEGER, -- BR-038: 11,12,13,16 → 5
  icon VARCHAR(50),
  color VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO activity_type_lookup (type_code, display_name, description, group_code) VALUES
  (1, 'Comment Added', 'User added a comment', NULL),
  (2, 'Patent Viewed', 'User viewed a patent', NULL),
  (3, 'Entity Viewed', 'User viewed an entity', NULL),
  (4, 'Collection Created', 'User created a collection', NULL),
  (5, 'Report Generated', 'User generated a report', NULL), -- Group target
  (6, 'Patent Added to Collection', 'Patent added to collection', NULL),
  (7, 'Patent Removed from Collection', 'Patent removed from collection', NULL),
  (8, 'Share Link Created', 'Share link created', NULL),
  (9, 'Integration Connected', 'External integration connected', NULL),
  (10, 'Integration Disconnected', 'External integration disconnected', NULL),
  (11, 'Export Initiated', 'User initiated export', 5), -- Grouped as 5
  (12, 'Export Completed', 'Export completed', 5), -- Grouped as 5
  (13, 'Export Failed', 'Export failed', 5), -- Grouped as 5
  (14, 'Search Performed', 'Search query performed', NULL),
  (15, 'Filter Applied', 'Filter applied to view', NULL),
  (16, 'Report Scheduled', 'Scheduled report created', 5); -- Grouped as 5
```

**Query Example** (BR-038):
```sql
-- Activity reporting with grouping
SELECT 
  COALESCE(at.group_code, at.type_code) as display_type,
  COUNT(*) as activity_count
FROM activities a
JOIN activity_type_lookup at ON a.activity_type = at.type_code
GROUP BY COALESCE(at.group_code, at.type_code);
```

---

### 5.7 Patent Layout IDs

**Purpose**: Patent type categorization (BR-040)

```sql
-- Layout ID lookup
CREATE TABLE layout_id_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id INTEGER UNIQUE NOT NULL CHECK (layout_id IN (14, 15)),
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  includes_grant BOOLEAN NOT NULL,
  includes_application BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO layout_id_lookup (layout_id, display_name, description, includes_grant, includes_application) VALUES
  (14, 'Application Only', 'Published patent application (no grant)', FALSE, TRUE),
  (15, 'Standard', 'Granted patent (may include application)', TRUE, TRUE);
```

---

### 5.8 Data Source Types

**Purpose**: External data source classification (BR-054 to BR-059)

```sql
-- Source type enum
CREATE TYPE data_source_type AS ENUM (
  'bulk_download',
  'rest_api',
  'file_system',
  'sparql'
);

-- Schedule type enum
CREATE TYPE schedule_type AS ENUM (
  'daily',
  'weekly',
  'monthly',
  'on_demand'
);

-- File format enum
CREATE TYPE file_format AS ENUM (
  'xml',
  'json',
  'pdf',
  'tab_delimited',
  'csv',
  'tar',
  'zip'
);
```

---

### 5.9 Processing Pipeline Steps

**Purpose**: 8-step processing pipeline (BR-060)

```sql
-- Processing step enum
CREATE TYPE processing_step_name AS ENUM (
  'classify',
  'flag',
  'tree',
  'timeline',
  'broken_title',
  'dashboard',
  'summary',
  'generate_json'
);

-- Processing step lookup
CREATE TABLE processing_step_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_number INTEGER UNIQUE NOT NULL CHECK (step_number BETWEEN 1 AND 8),
  step_name processing_step_name UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  estimated_duration_seconds INTEGER, -- For progress estimation
  is_parallelizable BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO processing_step_lookup (step_number, step_name, display_name, description, estimated_duration_seconds, is_parallelizable) VALUES
  (1, 'classify', 'Classification', 'Classify assignment transactions', 300, TRUE),
  (2, 'flag', 'Inventor Matching', 'Match inventors to assignors', 600, TRUE),
  (3, 'tree', 'Ownership Tree Build', 'Build ownership tree hierarchy', 180, FALSE),
  (4, 'timeline', 'Timeline Generation', 'Generate chronological timeline', 120, FALSE),
  (5, 'broken_title', 'Broken Title Detection', 'Detect broken chains of title', 900, TRUE),
  (6, 'dashboard', 'Dashboard Population', 'Populate dashboard items', 240, FALSE),
  (7, 'summary', 'Summary Calculation', 'Calculate summary metrics', 60, FALSE),
  (8, 'generate_json', 'JSON Generation', 'Generate visualization JSON', 30, TRUE);
```

---

### 5.10 Status Codes

**Purpose**: Common status values across tables

```sql
-- Generic status enum (reusable)
CREATE TYPE entity_status AS ENUM (
  'active',
  'inactive',
  'pending',
  'suspended',
  'cancelled',
  'trial',
  'void'
);

-- Job status enum (ingestion, processing)
CREATE TYPE job_status AS ENUM (
  'pending',
  'running',
  'success',
  'failed',
  'partial'
);
```

---

## 6. Index Strategy


This section defines index strategy based on query patterns from 388 API endpoints, 6 data flows, and dashboard load requirements.

### 6.1 Index Strategy Overview

**Goals**:
- Dashboard load: 10-30 queries → target <5 queries, <200ms total
- API response time: <100ms for 95th percentile
- Full-text search: <500ms for name/title searches
- Batch operations: Efficient bulk inserts during ingestion

**Approach**:
- **Selective indexing**: Index only columns used in WHERE, JOIN, ORDER BY
- **Composite indexes**: Multi-column indexes for common query patterns
- **Partial indexes**: Filter-based indexes for common subsets
- **GIN indexes**: Full-text search on text columns
- **Covering indexes**: Include non-key columns for index-only scans

---

### 6.2 Core Patent Data Indexes

#### Patents Table

```sql
-- Primary key (automatic)
CREATE INDEX idx_patents_pk ON patents(id);

-- Unique constraints (automatic)
CREATE UNIQUE INDEX idx_patents_appno ON patents(appno_doc_num) WHERE appno_doc_num IS NOT NULL;
CREATE UNIQUE INDEX idx_patents_grant ON patents(grant_doc_num) WHERE grant_doc_num IS NOT NULL;

-- Common filters (BR-039: appno_date > 1999)
CREATE INDEX idx_patents_appno_date_filtered ON patents(appno_date) 
  WHERE appno_date > '1999-01-01';

-- Layout filtering (BR-040)
CREATE INDEX idx_patents_layout ON patents(layout_id);

-- Composite for common query: layout + date filter
CREATE INDEX idx_patents_layout_date ON patents(layout_id, appno_date) 
  WHERE appno_date > '1999-01-01';

-- Full-text search on title
CREATE INDEX idx_patents_title_fts ON patents USING gin(to_tsvector('english', title));

-- Query Pattern: Search patents by number or title
-- SELECT * FROM patents WHERE appno_doc_num = 'X' OR grant_doc_num = 'Y' OR title ILIKE '%keyword%'
-- Uses: idx_patents_appno, idx_patents_grant, idx_patents_title_fts
```

---

#### Assignments Table

**Scale**: 50M+ rows, partition by record_dt (yearly)

```sql
-- Primary key (automatic per partition)
CREATE INDEX idx_assignments_pk ON assignments(id);

-- Unique constraint on rf_id (automatic)
CREATE UNIQUE INDEX idx_assignments_rf_id ON assignments(rf_id);

-- Common filters: record_dt descending (timeline queries)
CREATE INDEX idx_assignments_record_dt ON assignments(record_dt DESC);

-- Status filter
CREATE INDEX idx_assignments_status ON assignments(status) WHERE status = 'active';

-- Composite for timeline queries
CREATE INDEX idx_assignments_timeline ON assignments(record_dt DESC, status)
  WHERE status = 'active';

-- Full-text search on conveyance text (for classification debugging)
CREATE INDEX idx_assignments_convey_text_fts ON assignments 
  USING gin(to_tsvector('english', convey_text));

-- Query Pattern: Get recent assignments
-- SELECT * FROM assignments WHERE status = 'active' AND record_dt > '2020-01-01' ORDER BY record_dt DESC LIMIT 100
-- Uses: idx_assignments_timeline (covering index)
```

---

#### Document IDs Table

**Scale**: 200M+ rows, co-located partitions with assignments

```sql
-- Primary key (automatic)
CREATE INDEX idx_document_ids_pk ON document_ids(id);

-- Foreign key to assignments (critical for joins)
CREATE INDEX idx_document_ids_assignment ON document_ids(assignment_id);

-- Patent number lookups
CREATE INDEX idx_document_ids_appno ON document_ids(appno_doc_num) 
  WHERE appno_doc_num IS NOT NULL;
CREATE INDEX idx_document_ids_grant ON document_ids(grant_doc_num) 
  WHERE grant_doc_num IS NOT NULL;

-- Date filter (BR-039)
CREATE INDEX idx_document_ids_appno_date ON document_ids(appno_date) 
  WHERE appno_date > '1999-01-01';

-- Composite for common join pattern
CREATE INDEX idx_document_ids_composite ON document_ids(assignment_id, grant_doc_num, appno_doc_num);

-- Query Pattern: Find all assignments for a patent
-- SELECT a.* FROM assignments a JOIN document_ids d ON a.id = d.assignment_id WHERE d.grant_doc_num = 'X'
-- Uses: idx_document_ids_grant (lookup) + idx_document_ids_assignment (join)
```

---

#### Entities & Representatives

```sql
-- Entities: Case-insensitive name lookup
CREATE UNIQUE INDEX idx_entities_name_lower ON entities(LOWER(name));

-- Representative FK
CREATE INDEX idx_entities_representative ON entities(representative_id);

-- Frequency sorting
CREATE INDEX idx_entities_instances ON entities(instances DESC);

-- Full-text search
CREATE INDEX idx_entities_name_fts ON entities USING gin(to_tsvector('english', name));

-- Representatives: Case-insensitive name lookup
CREATE UNIQUE INDEX idx_representatives_name_lower ON representatives(LOWER(representative_name));

-- Frequency sorting
CREATE INDEX idx_representatives_instances ON representatives(total_instances DESC);

-- Full-text search
CREATE INDEX idx_representatives_name_fts ON representatives 
  USING gin(to_tsvector('english', representative_name));

-- Query Pattern: Search entities by name prefix
-- SELECT * FROM entities WHERE LOWER(name) LIKE 'apple%' ORDER BY instances DESC LIMIT 20
-- Uses: idx_entities_name_lower + idx_entities_instances
```

---

#### Assignors & Assignees

```sql
-- Assignors: FK indexes
CREATE INDEX idx_assignors_assignment ON assignors(assignment_id);
CREATE INDEX idx_assignors_entity ON assignors(entity_id);
CREATE INDEX idx_assignors_composite ON assignors(assignment_id, entity_id);

-- Assignees: FK indexes
CREATE INDEX idx_assignees_assignment ON assignees(assignment_id);
CREATE INDEX idx_assignees_entity ON assignees(entity_id);
CREATE INDEX idx_assignees_composite ON assignees(assignment_id, entity_id);

-- Assignee location search
CREATE INDEX idx_assignees_location ON assignees(ee_country, ee_state, ee_city);

-- Query Pattern: Get all assignors for an entity
-- SELECT * FROM assignors WHERE entity_id = 'X'
-- Uses: idx_assignors_entity
```

---

#### Assignment Conveyances

```sql
-- Unique on assignment_id (automatic)
CREATE UNIQUE INDEX idx_conveyances_assignment ON assignment_conveyances(assignment_id);

-- Type filtering
CREATE INDEX idx_conveyances_type ON assignment_conveyances(convey_ty);

-- Employee flag filter (partial index)
CREATE INDEX idx_conveyances_employer ON assignment_conveyances(employer_assign) 
  WHERE employer_assign = TRUE;

-- Query Pattern: Find all employee assignments
-- SELECT a.* FROM assignments a JOIN assignment_conveyances c ON a.id = c.assignment_id WHERE c.employer_assign = TRUE
-- Uses: idx_conveyances_employer
```

---

### 6.3 CPC Classification Indexes

```sql
-- CPC Classifications
CREATE UNIQUE INDEX idx_cpc_code ON cpc_classifications(cpc_code);
CREATE INDEX idx_cpc_parent ON cpc_classifications(parent_id);
CREATE INDEX idx_cpc_section ON cpc_classifications(section);
CREATE INDEX idx_cpc_class ON cpc_classifications(section, class);
CREATE INDEX idx_cpc_level ON cpc_classifications(level);

-- Tree traversal (recursive CTEs)
CREATE INDEX idx_cpc_tree ON cpc_classifications(parent_id, level, cpc_code);

-- Patent CPC Codes
CREATE INDEX idx_patent_cpc_doc_num ON patent_cpc_codes(patent_doc_num, patent_type);
CREATE INDEX idx_patent_cpc_classification ON patent_cpc_codes(cpc_classification_id);
CREATE INDEX idx_patent_cpc_code ON patent_cpc_codes(cpc_code);
CREATE INDEX idx_patent_cpc_level ON patent_cpc_codes(cpc_level);

-- Composite for common query: find patents in CPC hierarchy
CREATE INDEX idx_patent_cpc_composite ON patent_cpc_codes(patent_doc_num, cpc_code, patent_type);

-- Query Pattern: Find patents in CPC class H04L
-- SELECT DISTINCT patent_doc_num FROM patent_cpc_codes WHERE cpc_code LIKE 'H04L%'
-- Uses: idx_patent_cpc_code (prefix search)
```

---

### 6.4 Multi-Tenant & Organization Indexes

#### Organizations

```sql
-- Unique name and slug (case-insensitive)
CREATE UNIQUE INDEX idx_organizations_name ON organizations(LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;

-- Status filter
CREATE INDEX idx_organizations_status ON organizations(status) WHERE deleted_at IS NULL;

-- Representative FK
CREATE INDEX idx_organizations_representative ON organizations(representative_id);

-- Query Pattern: List active organizations
-- SELECT * FROM organizations WHERE status = 'active' AND deleted_at IS NULL ORDER BY name
-- Uses: idx_organizations_status + idx_organizations_name
```

---

#### Users

```sql
-- Unique email (case-insensitive, soft delete aware)
CREATE UNIQUE INDEX idx_users_email ON users(LOWER(email)) WHERE deleted_at IS NULL;

-- Unique username per organization
CREATE UNIQUE INDEX idx_users_username ON users(organization_id, LOWER(username)) WHERE deleted_at IS NULL;

-- Organization FK (RLS queries)
CREATE INDEX idx_users_organization ON users(organization_id) WHERE deleted_at IS NULL;

-- Role filtering
CREATE INDEX idx_users_role ON users(role_type) WHERE deleted_at IS NULL;

-- Status filter
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;

-- Token lookups
CREATE INDEX idx_users_verification ON users(email_verification_token) 
  WHERE email_verification_token IS NOT NULL;
CREATE INDEX idx_users_reset ON users(password_reset_token) 
  WHERE password_reset_token IS NOT NULL;

-- Query Pattern: Login (email lookup)
-- SELECT * FROM users WHERE LOWER(email) = 'user@example.com' AND deleted_at IS NULL
-- Uses: idx_users_email
```

---

### 6.5 Derived Data Indexes (Dashboard, Trees, Timeline)

#### Ownership Tree Nodes

```sql
-- Organization scoping (RLS)
CREATE INDEX idx_tree_organization ON ownership_tree_nodes(organization_id);

-- Representative filtering
CREATE INDEX idx_tree_representative ON ownership_tree_nodes(representative_id);

-- Entity FK
CREATE INDEX idx_tree_entity ON ownership_tree_nodes(entity_id);

-- Parent FK (tree traversal)
CREATE INDEX idx_tree_parent ON ownership_tree_nodes(parent_id);

-- Type and tab filtering
CREATE INDEX idx_tree_type ON ownership_tree_nodes(tree_type);
CREATE INDEX idx_tree_tab ON ownership_tree_nodes(tree_tab);

-- Composite for dashboard tree query (most common)
CREATE INDEX idx_tree_composite ON ownership_tree_nodes(organization_id, representative_id, tree_tab);

-- Tree traversal optimization
CREATE INDEX idx_tree_path ON ownership_tree_nodes(parent_id, depth, id);

-- Query Pattern: Get ownership tree for org + representative
-- SELECT * FROM ownership_tree_nodes WHERE organization_id = 'X' AND representative_id = 'Y' AND tree_tab = 1
-- Uses: idx_tree_composite (covering index)
```

---

#### Dashboard Items

```sql
-- Organization scoping (RLS)
CREATE INDEX idx_dashboard_org ON dashboard_items(organization_id);

-- Representative filtering
CREATE INDEX idx_dashboard_representative ON dashboard_items(representative_id);

-- Entity filtering
CREATE INDEX idx_dashboard_entity ON dashboard_items(entity_id);

-- Type filtering (BR-037)
CREATE INDEX idx_dashboard_type ON dashboard_items(type);

-- Composite for dashboard load (CRITICAL for performance)
CREATE INDEX idx_dashboard_composite ON dashboard_items(organization_id, representative_id, type);

-- Assignment FK
CREATE INDEX idx_dashboard_assignment ON dashboard_items(assignment_id);

-- Query Pattern: Dashboard load (target <200ms)
-- SELECT type, COUNT(*) FROM dashboard_items WHERE organization_id = 'X' AND representative_id = 'Y' GROUP BY type
-- Uses: idx_dashboard_composite (index-only scan)
```

---

#### Timeline Entries

```sql
-- Organization scoping
CREATE INDEX idx_timeline_org ON timeline_entries(organization_id);

-- Representative filtering
CREATE INDEX idx_timeline_representative ON timeline_entries(representative_id);

-- Assignment FK
CREATE INDEX idx_timeline_assignment ON timeline_entries(assignment_id);

-- Date sorting (DESC for recent-first queries)
CREATE INDEX idx_timeline_record_dt ON timeline_entries(record_dt DESC);

-- Sequence ordering
CREATE INDEX idx_timeline_sequence ON timeline_entries(sequence);

-- Composite for timeline query
CREATE INDEX idx_timeline_composite ON timeline_entries(organization_id, representative_id, record_dt DESC);

-- Query Pattern: Get timeline for org + representative
-- SELECT * FROM timeline_entries WHERE organization_id = 'X' AND representative_id = 'Y' ORDER BY record_dt DESC LIMIT 100
-- Uses: idx_timeline_composite (covering index)
```

---

#### Summary Metrics

```sql
-- Unique constraint on org + representative
CREATE UNIQUE INDEX idx_summary_org_rep ON summary_metrics(
  organization_id, 
  COALESCE(representative_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Organization lookup
CREATE INDEX idx_summary_org ON summary_metrics(organization_id);

-- Representative lookup (partial index for non-NULL)
CREATE INDEX idx_summary_representative ON summary_metrics(representative_id) 
  WHERE representative_id IS NOT NULL;

-- Freshness tracking
CREATE INDEX idx_summary_calculated ON summary_metrics(calculated_at DESC);

-- Query Pattern: Get org-level summary
-- SELECT * FROM summary_metrics WHERE organization_id = 'X' AND representative_id IS NULL
-- Uses: idx_summary_org_rep (unique index lookup)
```

---

### 6.6 Ingestion & Processing Indexes

```sql
-- Data Sources
CREATE UNIQUE INDEX idx_data_sources_name ON data_sources(name);
CREATE INDEX idx_data_sources_active ON data_sources(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_data_sources_next_run ON data_sources(next_run_at) WHERE is_active = TRUE;

-- Ingestion Jobs
CREATE INDEX idx_ingestion_jobs_source ON ingestion_jobs(data_source_id);
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_started ON ingestion_jobs(started_at DESC);
CREATE INDEX idx_ingestion_jobs_completed ON ingestion_jobs(completed_at DESC);

-- Ingestion Errors
CREATE INDEX idx_ingestion_errors_job ON ingestion_errors(ingestion_job_id);
CREATE INDEX idx_ingestion_errors_type ON ingestion_errors(error_type);
CREATE INDEX idx_ingestion_errors_identifier ON ingestion_errors(record_identifier);

-- Processing Jobs
CREATE INDEX idx_processing_jobs_org ON processing_jobs(organization_id);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX idx_processing_jobs_started ON processing_jobs(started_at DESC);
CREATE INDEX idx_processing_jobs_triggered_by ON processing_jobs(triggered_by);

-- Processing Steps
CREATE INDEX idx_processing_steps_job ON processing_steps(processing_job_id);
CREATE INDEX idx_processing_steps_step_number ON processing_steps(step_number);
CREATE INDEX idx_processing_steps_status ON processing_steps(status);
CREATE UNIQUE INDEX idx_processing_steps_unique ON processing_steps(processing_job_id, step_number);
```

---

### 6.7 Full-Text Search Strategy

**Tables with FTS**:
- `patents.title`
- `entities.name`
- `representatives.representative_name`
- `inventors.canonical_name`
- `assignments.convey_text` (for debugging/analysis)

**Index Type**: GIN (Generalized Inverted Index)

**Example**:
```sql
-- Full-text search index
CREATE INDEX idx_entities_name_fts ON entities 
  USING gin(to_tsvector('english', name));

-- Query
SELECT * FROM entities 
WHERE to_tsvector('english', name) @@ to_tsquery('english', 'apple & computer')
ORDER BY ts_rank(to_tsvector('english', name), to_tsquery('english', 'apple & computer')) DESC
LIMIT 20;
```

**Performance**: ~100-500ms for typical name searches across millions of records

---

### 6.8 Index Maintenance

**Recommendations**:
1. **Auto-vacuum**: Enable aggressive auto-vacuum for high-write tables (assignments, document_ids)
2. **Reindexing**: Monthly REINDEX on large tables to prevent index bloat
3. **Statistics**: Daily ANALYZE on large tables to keep query planner statistics fresh
4. **Monitoring**: Track index usage with `pg_stat_user_indexes` and drop unused indexes

```sql
-- Monitor index usage
SELECT 
  schemaname, 
  tablename, 
  indexname, 
  idx_scan, 
  idx_tup_read, 
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Identify missing indexes (slow queries)
-- Use pg_stat_statements extension to find queries doing sequential scans on large tables
```

---

## 7. Data Integrity Constraints

This section documents all constraints, cascades, and validation rules enforced at the database level.

### 7.1 Primary Keys

**Policy**: All tables have UUID primary keys

```sql
-- Pattern for all tables
CREATE TABLE example_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);
```

**Rationale**:
- UUIDs prevent auto-increment collisions across distributed systems
- Enable offline data generation and merging
- Compatible with Prisma/Drizzle ORMs

---

### 7.2 Foreign Keys & Cascades

#### CASCADE DELETE

**Use Cases**: Child records should be deleted when parent is deleted

```sql
-- Document IDs depend on assignments
ALTER TABLE document_ids
  ADD CONSTRAINT fk_document_ids_assignment 
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE;

-- Assignors/assignees depend on assignments
ALTER TABLE assignors
  ADD CONSTRAINT fk_assignors_assignment
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE;

ALTER TABLE assignees
  ADD CONSTRAINT fk_assignees_assignment
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE;

-- Users depend on organizations
ALTER TABLE users
  ADD CONSTRAINT fk_users_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- All org-scoped tables cascade on organization deletion
ALTER TABLE assets, dashboard_items, timeline_entries, summary_metrics, processing_jobs, etc.
  ADD CONSTRAINT fk_{table}_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
```

#### RESTRICT DELETE

**Use Cases**: Prevent deletion of parent if children exist

```sql
-- Cannot delete entity if referenced by assignors/assignees
ALTER TABLE assignors
  ADD CONSTRAINT fk_assignors_entity
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE RESTRICT;

ALTER TABLE assignees
  ADD CONSTRAINT fk_assignees_entity
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE RESTRICT;

-- Cannot delete representative if entities reference it
ALTER TABLE entities
  ADD CONSTRAINT fk_entities_representative
  FOREIGN KEY (representative_id) REFERENCES representatives(id) ON DELETE RESTRICT;
```

#### SET NULL

**Use Cases**: Preserve child record but break relationship

```sql
-- If user is deleted, preserve activities but remove user reference (soft delete handles this)
-- Not commonly used in this schema due to soft delete pattern
```

---

### 7.3 Unique Constraints

```sql
-- Patents: Unique patent numbers
ALTER TABLE patents
  ADD CONSTRAINT uk_patents_appno UNIQUE (appno_doc_num),
  ADD CONSTRAINT uk_patents_grant UNIQUE (grant_doc_num);

-- Assignments: Unique rf_id
ALTER TABLE assignments
  ADD CONSTRAINT uk_assignments_rf_id UNIQUE (rf_id);

-- Entities: Unique normalized name
ALTER TABLE entities
  ADD CONSTRAINT uk_entities_name UNIQUE (LOWER(name));

-- Representatives: Unique canonical name
ALTER TABLE representatives
  ADD CONSTRAINT uk_representatives_name UNIQUE (LOWER(representative_name));

-- Organizations: Unique name and slug (soft delete aware)
CREATE UNIQUE INDEX uk_organizations_name ON organizations(LOWER(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uk_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;

-- Users: Unique email (global), unique username (per org, soft delete aware)
CREATE UNIQUE INDEX uk_users_email ON users(LOWER(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uk_users_username ON users(organization_id, LOWER(username)) WHERE deleted_at IS NULL;

-- Assignment Conveyances: One per assignment
ALTER TABLE assignment_conveyances
  ADD CONSTRAINT uk_conveyances_assignment UNIQUE (assignment_id);

-- Share Links: Unique share code
ALTER TABLE share_links
  ADD CONSTRAINT uk_share_links_code UNIQUE (share_code);
```

---

### 7.4 Check Constraints

**Transaction Types**:
```sql
ALTER TABLE assignment_conveyances
  ADD CONSTRAINT chk_convey_ty CHECK (convey_ty IN (
    'assignment', 'employee', 'merger', 'namechg', 'correct', 
    'govern', 'license', 'release', 'security', 'missing'
  ));
```

**Tree Types**:
```sql
ALTER TABLE ownership_tree_nodes
  ADD CONSTRAINT chk_tree_type CHECK (tree_type BETWEEN 0 AND 13),
  ADD CONSTRAINT chk_tree_tab CHECK (tree_tab BETWEEN 0 AND 3);
```

**Dashboard Types**:
```sql
ALTER TABLE dashboard_items
  ADD CONSTRAINT chk_dashboard_type CHECK (type IN (0, 1, 18, 20, 30, 31, 32, 33, 34, 35, 36));
```

**User Roles**:
```sql
ALTER TABLE users
  ADD CONSTRAINT chk_role_type CHECK (role_type IN (0, 1, 9) OR role_type IS NULL);
```

**Environment Modes**:
```sql
ALTER TABLE customer_configurations
  ADD CONSTRAINT chk_environment_mode CHECK (environment_mode IN (
    'PRO', 'KPI', 'DASHBOARD', 'SAMPLE', 'SAMPLE-1', 'STANDARD'
  ));
```

**Patent Layouts**:
```sql
ALTER TABLE patents
  ADD CONSTRAINT chk_layout_id CHECK (layout_id IN (14, 15));
```

**Status Values**:
```sql
ALTER TABLE assignments
  ADD CONSTRAINT chk_status CHECK (status IN ('active', 'void'));

ALTER TABLE users
  ADD CONSTRAINT chk_user_status CHECK (status IN ('active', 'inactive', 'pending'));

ALTER TABLE organizations
  ADD CONSTRAINT chk_org_status CHECK (status IN ('active', 'trial', 'suspended', 'cancelled'));
```

**Job Statuses**:
```sql
ALTER TABLE ingestion_jobs
  ADD CONSTRAINT chk_ingestion_status CHECK (status IN ('pending', 'running', 'success', 'failed', 'partial'));

ALTER TABLE processing_jobs
  ADD CONSTRAINT chk_processing_status CHECK (status IN ('pending', 'running', 'success', 'failed', 'partial'));
```

**Share Link Scopes**:
```sql
ALTER TABLE share_links
  ADD CONSTRAINT chk_access_scope CHECK (access_scope IN ('read_only', 'comment', 'annotate'));
```

**Patent Identifiers**:
```sql
ALTER TABLE patents
  ADD CONSTRAINT chk_patent_has_identifier CHECK (
    appno_doc_num IS NOT NULL OR grant_doc_num IS NOT NULL
  );

ALTER TABLE document_ids
  ADD CONSTRAINT chk_document_has_patent CHECK (
    appno_doc_num IS NOT NULL OR grant_doc_num IS NOT NULL
  );

ALTER TABLE assets
  ADD CONSTRAINT chk_asset_has_patent CHECK (
    appno_doc_num IS NOT NULL OR grant_doc_num IS NOT NULL
  );
```

---

### 7.5 NOT NULL Requirements

**Core Entity Fields**:
```sql
-- All tables: ID, timestamps
ALTER TABLE {all_tables}
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

-- Assignments
ALTER TABLE assignments
  ALTER COLUMN rf_id SET NOT NULL;

-- Entities & Representatives
ALTER TABLE entities
  ALTER COLUMN name SET NOT NULL;

ALTER TABLE representatives
  ALTER COLUMN representative_name SET NOT NULL;

-- Users
ALTER TABLE users
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN username SET NOT NULL,
  ALTER COLUMN password_hash SET NOT NULL;

-- Organizations
ALTER TABLE organizations
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL;

-- Foreign Keys (generally NOT NULL for child records)
ALTER TABLE document_ids
  ALTER COLUMN assignment_id SET NOT NULL;

ALTER TABLE assignors
  ALTER COLUMN assignment_id SET NOT NULL,
  ALTER COLUMN entity_id SET NOT NULL;

ALTER TABLE assignees
  ALTER COLUMN assignment_id SET NOT NULL,
  ALTER COLUMN entity_id SET NOT NULL;
```

---

### 7.6 Default Values

```sql
-- UUIDs
ALTER TABLE {all_tables}
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Timestamps
ALTER TABLE {all_tables}
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- Status flags
ALTER TABLE assignments
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE users
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE organizations
  ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE assignment_conveyances
  ALTER COLUMN employer_assign SET DEFAULT FALSE;

-- Counts and metrics
ALTER TABLE entities
  ALTER COLUMN instances SET DEFAULT 1;

ALTER TABLE representatives
  ALTER COLUMN total_instances SET DEFAULT 0;

ALTER TABLE share_links
  ALTER COLUMN use_count SET DEFAULT 0;

ALTER TABLE ownership_tree_nodes
  ALTER COLUMN depth SET DEFAULT 0;

-- Configuration defaults
ALTER TABLE customer_configurations
  ALTER COLUMN environment_mode SET DEFAULT 'STANDARD',
  ALTER COLUMN default_layout_id SET DEFAULT 15,
  ALTER COLUMN filter_date_from SET DEFAULT '1999-01-01';

-- Job defaults
ALTER TABLE ingestion_jobs
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN records_processed SET DEFAULT 0,
  ALTER COLUMN records_inserted SET DEFAULT 0,
  ALTER COLUMN records_updated SET DEFAULT 0,
  ALTER COLUMN records_failed SET DEFAULT 0;

ALTER TABLE processing_jobs
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN current_step SET DEFAULT 0;
```

---

### 7.7 Database Triggers

#### Auto-Update Timestamps

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER tr_update_timestamp
  BEFORE UPDATE ON {table}
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

#### Share Link Validation

```sql
CREATE OR REPLACE FUNCTION validate_share_link()
RETURNS TRIGGER AS $$
DECLARE
  link RECORD;
BEGIN
  -- Get share link details
  SELECT * INTO link FROM share_links WHERE share_code = NEW.share_link_id;
  
  -- Check expiration
  IF link.expires_at IS NOT NULL AND link.expires_at < NOW() THEN
    RAISE EXCEPTION 'Share link has expired';
  END IF;
  
  -- Check usage limit
  IF link.max_uses IS NOT NULL AND link.use_count >= link.max_uses THEN
    RAISE EXCEPTION 'Share link usage limit exceeded';
  END IF;
  
  -- Increment use count
  UPDATE share_links SET use_count = use_count + 1 WHERE id = link.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_validate_share_access
  BEFORE INSERT ON share_access_logs
  FOR EACH ROW
  EXECUTE FUNCTION validate_share_link();
```

#### Representative Total Instances

```sql
CREATE OR REPLACE FUNCTION update_representative_instances()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE representatives
    SET total_instances = (
      SELECT COALESCE(SUM(instances), 0)
      FROM entities
      WHERE representative_id = NEW.representative_id
    )
    WHERE id = NEW.representative_id;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    UPDATE representatives
    SET total_instances = (
      SELECT COALESCE(SUM(instances), 0)
      FROM entities
      WHERE representative_id = OLD.representative_id
    )
    WHERE id = OLD.representative_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_entity_instances
  AFTER INSERT OR UPDATE OR DELETE ON entities
  FOR EACH ROW
  EXECUTE FUNCTION update_representative_instances();
```

---

### 7.8 Constraint Summary Table

| Constraint Type | Count | Examples |
|----------------|-------|----------|
| Primary Keys | 40+ | All tables have UUID PKs |
| Foreign Keys | 80+ | Assignment relationships, org scoping |
| Unique Constraints | 20+ | rf_id, email, slug, share_code |
| Check Constraints | 30+ | Enum values, status codes, type ranges |
| NOT NULL | 200+ | Core fields, FKs, identifiers |
| Default Values | 50+ | UUIDs, timestamps, status, counts |
| Triggers | 5+ | Timestamp updates, share validation, instance counts |

---

## Conclusion

This domain model document provides a comprehensive foundation for implementing PatenTrack3's unified PostgreSQL database. The design:

✅ **Consolidates 9 databases** into a single schema with Row-Level Security  
✅ **Preserves all 65 business rules** through database constraints and application logic  
✅ **Scales to 50M+ assignments**, 200M+ document IDs, <100 tenants  
✅ **Fixes security vulnerabilities** (BR-045: share scope, BR-046: expiration)  
✅ **Optimizes query performance** with targeted indexes and materialized data  
✅ **Enables ORM compatibility** with Prisma/Drizzle  
✅ **Maintains data integrity** through comprehensive constraints and triggers  

### Next Steps

1. **Review & Approval**: Stakeholder review of domain model and schema design
2. **Schema Generation**: Generate DDL scripts from this document
3. **Migration Scripts**: Implement migration tools (pgloader, custom scripts)
4. **Testing Strategy**: Define integration tests for all 65 business rules
5. **Performance Benchmarking**: Validate query performance targets
6. **ORM Implementation**: Map schema to Prisma/Drizzle models
7. **API Refactoring**: Consolidate 388 endpoints to ~80 using new schema
8. **Documentation**: API documentation, developer guides, runbooks

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-08  
**Status**: Ready for Review

