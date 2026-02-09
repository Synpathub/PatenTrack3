# PatenTrack3 System Architecture

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Draft — Parts A & B (Sections 1–4, 7–8)

> **Note:** This document currently covers Sections 1 through 4 (Part A) and Sections 7–8 (Part B — API Design Principles & Deployment Infrastructure). Sections 5, 6, and 9 (Caching Strategy, Frontend Architecture, Testing Strategy) will be added in follow-up sessions.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Redesign](#2-data-flow-redesign)
3. [Authentication & Authorization Architecture](#3-authentication--authorization-architecture)
4. [Ingestion Pipeline Architecture](#4-ingestion-pipeline-architecture)
5. _(Future)_ Caching & Performance Strategy
6. _(Future)_ Frontend Architecture
7. [API Design Principles](#7-api-design-principles)
8. [Deployment & Infrastructure](#8-deployment--infrastructure)
9. _(Future)_ Testing Strategy

---

## 1. Architecture Overview

### 1.1 High-Level System Diagram

```mermaid
graph TB
    subgraph "External Data Sources"
        USPTO_PASDL["USPTO PASDL<br/>(Daily Assignments)"]
        USPTO_BULK["USPTO Bulk Data<br/>(Weekly ~12GB)"]
        USPTO_CPC["USPTO CPC<br/>(Monthly)"]
        USPTO_MAINT["USPTO Maintenance Fees<br/>(Weekly)"]
        EPO["EPO OPS API<br/>(On-demand)"]
        ENRICHMENT["Enrichment APIs<br/>(Clearbit, RiteKit, etc.)"]
    end

    subgraph "Ingestion Layer"
        SCHEDULER["BullMQ Scheduler<br/>(Cron-based)"]
        WORKERS["Ingestion Workers<br/>(TypeScript)"]
        PIPELINE["Org Pipeline Workers<br/>(8-step DAG)"]
    end

    subgraph "Data Layer"
        PG[("PostgreSQL 16+<br/>Single DB w/ RLS<br/>50M+ assignments<br/>200M+ doc IDs")]
        REDIS[("Redis 7+<br/>Cache + Job Queue<br/>+ Session Store")]
    end

    subgraph "Application Layer"
        API["Next.js 15+ API Routes<br/>(BFF — ~80 endpoints)"]
        WORKER_PROC["Background Worker Process<br/>(BullMQ consumers)"]
    end

    subgraph "Frontend (Next.js 15+ App Router)"
        WEB_CUSTOMER["Customer Dashboard<br/>(replaces PT-App)"]
        WEB_ADMIN["Admin Panel<br/>(replaces PT-Admin)"]
        WEB_SHARE["Share Viewer<br/>(replaces PT-Share)"]
    end

    subgraph "Observability"
        SENTRY["Sentry<br/>(Error Tracking)"]
        BULL_BOARD["BullMQ Board<br/>(Job Dashboard)"]
        METRICS["Prometheus + Grafana<br/>(Metrics)"]
    end

    USPTO_PASDL --> SCHEDULER
    USPTO_BULK --> SCHEDULER
    USPTO_CPC --> SCHEDULER
    USPTO_MAINT --> SCHEDULER
    EPO --> WORKERS
    ENRICHMENT --> WORKERS

    SCHEDULER --> WORKERS
    WORKERS --> PG
    WORKERS --> REDIS
    WORKERS -->|"affected orgs"| PIPELINE
    PIPELINE --> PG

    API --> PG
    API --> REDIS
    API --> WORKER_PROC

    WORKER_PROC --> PG
    WORKER_PROC --> REDIS
    WORKER_PROC --> PIPELINE

    WEB_CUSTOMER --> API
    WEB_ADMIN --> API
    WEB_SHARE --> API

    API --> SENTRY
    WORKER_PROC --> SENTRY
    WORKER_PROC --> BULL_BOARD
    API --> METRICS
```

### 1.2 Monorepo Structure

```
patentrack3/
├── apps/
│   ├── web/                          # Next.js 15+ (App Router)
│   │   ├── app/
│   │   │   ├── (auth)/               # Login, register, password reset
│   │   │   ├── (dashboard)/          # Customer dashboard (replaces PT-App)
│   │   │   ├── (admin)/              # Admin panel (replaces PT-Admin)
│   │   │   ├── share/[code]/         # Public share viewer (replaces PT-Share)
│   │   │   └── api/                  # Next.js API routes (~80 endpoints)
│   │   │       ├── auth/             # Auth endpoints
│   │   │       ├── assets/           # Asset CRUD
│   │   │       ├── dashboards/       # Dashboard data
│   │   │       ├── events/           # Event tabs, maintenance fees
│   │   │       ├── families/         # EPO patent families
│   │   │       ├── organizations/    # Org management
│   │   │       ├── admin/            # Admin endpoints
│   │   │       ├── share/            # Share link management
│   │   │       ├── ingestion/        # Ingestion status/triggers (admin)
│   │   │       └── webhooks/         # External webhooks
│   │   ├── middleware.ts             # Auth validation, RLS context
│   │   └── next.config.ts
│   └── worker/                       # Background worker process
│       ├── src/
│       │   ├── consumers/            # BullMQ job consumers
│       │   │   ├── ingest-assignments.ts
│       │   │   ├── ingest-grants.ts
│       │   │   ├── ingest-applications.ts
│       │   │   ├── ingest-cpc.ts
│       │   │   ├── ingest-maintenance-fees.ts
│       │   │   ├── ingest-epo-family.ts
│       │   │   ├── enrich-company.ts
│       │   │   └── pipeline-org.ts   # 8-step DAG orchestrator
│       │   ├── scheduler.ts          # Cron → BullMQ job scheduling
│       │   └── index.ts              # Worker entry point
│       └── package.json
├── packages/
│   ├── db/                           # Database layer
│   │   ├── schema/                   # Drizzle schema definitions
│   │   │   ├── patents.ts
│   │   │   ├── assignments.ts
│   │   │   ├── organizations.ts
│   │   │   ├── users.ts
│   │   │   ├── ingestion.ts
│   │   │   └── index.ts
│   │   ├── migrations/               # Version-controlled migrations
│   │   ├── rls-policies.sql          # Row-Level Security policies
│   │   ├── seed.ts                   # Seed data for development
│   │   └── client.ts                 # Database client with RLS helpers
│   ├── business-rules/               # 65 business rules as tested modules
│   │   ├── classification/           # BR-001 to BR-012
│   │   │   ├── classify-conveyance.ts
│   │   │   ├── priority-resolver.ts
│   │   │   └── __tests__/
│   │   ├── normalization/            # BR-013 to BR-020
│   │   │   ├── normalize-entity-name.ts
│   │   │   ├── levenshtein-grouping.ts
│   │   │   ├── canonical-name-selector.ts
│   │   │   └── __tests__/
│   │   ├── inventor-matching/        # BR-021 to BR-023
│   │   │   ├── name-variations.ts
│   │   │   ├── match-inventor-to-assignor.ts
│   │   │   └── __tests__/
│   │   ├── ownership-tree/           # BR-024 to BR-031
│   │   │   ├── build-tree.ts
│   │   │   ├── tree-type-resolver.ts
│   │   │   ├── color-mapper.ts
│   │   │   └── __tests__/
│   │   ├── broken-title/             # BR-032 to BR-036
│   │   │   ├── detect-broken-chains.ts
│   │   │   ├── chain-validator.ts
│   │   │   └── __tests__/
│   │   ├── dashboard/                # BR-037 to BR-043
│   │   │   ├── dashboard-aggregator.ts
│   │   │   ├── summary-calculator.ts
│   │   │   └── __tests__/
│   │   └── index.ts
│   ├── ingestion/                    # Data ingestion pipeline
│   │   ├── downloaders/              # Source-specific downloaders
│   │   │   ├── uspto-pasdl.ts
│   │   │   ├── uspto-bulk.ts
│   │   │   ├── epo-ops.ts
│   │   │   └── enrichment.ts
│   │   ├── parsers/                  # Format-specific parsers
│   │   │   ├── xml-streaming.ts      # SAX-based for 12GB files
│   │   │   ├── tab-delimited.ts
│   │   │   └── json.ts
│   │   ├── transformers/             # Data transformation
│   │   │   ├── assignment-transformer.ts
│   │   │   ├── bibliographic-transformer.ts
│   │   │   └── cpc-transformer.ts
│   │   ├── loaders/                  # Database loaders (upsert logic)
│   │   │   ├── batch-upsert.ts       # Generic ON CONFLICT DO UPDATE
│   │   │   └── bulk-loader.ts        # COPY-based bulk loading
│   │   └── index.ts
│   ├── shared/                       # Shared types, utils, constants
│   │   ├── types/
│   │   │   ├── patent.ts
│   │   │   ├── assignment.ts
│   │   │   ├── organization.ts
│   │   │   ├── user.ts
│   │   │   ├── ingestion.ts
│   │   │   └── api.ts
│   │   ├── constants/
│   │   │   ├── conveyance-types.ts   # BR-001 to BR-012 enums
│   │   │   ├── tree-types.ts         # BR-024 to BR-031 enums
│   │   │   ├── dashboard-types.ts    # BR-037 enums
│   │   │   └── roles.ts             # BR-048, BR-049
│   │   ├── utils/
│   │   │   ├── levenshtein.ts
│   │   │   ├── name-utils.ts
│   │   │   └── date-utils.ts
│   │   └── index.ts
│   └── ui/                           # Shared React components
│       ├── components/
│       │   ├── ownership-diagram/    # D3 SVG ownership visualization
│       │   ├── timeline/             # Transaction timeline
│       │   ├── data-table/           # Virtualized data table
│       │   ├── cpc-word-cloud/       # CPC classification word cloud
│       │   └── pdf-viewer/           # Patent PDF viewer
│       └── index.ts
├── tools/
│   └── scripts/
│       ├── migrate-legacy/           # Legacy data migration scripts
│       │   ├── phase1-core-patent.ts
│       │   ├── phase2-bibliographic.ts
│       │   ├── phase3-organizations.ts
│       │   ├── phase4-computed.ts
│       │   └── phase5-ingestion-meta.ts
│       ├── seed-dev-data.ts
│       └── validate-migration.ts
├── turbo.json
├── package.json
├── tsconfig.json                     # Base TypeScript config
└── .env.example
```

### 1.3 API Server Decision: Hybrid (Option C)

**Decision:** Next.js API routes as BFF + separate worker process for background jobs.

**Rationale:**

| Concern | Next.js API Routes | Separate Worker Process |
|---------|-------------------|------------------------|
| Request-response API (~80 endpoints) | ✅ Handled by Next.js | — |
| SSR/RSC data loading | ✅ Direct DB access in Server Components | — |
| Auth middleware | ✅ Next.js middleware | — |
| Heavy background processing (12GB ingestion) | ❌ Would block/timeout | ✅ Long-running BullMQ consumers |
| 8-step org pipeline (minutes per org) | ❌ Request timeout | ✅ DAG execution w/ retries |
| Cron scheduling | ❌ Not native | ✅ BullMQ repeatable jobs |
| WebSocket/SSE for real-time updates | ✅ Next.js SSE via route handlers | ✅ Can push job status events |
| Scale independently | — | ✅ Scale workers by queue depth |

**Why not a full separate Fastify server?**
- At <100 tenants and ~80 endpoints, a separate API server adds deployment complexity without sufficient benefit.
- Next.js API routes handle request-response efficiently and share the deployment with the frontend.
- Server Components can query the database directly, eliminating round-trips for server-rendered pages.
- The worker process is the only component that needs to run independently (for long-running ingestion jobs and pipeline processing).

**Why not Next.js only?**
- 12GB file ingestion would exceed serverless/edge function timeouts.
- The 8-step org pipeline runs for minutes per organization and should not compete with HTTP request resources.
- BullMQ requires a persistent Node.js process to consume jobs.

### 1.4 Key Technology Decisions

| Component | Technology | Justification |
|-----------|-----------|---------------|
| **Framework** | Next.js 15+ (App Router) | Server Components, API routes, SSR/SSG, middleware |
| **Language** | TypeScript (strict mode) | Type safety, shared types across all packages |
| **Database** | PostgreSQL 16+ | RLS, JSONB, partitioning, full-text search, 50M+ scale |
| **ORM** | Drizzle ORM | TypeScript-native, SQL-first, RLS-compatible, lighter than Prisma for heavy queries |
| **Cache/Queue** | Redis 7+ (via ioredis) | BullMQ job queues, session store, query cache |
| **Job Queue** | BullMQ | Reliable, Redis-backed, DAG support, repeatable jobs, dashboard |
| **Monorepo** | Turborepo | Fast incremental builds, task caching, simple config |
| **Auth** | Custom JWT + httpOnly cookies | Replacing 3 auth implementations; no external dependency needed at <1000 users |
| **XML Parser** | sax-js (streaming) | Memory-efficient for 12GB XML files |
| **Visualization** | D3.js v7 | Preserving existing ownership diagram fidelity |
| **Testing** | Vitest + Playwright | Fast unit tests (Vitest), E2E tests (Playwright) |

### 1.5 Communication Patterns

```mermaid
graph LR
    subgraph "Synchronous (Request-Response)"
        BROWSER["Browser"] -->|"HTTPS"| NEXTJS["Next.js API Routes"]
        NEXTJS -->|"SQL (Drizzle)"| PG["PostgreSQL"]
        NEXTJS -->|"GET/SET"| REDIS["Redis Cache"]
    end

    subgraph "Asynchronous (Job Queue)"
        NEXTJS -->|"enqueue"| BULLMQ["BullMQ<br/>(Redis)"]
        BULLMQ -->|"consume"| WORKER["Worker Process"]
        WORKER -->|"SQL (Drizzle)"| PG
        WORKER -->|"enqueue child"| BULLMQ
    end

    subgraph "Real-Time (SSE)"
        WORKER -->|"publish"| REDIS_PUB["Redis Pub/Sub"]
        REDIS_PUB -->|"subscribe"| NEXTJS
        NEXTJS -->|"SSE stream"| BROWSER
    end
```

- **Synchronous:** Browser → Next.js API routes → PostgreSQL/Redis. Used for all CRUD operations, dashboard loads, search.
- **Asynchronous:** API enqueues jobs → BullMQ (Redis) → Worker consumes → writes to PostgreSQL. Used for ingestion, pipeline processing, enrichment.
- **Real-Time:** Worker publishes job status to Redis Pub/Sub → Next.js SSE route streams to browser. Used for pipeline progress, ingestion status.

---

## 2. Data Flow Redesign

### 2.1 Flow 1: Assignment/Transaction Data (Daily)

**Schedule:** Daily at 02:00 UTC  
**Source:** USPTO PASDL (ZIP → XML)  
**Business Rules:** BR-054 (API key auth), BR-058 (retry logic), BR-059 (idempotent upserts), BR-060 (8-step pipeline)

```mermaid
sequenceDiagram
    participant CRON as BullMQ Scheduler
    participant DL as Download Worker
    participant USPTO as USPTO PASDL API
    participant PARSE as Parse Worker
    participant PG as PostgreSQL
    participant DETECT as Affected Org Detector
    participant PIPE as Pipeline Worker
    participant CACHE as Redis Cache
    participant WEB as Next.js (SSE)

    CRON->>DL: ingest:assignments (daily 02:00 UTC)
    
    loop Retry up to 5x (BR-058)
        DL->>USPTO: GET /assignments/daily (x-api-key header, BR-054)
        alt HTTP 429
            DL->>DL: Sleep 1s, increment retry
        else HTTP 200
            USPTO-->>DL: ZIP/XML response
        end
    end
    
    DL->>PARSE: Parse XML → structured records
    
    loop For each assignment record
        PARSE->>PG: INSERT assignments ON CONFLICT(rf_id) DO UPDATE (BR-059)
        PARSE->>PG: INSERT document_ids ON CONFLICT DO UPDATE
        PARSE->>PG: INSERT assignors/assignees ON CONFLICT DO UPDATE
        PARSE->>PG: UPDATE ingestion_jobs (records_processed++)
    end
    
    PARSE->>DETECT: Identify affected organizations
    DETECT->>PG: SELECT DISTINCT org_id FROM assets WHERE patent IN (new assignments)
    
    loop For each affected org (NOT all orgs)
        DETECT->>PIPE: Enqueue pipeline:org:{orgId} (BR-060)
    end
    
    Note over PIPE: 8-Step DAG (see Section 4)
    PIPE->>PG: classify → flag → [tree ‖ timeline] → broken_title → [dashboard ‖ summary] → generate_json
    PIPE->>CACHE: Invalidate org-specific cache keys
    PIPE->>WEB: Publish pipeline:complete via Redis Pub/Sub
    WEB-->>WEB: SSE push to connected admin clients
```

**Key improvements over legacy:**
1. **Selective recomputation** — Only affected orgs are reprocessed (legacy ran all orgs every time)
2. **Idempotent upserts** — `ON CONFLICT ... DO UPDATE` instead of `INSERT IGNORE` (BR-059 upgrade)
3. **DAG parallelism** — Tree and timeline run in parallel; dashboard and summary run in parallel
4. **Cache invalidation** — Targeted invalidation per org instead of no caching at all
5. **Observability** — Every step tracked in `processing_steps` table with metrics

### 2.2 Flow 2: Bibliographic Data (Weekly, ~12GB/week)

**Schedule:** Tuesday 00:00 UTC (grants), Thursday 00:00 UTC (applications) — per BR-055  
**Source:** USPTO Bulk Red Book (TAR → ZIP → XML)  
**Business Rules:** BR-013–BR-020 (name normalization), BR-055 (schedule)

```mermaid
sequenceDiagram
    participant CRON as BullMQ Scheduler
    participant DL as Download Worker
    participant USPTO as USPTO Bulk Data
    participant STREAM as Streaming XML Parser
    participant NORM as Name Normalizer
    participant PG as PostgreSQL
    participant LEV as Levenshtein Grouper
    participant PIPE as Pipeline Workers

    CRON->>DL: ingest:grants (Tue) / ingest:applications (Thu)
    DL->>USPTO: Download TAR/ZIP (~12GB)
    DL->>DL: Extract to temp directory
    
    Note over STREAM: sax-js streaming parser<br/>Memory: O(1) not O(n)
    
    DL->>STREAM: Stream XML file(s)
    
    loop For each patent record (streaming)
        STREAM->>PG: UPSERT patents (appno_doc_num, grant_doc_num)
        STREAM->>PG: UPSERT inventors (patent_doc_num, name, city, country)
        
        STREAM->>NORM: Normalize entity names (BR-013 to BR-017)
        Note over NORM: "ACME CORPORATION" → "ACME CORP"<br/>"WIDGETS INCORPORATED" → "WIDGETS INC"<br/>"GMBH" suffix handling (BR-017)
        
        NORM->>PG: UPSERT entities (normalized name)
    end
    
    Note over LEV: Post-ingestion batch process
    
    STREAM->>LEV: Trigger entity resolution
    LEV->>PG: SELECT entities WHERE representative_id IS NULL
    
    loop For entity groups (sorted by word count DESC, BR-020)
        LEV->>LEV: Levenshtein distance < threshold (BR-018)
        LEV->>PG: Link entities → representative (BR-019: highest instance count = canonical)
    end
    
    LEV->>PIPE: Enqueue pipeline:org:{orgId} for orgs with updated entities
    
    DL->>DL: Clean up temp files
    DL->>PG: UPDATE ingestion_jobs (status=success, records_processed)
```

**Key improvements over legacy:**
1. **Single pipeline** — Eliminates PHP/Node duplication (legacy had both `patent_weekly_download.php` and `download_files.js`)
2. **Streaming XML parser** — sax-js processes 12GB files with constant memory (legacy loaded entire XML into memory)
3. **Batch entity resolution** — Levenshtein grouping runs once after all records are loaded, not per-record
4. **Transactional consistency** — Each patent record upserted in a transaction; entity resolution is a separate batch job

### 2.3 Flow 3: Patent Family Data (EPO)

**Schedule:** On-demand (triggered when user views patent family, or after new assignments)  
**Source:** EPO OPS REST API (OAuth2, per-patent queries)  
**Business Rules:** BR-057 (EPO OAuth2), BR-058 (retry logic)

```mermaid
sequenceDiagram
    participant API as Next.js API
    participant QUEUE as BullMQ Queue
    participant WORKER as EPO Worker
    participant REDIS as Redis
    participant EPO as EPO OPS API
    participant PG as PostgreSQL

    API->>QUEUE: Enqueue ingest:epo-family (patent_doc_num)
    
    WORKER->>REDIS: GET epo:oauth:token
    alt Token missing or expired
        WORKER->>EPO: POST /auth/accesstoken (client credentials, BR-057)
        EPO-->>WORKER: access_token (20-min TTL)
        WORKER->>REDIS: SET epo:oauth:token (TTL 19 min)
    end
    
    Note over WORKER: Rate limiter: max 10 concurrent<br/>EPO quota: ~2000 req/hr
    
    loop For each patent (concurrency=10)
        WORKER->>EPO: GET /family/application/{docNum}
        alt HTTP 200
            EPO-->>WORKER: XML (ops:world-patent-data)
            WORKER->>PG: UPSERT patent_families
            WORKER->>PG: UPSERT patent_family_members
        else HTTP 403 (quota exceeded)
            WORKER->>WORKER: Pause queue for 60s
        else HTTP 429
            WORKER->>WORKER: Backoff retry (1s, 2s, 4s...)
        end
    end
```

**Key improvements over legacy:**
1. **Redis-based token management** — OAuth2 tokens cached in Redis with proper TTL (legacy cached to filesystem, BR-057)
2. **Concurrency-limited queue** — BullMQ concurrency=10 respects EPO rate limits (legacy had no rate limiting)
3. **Batch strategy** — Can batch-enqueue multiple patents when new assignments arrive

### 2.4 Flow 4: CPC Classification Data (Monthly)

**Schedule:** 1st of each month at 04:00 UTC  
**Source:** USPTO API (ZIP → XML, full dataset) + EPO Linked Data (SPARQL)  
**Business Rules:** BR-056 (full replacement)

```mermaid
sequenceDiagram
    participant CRON as BullMQ Scheduler
    participant DL as Download Worker
    participant USPTO as USPTO API
    participant EPO_LD as EPO Linked Data
    participant PG as PostgreSQL

    CRON->>DL: ingest:cpc (monthly, 1st of month)
    DL->>USPTO: Download CPC grant classifications (full dataset)
    DL->>USPTO: Download CPC application classifications (full dataset)
    
    Note over DL: Full replacement strategy (BR-056)
    
    DL->>PG: BEGIN TRANSACTION
    DL->>PG: TRUNCATE patent_cpc_codes (within transaction)
    
    loop Stream XML records
        DL->>PG: COPY patent_cpc_codes (bulk insert, patent_type='grant')
        DL->>PG: COPY patent_cpc_codes (bulk insert, patent_type='application')
    end
    
    DL->>PG: COMMIT TRANSACTION
    
    Note over DL: CPC hierarchy update
    
    DL->>EPO_LD: SPARQL query for CPC hierarchy tree
    
    loop For each CPC node
        DL->>PG: UPSERT cpc_classifications (parent_id, level, title)
    end
    
    DL->>PG: UPDATE ingestion_jobs (status=success)
```

**Key improvements over legacy:**
1. **Atomic replacement** — `TRUNCATE` + `COPY` in a single transaction ensures no partial state
2. **`COPY` for bulk loading** — PostgreSQL `COPY` is 10-100x faster than individual `INSERT` statements
3. **Single pipeline** — Eliminates duplicate `monthly_download_patent_cpc.php` and `monthly_download_applications_cpc.php`

### 2.5 Flow 5: Maintenance Fee Events (Weekly)

**Schedule:** Every Monday at 03:00 UTC  
**Source:** USPTO API (ZIP → tab-delimited text)

```mermaid
sequenceDiagram
    participant CRON as BullMQ Scheduler
    participant DL as Download Worker
    participant USPTO as USPTO API
    participant PG as PostgreSQL

    CRON->>DL: ingest:maintenance-fees (weekly Mon)
    DL->>USPTO: Download maintenance fee events (ZIP)
    DL->>DL: Extract tab-delimited file
    
    loop Stream tab-delimited lines
        DL->>PG: INSERT maintenance_fee_events<br/>ON CONFLICT(grant_doc_num, event_code, event_date)<br/>DO NOTHING
    end
    
    DL->>PG: UPDATE ingestion_jobs (status=success, records_processed)
```

**Key improvements over legacy:**
1. **Streaming line reader** — Processes file line-by-line without loading into memory
2. **Composite unique constraint** — Prevents duplicates at database level
3. **Scheduled** — Automated via BullMQ repeatable jobs (legacy required manual intervention)

### 2.6 Flow 6: Enrichment Data (On-Demand)

**Schedule:** On-demand (triggered when org is created or entity is first viewed)  
**Sources:** Clearbit, RiteKit, PatentsView, etc.  
**Security:** All API keys in secrets manager (fixing S-05, S-06)

```mermaid
sequenceDiagram
    participant API as Next.js API
    participant CACHE as Redis Cache
    participant QUEUE as BullMQ Queue
    participant WORKER as Enrichment Worker
    participant EXT as External APIs
    participant PG as PostgreSQL

    API->>CACHE: GET enrich:{entity_name}
    alt Cache HIT (logos/domains rarely change)
        CACHE-->>API: Cached enrichment data
    else Cache MISS
        API->>QUEUE: Enqueue enrich:company (entity_name)
        API-->>API: Return partial response (graceful degradation)
    end
    
    WORKER->>WORKER: Load API keys from env/secrets manager
    Note over WORKER: NO hardcoded keys (fixes S-05, S-06)
    
    WORKER->>EXT: Clearbit (company → domain)
    alt API available
        EXT-->>WORKER: Domain data
    else API unavailable
        WORKER->>WORKER: Log warning, continue without (graceful degradation)
    end
    
    WORKER->>EXT: RiteKit/Logo API (domain → logo URL)
    alt API available
        EXT-->>WORKER: Logo URL
    else API unavailable
        WORKER->>WORKER: Use placeholder logo
    end
    
    WORKER->>PG: UPDATE organization/entity with enrichment data
    WORKER->>CACHE: SET enrich:{entity_name} (TTL 30 days)
```

**Key improvements over legacy:**
1. **Secrets manager** — All API keys loaded from environment variables, not hardcoded (fixes S-05, S-06)
2. **Aggressive caching** — Company logos and domains cached for 30 days (legacy had zero caching)
3. **Graceful degradation** — If Clearbit/RiteKit is unavailable, return partial data with placeholder (legacy would fail silently or error)
4. **Async enrichment** — User gets immediate response; enrichment runs in background

---

## 3. Authentication & Authorization Architecture

### 3.1 Auth Architecture Overview

```mermaid
graph TB
    subgraph "Client (Browser)"
        LOGIN["Login Form"]
        COOKIE["httpOnly Secure Cookie<br/>(access_token + refresh_token)"]
        SC["Server Components"]
        CC["Client Components"]
    end

    subgraph "Next.js Middleware"
        MW["middleware.ts<br/>- Validate JWT<br/>- Extract user context<br/>- Set RLS parameters"]
    end

    subgraph "Next.js API Routes"
        AUTH_EP["Auth Endpoints<br/>/api/auth/*"]
        PROTECTED["Protected Endpoints<br/>/api/*"]
        SHARE_EP["Share Endpoints<br/>/api/share/*"]
    end

    subgraph "Database"
        PG["PostgreSQL<br/>RLS Policies"]
        SESSIONS["Redis<br/>Refresh Token Store"]
    end

    LOGIN -->|"POST /api/auth/login"| AUTH_EP
    AUTH_EP -->|"Set-Cookie: httpOnly"| COOKIE
    COOKIE -->|"auto-attached"| MW
    MW -->|"SET app.current_org_id"| PG
    MW --> PROTECTED
    SC --> MW
    CC --> MW
    AUTH_EP --> SESSIONS

    SHARE_EP -->|"Scoped read-only token"| PG
```

### 3.2 Security Vulnerability Fixes

| Vulnerability | Fix | Implementation |
|--------------|-----|----------------|
| **S-01: Command injection** | Eliminate PHP bridge entirely | No `exec()` calls. All business logic in TypeScript. Zero PHP in new system. |
| **S-02: Token refresh bypass** | Full signature verification on refresh | Refresh tokens are opaque (stored server-side in Redis), not self-contained JWTs. Server validates against stored token. |
| **S-03: Share links grant admin access** | Scoped read-only tokens | Share tokens contain `scope: 'share:read'`, `resource_type`, and `resource_id`. Cannot perform write operations. |
| **S-11: Missing resource authorization** | RLS + middleware | Every request sets `app.current_org_id` via RLS. Middleware extracts org from JWT and sets PostgreSQL session variable. |
| **S-12: Hardcoded JWT secret** | Environment variable (required) | Application fails to start if `JWT_SECRET` env var is not set. No fallback values. KMS preferred for production. |
| **S-13: No rate limiting** | Per-tenant, per-user rate limits | Redis-backed sliding window rate limiter on auth endpoints (10 attempts/min) and API endpoints (1000 req/min per tenant). |
| **S-14: No password complexity** | Enforce minimum requirements | Minimum 12 characters, 1 uppercase, 1 lowercase, 1 digit. Checked at API level + client-side validation. |
| **S-15: No account lockout** | Progressive delays | After 5 failed attempts: 1-min lockout. After 10: 15-min lockout. After 20: account locked (admin unlock required). Tracked in Redis. |
| **S-16: Unauthenticated WebSocket** | All connections require valid token | SSE (replacing WebSocket) routes go through Next.js middleware → JWT validation required. No anonymous real-time connections. |
| **S-19: Dual token storage** | httpOnly cookies only | No `localStorage` for tokens. Access token in httpOnly, Secure, SameSite=Strict cookie. CSRF protection via double-submit pattern. |

### 3.3 RBAC Model

```mermaid
graph TD
    subgraph "Role Hierarchy"
        SA["Super Admin (type=9)<br/>System-wide access<br/>BR-049"]
        OA["Org Admin (type=0/1)<br/>Full org access<br/>BR-048"]
        OM["Org Member (type=NULL)<br/>Scoped org access"]
        SV["Share Viewer<br/>Read-only, asset-scoped<br/>Fixes BR-045"]
    end

    SA -->|"inherits"| OA
    OA -->|"inherits"| OM

    subgraph "Permission Matrix"
        P1["Manage organizations ✅ SA only"]
        P2["Manage users ✅ SA, OA"]
        P3["Trigger pipeline rebuild ✅ SA, OA"]
        P4["View dashboard ✅ SA, OA, OM"]
        P5["Create share links ✅ SA, OA, OM"]
        P6["View shared asset ✅ SV (scoped)"]
        P7["Modify data ❌ SV"]
    end
```

**Role resolution at database level:**

```sql
-- RLS policy for standard org isolation
CREATE POLICY org_isolation ON assets
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- RLS bypass for super admin
CREATE POLICY super_admin_bypass ON assets
    USING (current_setting('app.user_role', true) = '9');

-- Share viewer: scoped to specific resource
CREATE POLICY share_access ON assets
    USING (
        current_setting('app.access_scope', true) = 'share:read'
        AND (
            grant_doc_num = current_setting('app.share_resource_id', true)
            OR appno_doc_num = current_setting('app.share_resource_id', true)
        )
    );
```

### 3.4 Token Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant MW as Middleware
    participant API as Auth API
    participant REDIS as Redis
    participant PG as PostgreSQL

    Note over U,PG: === Login Flow ===
    U->>API: POST /api/auth/login {email, password}
    API->>PG: SELECT user WHERE email = ? (check password hash, bcrypt factor 12)
    API->>API: Check account lockout (Redis counter)
    
    alt Valid credentials
        API->>API: Generate access_token (JWT, 15 min, signed)
        API->>API: Generate refresh_token (opaque, 32 bytes)
        API->>REDIS: SETEX refresh:{token_hash} {user_id, org_id, role} TTL 7d
        API->>U: Set-Cookie: access_token (httpOnly, Secure, SameSite=Strict, Max-Age=900)
        API->>U: Set-Cookie: refresh_token (httpOnly, Secure, SameSite=Strict, Path=/api/auth/refresh, Max-Age=604800)
    else Invalid credentials
        API->>REDIS: INCR login_attempts:{email}
        API->>U: 401 Unauthorized
    end

    Note over U,PG: === Authenticated Request ===
    U->>MW: GET /api/assets (Cookie: access_token)
    MW->>MW: Verify JWT signature + expiry
    MW->>MW: Extract {user_id, org_id, role}
    MW->>PG: SET app.current_org_id = '{org_id}'
    MW->>PG: SET app.user_role = '{role}'
    MW->>API: Forward request (RLS now active)

    Note over U,PG: === Token Refresh ===
    U->>API: POST /api/auth/refresh (Cookie: refresh_token)
    API->>REDIS: GET refresh:{token_hash}
    alt Valid refresh token
        API->>REDIS: DEL refresh:{old_token_hash} (rotate)
        API->>API: Generate new access_token + refresh_token
        API->>REDIS: SETEX refresh:{new_token_hash} TTL 7d
        API->>U: Set-Cookie: new tokens
    else Invalid/expired
        API->>U: 401 (force re-login)
    end

    Note over U,PG: === Share Link Access ===
    U->>API: GET /api/share/verify/{code}
    API->>PG: SELECT share_link WHERE share_code = ? AND deleted_at IS NULL
    API->>API: Check expires_at, max_uses (BR-046)
    API->>PG: INSERT share_access_log (ip, user_agent) (BR-047)
    API->>PG: UPDATE share_links SET use_count = use_count + 1
    API->>API: Generate share_token (JWT, configurable TTL 1h-30d)
    Note over API: Claims: {scope: 'share:read', resource_type, resource_id, org_id}
    API->>U: Set-Cookie: share_token (httpOnly, limited scope)
```

**Token specifications:**

| Token | Type | Lifetime | Storage | Contents |
|-------|------|----------|---------|----------|
| Access Token | Signed JWT (HS256 or RS256) | 15 minutes | httpOnly cookie | `{sub, org_id, role, iat, exp}` |
| Refresh Token | Opaque (crypto.randomBytes(32)) | 7 days, rotated on use | httpOnly cookie (Path=/api/auth/refresh) + Redis server-side | Server-side: `{user_id, org_id, role, created_at}` |
| Share Token | Signed JWT | Configurable (1h–30d) | httpOnly cookie | `{scope: 'share:read', resource_type, resource_id, org_id, exp}` |

### 3.5 Session Management with Next.js

```mermaid
graph LR
    subgraph "Server Components"
        RSC["React Server Component"]
        RSC -->|"1. Read cookie"| MW["middleware.ts"]
        MW -->|"2. Validate JWT"| MW
        MW -->|"3. SET app.current_org_id"| DB["PostgreSQL (RLS active)"]
        DB -->|"4. Filtered data"| RSC
    end

    subgraph "API Routes"
        ROUTE["API Route Handler"]
        ROUTE -->|"Cookie auto-attached"| MW2["middleware.ts"]
        MW2 -->|"SET RLS context"| DB
    end

    subgraph "Client Components"
        CC["Client Component"]
        CC -->|"fetch('/api/...')"| ROUTE
        CC -->|"Cookie auto-attached<br/>by browser"| CC
        Note over CC: No manual token<br/>management needed
    end
```

**Middleware implementation pattern:**

```typescript
// middleware.ts (simplified)
import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@patentrack/shared/auth';

export async function middleware(request: NextRequest) {
  // Share routes: verify share token
  if (request.nextUrl.pathname.startsWith('/share/')) {
    const shareToken = request.cookies.get('share_token')?.value;
    if (!shareToken) return NextResponse.redirect('/share/expired');
    // Verify + set limited RLS context
  }

  // Auth routes: skip middleware
  if (request.nextUrl.pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // All other routes: verify access token
  const accessToken = request.cookies.get('access_token')?.value;
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyJWT(accessToken);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Pass user context to API routes via headers (internal only)
  const headers = new Headers(request.headers);
  headers.set('x-user-id', payload.sub);
  headers.set('x-org-id', payload.org_id);
  headers.set('x-user-role', String(payload.role ?? ''));

  return NextResponse.next({ request: { headers } });
}
```

---

## 4. Ingestion Pipeline Architecture

### 4.1 Technology Stack

| Component | Technology | Justification |
|-----------|-----------|---------------|
| **Job Queue** | BullMQ 5.x on Redis | Reliable, Redis-backed, supports DAGs, repeatable jobs, prioritization, rate limiting |
| **Workers** | TypeScript (Node.js 20+) | Shared types with API, access to `packages/business-rules` |
| **XML Parser** | sax-js (streaming SAX) | O(1) memory for 12GB files; event-based parsing |
| **Tab Parser** | Node.js `readline` + custom split | Streaming line-by-line processing |
| **Bulk Loader** | PostgreSQL `COPY` via `pg-copy-streams` | 10-100x faster than individual INSERTs for bulk data |
| **Scheduler** | BullMQ repeatable jobs | Cron-compatible, persistent across restarts, dashboard visibility |
| **Monitoring** | BullMQ Board (bull-board) | Web UI for queue inspection, job retries, metrics |

### 4.2 Job Scheduling

```mermaid
gantt
    title Weekly Ingestion Schedule
    dateFormat  YYYY-MM-DD
    axisFormat  %a

    section Daily
    USPTO Assignments          :active, daily, 2026-02-09, 1d

    section Weekly
    Grant Bibliographic (Tue)  :tue, 2026-02-10, 1d
    Maintenance Fees (Mon)     :mon, 2026-02-09, 1d
    App Bibliographic (Thu)    :thu, 2026-02-12, 1d

    section Monthly
    CPC Classifications (1st)  :cpc, 2026-03-01, 1d

    section On-Demand
    EPO Family Queries         :milestone, epo, 2026-02-09, 0d
    Enrichment (Logos/Domains) :milestone, enrich, 2026-02-09, 0d
```

| Schedule | Data Source | Job Name | Queue | Concurrency | BR |
|----------|-----------|----------|-------|-------------|-----|
| `0 2 * * *` (daily 02:00) | USPTO PASDL (assignments) | `ingest:assignments` | `ingestion` | 1 | BR-054 |
| `0 0 * * 2` (Tue 00:00) | USPTO bulk grants (~12GB) | `ingest:grants` | `ingestion` | 1 | BR-055 |
| `0 0 * * 4` (Thu 00:00) | USPTO bulk applications (~12GB) | `ingest:applications` | `ingestion` | 1 | BR-055 |
| `0 3 * * 1` (Mon 03:00) | USPTO maintenance fees | `ingest:maintenance-fees` | `ingestion` | 1 | — |
| `0 4 1 * *` (1st of month) | USPTO CPC classifications | `ingest:cpc` | `ingestion` | 1 | BR-056 |
| On-demand | EPO family data | `ingest:epo-family` | `epo` | 10 | BR-057 |
| On-demand | Enrichment (logos, domains) | `enrich:company` | `enrichment` | 5 | — |
| On new assignments | Per-org pipeline (8 steps) | `pipeline:org:{orgId}` | `pipeline` | 3 | BR-060 |

### 4.3 Pipeline DAG for Per-Org Recomputation (BR-060)

```mermaid
graph LR
    START((Start)) --> CLASSIFY["Step 1<br/>classify<br/>(BR-001–BR-012)"]
    CLASSIFY --> FLAG["Step 2<br/>flag<br/>(BR-021–BR-023)"]
    FLAG --> TREE["Step 3a<br/>tree<br/>(BR-024–BR-031)"]
    FLAG --> TIMELINE["Step 3b<br/>timeline"]
    TREE --> BROKEN["Step 4<br/>broken_title<br/>(BR-032–BR-036)"]
    TIMELINE --> BROKEN
    BROKEN --> DASHBOARD["Step 5a<br/>dashboard<br/>(BR-037)"]
    BROKEN --> SUMMARY["Step 5b<br/>summary<br/>(BR-038–BR-043)"]
    DASHBOARD --> GENJSON["Step 6<br/>generate_json"]
    SUMMARY --> GENJSON
    GENJSON --> DONE((Done))

    style TREE fill:#4CAF50,color:white
    style TIMELINE fill:#4CAF50,color:white
    style DASHBOARD fill:#2196F3,color:white
    style SUMMARY fill:#2196F3,color:white
```

**Parallelism gains:**
- **Sequential (legacy):** Steps 1→2→3→4→5→6→7→8 (all serial)
- **DAG (new):** Steps 1→2→[3a‖3b]→4→[5a‖5b]→6 (8 steps → 6 serial stages, 2 parallel pairs)
- **Estimated speedup:** ~25-30% reduction in pipeline time per org

**Implementation using BullMQ Flow (parent-child jobs):**

```typescript
// pipeline-org.ts (simplified)
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer({ connection: redis });

async function runOrgPipeline(orgId: string, jobType: 'full_rebuild' | 'incremental') {
  await flowProducer.add({
    name: 'generate_json',
    queueName: 'pipeline',
    data: { orgId, step: 6 },
    children: [
      {
        name: 'dashboard',
        queueName: 'pipeline',
        data: { orgId, step: '5a' },
        children: [{
          name: 'broken_title',
          queueName: 'pipeline',
          data: { orgId, step: 4 },
          children: [
            {
              name: 'tree',
              queueName: 'pipeline',
              data: { orgId, step: '3a' },
              children: [{
                name: 'flag',
                queueName: 'pipeline',
                data: { orgId, step: 2 },
                children: [{
                  name: 'classify',
                  queueName: 'pipeline',
                  data: { orgId, step: 1 },
                }],
              }],
            },
            {
              name: 'timeline',
              queueName: 'pipeline',
              data: { orgId, step: '3b' },
              // Also depends on flag (step 2) — BullMQ handles via parent
            },
          ],
        }],
      },
      {
        name: 'summary',
        queueName: 'pipeline',
        data: { orgId, step: '5b' },
        // Also depends on broken_title (step 4) — shares parent
      },
    ],
  });
}
```

### 4.4 Idempotency Strategy

All ingestion jobs are designed to be safely re-runnable (BR-059 upgrade from `INSERT IGNORE` to proper upserts):

| Data Type | Unique Key | Upsert Strategy |
|-----------|-----------|-----------------|
| Assignments | `rf_id` | `ON CONFLICT(rf_id) DO UPDATE SET convey_text=EXCLUDED.convey_text, record_dt=EXCLUDED.record_dt, updated_at=NOW()` |
| Document IDs | `(assignment_id, appno_doc_num, grant_doc_num)` | `ON CONFLICT DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()` |
| Entities | `LOWER(name)` | `ON CONFLICT(LOWER(name)) DO UPDATE SET instances=entities.instances+1` |
| Patents | `appno_doc_num` / `grant_doc_num` | `ON CONFLICT DO UPDATE SET title=EXCLUDED.title, grant_date=EXCLUDED.grant_date` |
| CPC Classifications | `cpc_code` | Full replacement (TRUNCATE + COPY in transaction, BR-056) |
| Maintenance Fees | `(grant_doc_num, event_code, event_date)` | `ON CONFLICT DO NOTHING` (immutable events) |
| Patent Families | `family_id` | `ON CONFLICT(family_id) DO UPDATE SET family_type=EXCLUDED.family_type` |

**Job-level idempotency:**
- Each `ingestion_job` record tracks `records_processed`, `records_inserted`, `records_updated`, `records_failed`
- If a job fails mid-way, re-running it will skip already-inserted records via upserts
- Job records are immutable once `status='success'` — never deleted (temporal audit trail)

### 4.5 Retry Strategy

```mermaid
graph TD
    JOB["Job Execution"] --> SUCCESS{"Success?"}
    SUCCESS -->|"Yes"| DONE["Mark Complete<br/>Update ingestion_job"]
    SUCCESS -->|"No"| CLASSIFY{"Error Type?"}
    
    CLASSIFY -->|"HTTP 429<br/>(Rate Limit)"| BACKOFF["Exponential Backoff<br/>1s → 2s → 4s → 8s → 16s<br/>(BR-058: max 5 retries)"]
    CLASSIFY -->|"Network Error<br/>(Timeout, DNS)"| RETRY["Fixed Delay Retry<br/>30s, max 3 attempts"]
    CLASSIFY -->|"Parse Error<br/>(Bad XML)"| LOG["Log to ingestion_errors<br/>Continue with next record"]
    CLASSIFY -->|"DB Error<br/>(Constraint)"| LOG
    CLASSIFY -->|"Auth Error<br/>(401/403)"| ALERT["Alert via Slack webhook<br/>Pause queue"]
    
    BACKOFF --> RETRY_CHECK{"Retries<br/>exhausted?"}
    RETRY --> RETRY_CHECK
    RETRY_CHECK -->|"No"| JOB
    RETRY_CHECK -->|"Yes"| FAIL["Mark Failed<br/>Alert admin"]
```

**BullMQ retry configuration:**

```typescript
// Queue configuration for ingestion jobs
const ingestionQueue = new Queue('ingestion', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000, // 1s base (BR-058)
    },
    removeOnComplete: { age: 604800 }, // Keep 7 days
    removeOnFail: { age: 2592000 },    // Keep 30 days
  },
});

// EPO queue with rate limiting
const epoQueue = new Queue('epo', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
  limiter: {
    max: 10,         // Max 10 jobs
    duration: 1000,  // Per second
  },
});
```

### 4.6 Monitoring & Observability

```mermaid
graph TB
    subgraph "Data Sources"
        JOBS["BullMQ Job Events"]
        PG_META["ingestion_jobs table<br/>processing_jobs table"]
        DS_META["data_sources table<br/>(last_run_at, next_run_at)"]
    end

    subgraph "Dashboards"
        BULL_UI["BullMQ Board<br/>(Admin UI)"]
        ADMIN["Admin Panel<br/>(Ingestion Status)"]
    end

    subgraph "Alerts"
        SLACK["Slack Webhook"]
        EMAIL["Email (critical only)"]
    end

    subgraph "Metrics"
        FRESHNESS["Data Freshness<br/>per source"]
        THROUGHPUT["Throughput<br/>jobs/min, records/sec"]
        QUEUE_DEPTH["Queue Depth<br/>pending jobs"]
        ERROR_RATE["Error Rate<br/>failed/total"]
    end

    JOBS --> BULL_UI
    JOBS --> METRICS
    PG_META --> ADMIN
    DS_META --> FRESHNESS

    ERROR_RATE -->|"> 5%"| SLACK
    FRESHNESS -->|"stale > 2x schedule"| SLACK
    QUEUE_DEPTH -->|"> 1000"| SLACK
    ERROR_RATE -->|"> 20%"| EMAIL
```

**Data freshness tracking:**

| Source | Expected Freshness | Alert Threshold |
|--------|-------------------|-----------------|
| USPTO Assignments | Updated daily | Stale if > 48 hours |
| Grant Bibliographic | Updated weekly (Tue) | Stale if > 9 days |
| App Bibliographic | Updated weekly (Thu) | Stale if > 9 days |
| Maintenance Fees | Updated weekly (Mon) | Stale if > 9 days |
| CPC Classifications | Updated monthly (1st) | Stale if > 35 days |
| EPO Family Data | On-demand | N/A (cached per-patent) |
| Enrichment Data | On-demand | N/A (cached 30 days) |

**Admin dashboard metrics:**

```typescript
// Exposed via GET /api/admin/ingestion/status
interface IngestionStatus {
  sources: Array<{
    name: string;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
    lastStatus: 'success' | 'failed' | 'partial';
    recordsProcessed: number;
    staleness: 'fresh' | 'warning' | 'stale';
  }>
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    avgDuration: number; // ms
  }>
  pipelines: Array<{
    orgId: string;
    orgName: string;
    status: string;
    currentStep: string;
    startedAt: Date;
    duration: number; // ms
  }>
}
```

### 4.7 Worker Process Architecture

```mermaid
graph TB
    subgraph "Worker Process (apps/worker)"
        ENTRY["index.ts<br/>(Entry Point)"]
        
        subgraph "Consumers"
            C1["AssignmentConsumer"]
            C2["GrantConsumer"]
            C3["ApplicationConsumer"]
            C4["CPCConsumer"]
            C5["MaintenanceFeeConsumer"]
            C6["EPOFamilyConsumer"]
            C7["EnrichmentConsumer"]
            C8["PipelineOrgConsumer"]
        end
        
        subgraph "Shared Infrastructure"
            DB["Drizzle DB Client<br/>(connection pool)"]
            REDIS_CLIENT["ioredis Client"]
            LOGGER["Structured Logger<br/>(pino)"]
        end
        
        SCHED["Scheduler<br/>(Repeatable Jobs)"]
    end
    
    ENTRY --> C1 & C2 & C3 & C4 & C5 & C6 & C7 & C8
    ENTRY --> SCHED
    C1 & C2 & C3 & C4 & C5 & C6 & C7 & C8 --> DB & REDIS_CLIENT & LOGGER
```

**Graceful shutdown:**

```typescript
// Worker graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  // Stop accepting new jobs
  await Promise.all(consumers.map(c => c.close()));
  
  // Wait for active jobs to complete (30s timeout)
  await Promise.race([
    Promise.all(consumers.map(c => c.waitUntilReady())),
    new Promise(resolve => setTimeout(resolve, 30000)),
  ]);
  
  // Close connections
  await db.end();
  await redis.quit();
  
  logger.info('Worker shut down cleanly');
  process.exit(0);
});
```

---

## 7. API Design Principles

> **Context:** Section 1.3 established that PatenTrack3 uses Next.js API routes as a BFF (Backend for Frontend) with ~80 consolidated endpoints. This section defines the conventions and principles that govern all API endpoints.

### 7.1 Protocol Decision: REST with OpenAPI

**Decision:** REST with OpenAPI 3.1, auto-generated from Zod schemas.

**Rationale:**

| Criterion | tRPC | REST + OpenAPI |
|-----------|------|----------------|
| Type safety (client ↔ server) | ✅ Excellent — end-to-end inference | ✅ Good — generated from Zod schemas via `zod-openapi` |
| Developer experience with Next.js | ✅ Great DX with `@trpc/next` | ✅ Native — Next.js API routes are REST by default |
| Share Viewer (public-facing) | ⚠️ Requires separate REST adapter | ✅ Standard HTTP — any client can consume |
| Future third-party integrations | ⚠️ Non-standard, requires gateway | ✅ Industry standard, self-documenting |
| API documentation | ⚠️ Manual or custom tooling | ✅ Auto-generated Swagger/Redoc |
| Caching (CDN, browser, proxy) | ⚠️ POST-only, custom cache headers | ✅ Native HTTP caching semantics (GET, ETag) |
| Tooling ecosystem (Postman, curl, etc.) | ⚠️ Limited | ✅ Universal |
| Learning curve for new developers | ⚠️ tRPC-specific patterns | ✅ REST is universally understood |

**Key factors in the decision:**

1. **Share Viewer is public-facing:** The share viewer (replacing PT-Share) serves public URLs that must work without authentication and be indexable/cacheable. REST's standard HTTP semantics (GET requests, cache headers, CDN support) are ideal for this. tRPC's POST-based RPC calls would require a separate REST adapter for public endpoints.

2. **Future extensibility:** While PatenTrack3 is currently internal, the architecture should not preclude future third-party API access. REST + OpenAPI provides a self-documenting, standards-based API that any client can consume.

3. **Type safety is preserved:** By generating OpenAPI schemas from Zod (via `zod-openapi` or `@asteasolutions/zod-to-openapi`), we maintain type safety between the API and frontend. The shared Zod schemas in `packages/shared` serve as the single source of truth for both runtime validation and type generation.

4. **Next.js alignment:** Next.js App Router API routes are inherently REST-based. Using REST avoids adding tRPC as an additional abstraction layer.

### 7.2 URL Structure & Resource Organization

**Base path:** `/api/v1/{resource}/{id?}/{sub-resource?}`

**Resource routers organized by domain:**

```
apps/web/app/api/v1/
├── assets/                    # Asset CRUD, search, bulk operations
│   ├── route.ts               # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts           # GET, PATCH, DELETE
│       ├── assignments/       # Asset's assignment history
│       └── events/            # Asset's events
├── dashboards/                # Dashboard data aggregation
│   ├── route.ts               # GET (summary data)
│   ├── charts/                # Chart-specific endpoints
│   └── export/                # CSV/PDF export
├── events/                    # Event tabs, maintenance fees
│   ├── route.ts               # GET (list with filters)
│   └── [id]/route.ts          # GET (detail)
├── families/                  # EPO patent families
│   ├── route.ts               # GET (list)
│   └── [id]/route.ts          # GET (detail with members)
├── companies/                 # Company management (was "organizations" in legacy)
│   ├── route.ts               # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts           # GET, PATCH, DELETE
│       ├── collections/       # Company's collections
│       └── pipeline/          # Trigger/status of org pipeline
├── customers/                 # Tenant customer management (admin)
│   ├── route.ts               # GET (list), POST (create)
│   └── [id]/route.ts          # GET, PATCH, DELETE
├── admin/                     # Super admin operations
│   ├── tenants/               # Tenant CRUD
│   ├── users/                 # User management across tenants
│   ├── ingestion/             # Ingestion control, status, history
│   └── system/                # Health, metrics, config
├── share/                     # Share link management & public access
│   ├── route.ts               # POST (create share link)
│   ├── [code]/route.ts        # GET (public — resolve share link)
│   └── [code]/data/route.ts   # GET (public — share data payload)
├── ingestion/                 # Ingestion monitoring (admin)
│   ├── status/                # Current ingestion status
│   ├── history/               # Past ingestion runs
│   └── trigger/               # Manual ingestion trigger
└── auth/                      # Authentication (see Section 3)
    ├── login/route.ts         # POST
    ├── register/route.ts      # POST
    ├── logout/route.ts        # POST
    ├── refresh/route.ts       # POST
    └── me/route.ts            # GET (current user)
```

**URL conventions:**

| Pattern | Example | Description |
|---------|---------|-------------|
| Collection | `GET /api/v1/assets` | List resources (paginated) |
| Single resource | `GET /api/v1/assets/:id` | Get resource by ID |
| Create | `POST /api/v1/assets` | Create new resource |
| Update | `PATCH /api/v1/assets/:id` | Partial update |
| Delete | `DELETE /api/v1/assets/:id` | Soft delete (set `deleted_at`) |
| Sub-resource | `GET /api/v1/assets/:id/assignments` | List related resources |
| Action | `POST /api/v1/companies/:id/pipeline` | Trigger org pipeline |
| Search | `GET /api/v1/assets?q=search&type=patent` | Query parameters for filtering |

### 7.3 Error Format

All API errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource.",
    "details": {
      "required_role": "org_admin",
      "current_role": "org_member"
    }
  }
}
```

**Standard error codes:**

| HTTP Status | Error Code | Usage |
|------------|------------|-------|
| 400 | `BAD_REQUEST` | Malformed request body or parameters |
| 400 | `VALIDATION_ERROR` | Zod validation failure (details include field errors) |
| 401 | `UNAUTHORIZED` | Missing or expired authentication |
| 403 | `FORBIDDEN` | Authenticated but insufficient permissions |
| 404 | `NOT_FOUND` | Resource does not exist or not visible to tenant |
| 409 | `CONFLICT` | Duplicate resource or optimistic lock failure |
| 422 | `UNPROCESSABLE_ENTITY` | Semantically invalid request |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error (details omitted in production) |

**Zod validation error example:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {
      "fieldErrors": {
        "email": ["Invalid email address"],
        "name": ["Name must be at least 2 characters"]
      }
    }
  }
}
```

**Error handler implementation:**

```typescript
// packages/shared/src/errors.ts
import { z } from 'zod';

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Predefined error factories
export const Errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError('BAD_REQUEST', message, 400, details),
  unauthorized: (message = 'Authentication required') =>
    new AppError('UNAUTHORIZED', message, 401),
  forbidden: (message = 'Insufficient permissions', details?: Record<string, unknown>) =>
    new AppError('FORBIDDEN', message, 403, details),
  notFound: (resource = 'Resource') =>
    new AppError('NOT_FOUND', `${resource} not found`, 404),
  conflict: (message: string) =>
    new AppError('CONFLICT', message, 409),
  rateLimited: (retryAfter: number) =>
    new AppError('RATE_LIMITED', 'Rate limit exceeded', 429, { retryAfter }),
  internal: (message = 'Internal server error') =>
    new AppError('INTERNAL_ERROR', message, 500),
} as const;
```

### 7.4 Pagination

**Strategy:** Cursor-based pagination for all list endpoints. This is essential for the assignments table (50M+ rows) where offset-based pagination degrades at high page numbers.

**Response format:**

```json
{
  "data": [
    { "id": "asset_123", "title": "US Patent 10,000,001", "..." : "..." },
    { "id": "asset_124", "title": "US Patent 10,000,002", "..." : "..." }
  ],
  "cursor": {
    "next": "eyJpZCI6ImFzc2V0XzEyNCJ9",
    "hasMore": true
  },
  "total": 1847293
}
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Items per page (max 100) |
| `cursor` | string | — | Opaque cursor from previous response |
| `sort` | string | `created_at` | Sort field |
| `order` | `asc` \| `desc` | `desc` | Sort direction |

**Cursor implementation:**

```typescript
// packages/shared/src/pagination.ts
import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  sort: z.string().default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const PaginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    cursor: z.object({
      next: z.string().nullable(),
      hasMore: z.boolean(),
    }),
    total: z.number(),
  });

// Cursor encoding/decoding (base64 JSON)
export function encodeCursor(values: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
}
```

**`total` field note:** The `total` count uses `COUNT(*) OVER()` for filtered queries or a cached approximate count (via `pg_class.reltuples`) for unfiltered large tables. Exact counts on 50M+ row tables are expensive; the API will return approximate totals and indicate this with a `totalIsApproximate: true` field when applicable.

### 7.5 Rate Limiting

**Strategy:** Token bucket algorithm implemented via Redis (sliding window), applied per authenticated user and role.

**Limits by role:**

| Role | Requests/Minute | Burst Allowance | Use Case |
|------|----------------|-----------------|----------|
| Super Admin | 1000 | 1200 | System administration, bulk operations |
| Org Admin | 300 | 400 | Organization management, reports |
| Org Member | 100 | 150 | Standard dashboard usage |
| Share Viewer | 30 | 40 | Public share link access |

**Response headers (all API responses):**

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1706745600
```

**Rate limit exceeded response (HTTP 429):**

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again in 23 seconds.",
    "details": {
      "retryAfter": 23,
      "limit": 100,
      "resetAt": "2026-02-09T12:00:00Z"
    }
  }
}
```

**Implementation sketch:**

```typescript
// apps/web/lib/rate-limit.ts
import { Redis } from 'ioredis';

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

const ROLE_LIMITS: Record<string, RateLimitConfig> = {
  super_admin: { limit: 1000, windowMs: 60_000 },
  org_admin:   { limit: 300,  windowMs: 60_000 },
  org_member:  { limit: 100,  windowMs: 60_000 },
  share_viewer:{ limit: 30,   windowMs: 60_000 },
};

export async function checkRateLimit(
  redis: Redis,
  userId: string,
  role: string,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const config = ROLE_LIMITS[role] ?? ROLE_LIMITS.org_member;
  const key = `rate_limit:${userId}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Sliding window using sorted set
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now.toString(), `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.pexpire(key, config.windowMs);
  const results = await multi.exec();

  const count = (results?.[2]?.[1] as number) ?? 0;
  const remaining = Math.max(0, config.limit - count);
  const resetAt = Math.ceil((now + config.windowMs) / 1000);

  return { allowed: count <= config.limit, remaining, resetAt };
}
```

### 7.6 Input Validation

**Strategy:** Zod schemas shared between frontend and API via `packages/shared`. Every API endpoint validates request body, query parameters, and path parameters against Zod schemas before processing.

**Schema sharing pattern:**

```typescript
// packages/shared/src/schemas/asset.ts
import { z } from 'zod';

// Shared validation schema — used by both API and frontend forms
export const CreateAssetSchema = z.object({
  title: z.string().min(1).max(500),
  patentNumber: z.string().regex(/^\d{7,8}$/, 'Invalid patent number'),
  type: z.enum(['patent', 'application', 'pct']),
  assigneeId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateAssetSchema = CreateAssetSchema.partial();

export const AssetQuerySchema = z.object({
  q: z.string().optional(),
  type: z.enum(['patent', 'application', 'pct']).optional(),
  assigneeId: z.string().uuid().optional(),
  ...PaginationQuerySchema.shape,
});

export type CreateAssetInput = z.infer<typeof CreateAssetSchema>;
export type UpdateAssetInput = z.infer<typeof UpdateAssetSchema>;
```

**API route validation wrapper:**

```typescript
// apps/web/lib/api-handler.ts
import { NextRequest, NextResponse } from 'next/server';
import { z, ZodSchema } from 'zod';
import { AppError } from '@patentrack/shared/errors';

interface RouteConfig<TBody = unknown, TQuery = unknown> {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  handler: (req: NextRequest, ctx: {
    body: TBody;
    query: TQuery;
    user: AuthUser;
    requestId: string;
  }) => Promise<NextResponse>;
}

export function apiRoute<TBody, TQuery>(config: RouteConfig<TBody, TQuery>) {
  return async (req: NextRequest) => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

    try {
      // Validate body
      let body: TBody = undefined as TBody;
      if (config.body) {
        const raw = await req.json().catch(() => ({}));
        const result = config.body.safeParse(raw);
        if (!result.success) {
          return NextResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed.',
                details: { fieldErrors: result.error.flatten().fieldErrors },
              },
            },
            { status: 400, headers: { 'X-Request-ID': requestId } },
          );
        }
        body = result.data;
      }

      // Validate query parameters
      let query: TQuery = undefined as TQuery;
      if (config.query) {
        const params = Object.fromEntries(req.nextUrl.searchParams);
        const result = config.query.safeParse(params);
        if (!result.success) {
          return NextResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Query parameter validation failed.',
                details: { fieldErrors: result.error.flatten().fieldErrors },
              },
            },
            { status: 400, headers: { 'X-Request-ID': requestId } },
          );
        }
        query = result.data;
      }

      const user = await getAuthUser(req); // From Section 3
      const response = await config.handler(req, { body, query, user, requestId });
      response.headers.set('X-Request-ID', requestId);
      return response;
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json(error.toJSON(), {
          status: error.statusCode,
          headers: { 'X-Request-ID': requestId },
        });
      }
      console.error('Unhandled API error:', error);
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
        { status: 500, headers: { 'X-Request-ID': requestId } },
      );
    }
  };
}
```

### 7.7 Response Caching

**Strategy:** HTTP-native caching using `ETag` and `Cache-Control` headers. Tenant-specific data is always `private` to prevent CDN leakage across tenants.

| Data Type | Cache Strategy | Headers |
|-----------|---------------|---------|
| Public share data | CDN-cacheable | `Cache-Control: public, max-age=300` + `ETag` |
| Tenant dashboard data | Private, short-lived | `Cache-Control: private, max-age=60` + `ETag` |
| Static reference data (CPC codes) | Long-lived | `Cache-Control: public, max-age=86400` + `ETag` |
| User-specific data | No store | `Cache-Control: private, no-store` |
| Mutation responses | No cache | `Cache-Control: no-cache` |

**ETag implementation:**

```typescript
// apps/web/lib/etag.ts
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export function withETag(
  req: NextRequest,
  data: unknown,
  cacheControl: string,
): NextResponse {
  const body = JSON.stringify(data);
  const etag = `"${createHash('md5').update(body).digest('hex')}"`;

  // Check If-None-Match
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': cacheControl },
    });
  }

  return NextResponse.json(data, {
    headers: { ETag: etag, 'Cache-Control': cacheControl },
  });
}
```

### 7.8 Request IDs & Tracing

Every API request is assigned a UUID via the `X-Request-ID` header for end-to-end tracing:

1. **Client** may send `X-Request-ID` with the request.
2. **API middleware** uses the provided ID or generates a new UUID.
3. **ID is propagated** to all downstream calls (database queries, Redis operations, job queue).
4. **ID is returned** in the response `X-Request-ID` header.
5. **Structured logs** include the request ID for correlation.

```typescript
// apps/web/middleware.ts (partial — request ID handling)
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

  // Clone request with request ID header
  const headers = new Headers(req.headers);
  headers.set('x-request-id', requestId);

  const response = NextResponse.next({
    request: { headers },
  });
  response.headers.set('x-request-id', requestId);

  return response;
}
```

### 7.9 Body Size Limits

| Endpoint Type | Max Body Size | Rationale |
|--------------|--------------|-----------|
| Standard API requests | 1 MB | Sufficient for all JSON payloads (down from legacy 100MB — S-27) |
| File uploads (`/api/v1/admin/upload`) | 50 MB | Document attachments, bulk imports |

**Implementation via Next.js config:**

```typescript
// apps/web/app/api/v1/admin/upload/route.ts
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

// Default (next.config.ts)
// Next.js 15 default body limit is 1MB — no override needed for standard routes
```

### 7.10 CORS Policy

**Strategy:** Explicit origin allowlist only — no wildcard `*` (fixing security vulnerability S-20 from Stage A analysis).

```typescript
// apps/web/middleware.ts (partial — CORS handling)
const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_APP_URL,        // e.g., https://app.patentrack.com
  process.env.NEXT_PUBLIC_ADMIN_URL,      // e.g., https://admin.patentrack.com
  ...(process.env.CORS_EXTRA_ORIGINS?.split(',') ?? []),
]);

function handleCORS(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get('origin');

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    res.headers.set('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
    res.headers.set('Access-Control-Max-Age', '86400');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return res;
}
```

### 7.11 OpenAPI Specification

**Auto-generation from Zod schemas** using `@asteasolutions/zod-to-openapi`:

```typescript
// apps/web/lib/openapi.ts
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { CreateAssetSchema, AssetQuerySchema } from '@patentrack/shared/schemas/asset';

const registry = new OpenAPIRegistry();

// Register schemas
registry.register('CreateAssetInput', CreateAssetSchema);

// Register paths
registry.registerPath({
  method: 'get',
  path: '/api/v1/assets',
  summary: 'List assets',
  request: { query: AssetQuerySchema },
  responses: {
    200: {
      description: 'Paginated list of assets',
      content: { 'application/json': { schema: PaginatedResponseSchema(AssetSchema) } },
    },
  },
});

// Generate spec
const generator = new OpenApiGeneratorV31(registry.definitions);
export const openApiSpec = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'PatenTrack3 API',
    version: '1.0.0',
    description: 'Patent tracking and portfolio management API',
  },
  servers: [{ url: '/api/v1' }],
});
```

**Served at:** `GET /api/v1/docs` (JSON spec) and `GET /api/v1/docs/ui` (Swagger UI / Redoc).

---

## 8. Deployment & Infrastructure

### 8.1 Recommended Stack (Startup Budget)

The following stack is optimized for a startup-stage project with <100 tenants, prioritizing developer velocity, operational simplicity, and cost efficiency.

| Component | Service | Why |
|-----------|---------|-----|
| Frontend (Next.js) | Vercel | Zero-config Next.js hosting, edge functions, global CDN, PR previews |
| API/BFF | Vercel (same Next.js app) | Section 1.3 chose Next.js API routes as BFF — single deployment |
| Workers | Railway (background workers) | Long-running ingestion (12GB files), cron scheduling, persistent BullMQ consumers |
| PostgreSQL | Neon | Serverless Postgres, branching for staging, connection pooling, scale-to-zero |
| Redis | Upstash | Serverless Redis, BullMQ compatible, per-request pricing, global replication |
| File storage | AWS S3 (private buckets + signed URLs) | Fixing S-09 (public S3 bucket vulnerability), pre-signed URLs for secure access |
| Secrets management | Environment variables + Infisical | Fixing S-05, S-06, S-10, S-12 (hardcoded credentials), centralized secret rotation |

### 8.2 AWS-Native Alternative (Scale-Up Path)

For when the project scales beyond startup stage or requires more control:

| Component | Startup Stack | AWS-Native Alternative |
|-----------|--------------|----------------------|
| Frontend | Vercel | AWS CloudFront + S3 (static) + ECS Fargate (SSR) |
| API/BFF | Vercel | ECS Fargate (Next.js container) + ALB |
| Workers | Railway | ECS Fargate (worker tasks) + SQS/EventBridge |
| PostgreSQL | Neon | RDS PostgreSQL (Multi-AZ) |
| Redis | Upstash | ElastiCache for Redis (cluster mode) |
| File storage | AWS S3 | AWS S3 (same) |
| Secrets | Infisical | AWS Secrets Manager + Parameter Store |
| CDN | Vercel Edge | CloudFront |
| Monitoring | Sentry + Better Uptime | CloudWatch + X-Ray |

**Migration triggers (move to AWS when):**
- Tenant count exceeds 500+ organizations
- Vercel bandwidth/function costs exceed $500/month
- Compliance requirements mandate VPC isolation
- Need for VPC peering with customer networks

### 8.3 CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, production]
  pull_request:
    branches: [main]

env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}

jobs:
  lint-typecheck:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: '**/coverage/'

  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: patentrack_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run db:migrate
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/patentrack_test
      - run: pnpm turbo run test:integration
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/patentrack_test
          REDIS_URL: redis://localhost:6379

  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level=high
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'HIGH,CRITICAL'

  build:
    name: Build
    needs: [lint-typecheck, unit-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run build
      - uses: actions/upload-artifact@v4
        with:
          name: build
          path: apps/web/.next/

  deploy-staging:
    name: Deploy Staging
    needs: [build, integration-tests, security-scan]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Run database migrations
        run: pnpm turbo run db:migrate
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
      - name: Deploy to Vercel (Staging)
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
      - name: Deploy Worker to Railway (Staging)
        run: railway up --service worker --environment staging
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

  deploy-production:
    name: Deploy Production
    needs: [build, integration-tests, security-scan]
    if: github.ref == 'refs/heads/production' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.patentrack.com
    steps:
      - uses: actions/checkout@v4
      - name: Run database migrations
        run: pnpm turbo run db:migrate
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
      - name: Deploy to Vercel (Production)
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
      - name: Deploy Worker to Railway (Production)
        run: railway up --service worker --environment production
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### 8.4 Branch Strategy

```mermaid
gitGraph
    commit id: "initial"
    branch feature/auth
    checkout feature/auth
    commit id: "add auth"
    commit id: "auth tests"
    checkout main
    merge feature/auth id: "merge → staging auto-deploy"
    branch feature/ingestion
    checkout feature/ingestion
    commit id: "ingestion workers"
    checkout main
    merge feature/ingestion id: "merge → staging auto-deploy "
    branch production
    checkout production
    merge main id: "approved → production deploy"
```

| Branch | Trigger | Deploys To | Approval |
|--------|---------|-----------|----------|
| `feature/*` | Push | Vercel PR Preview | — |
| `main` | Push (merge) | Staging (auto) | PR review required |
| `production` | Push (merge from `main`) | Production | Manual approval + PR review |

**Rules:**
- All changes go through pull requests targeting `main`.
- `main` is protected: requires 1+ review, passing CI, no force push.
- `production` is protected: requires 2+ reviews, passing CI, manual approval via GitHub Environments.
- Feature branches get automatic Vercel PR previews for visual review.
- Hotfixes: branch from `production`, merge to both `production` and `main`.

### 8.5 Environment Configuration

| Environment | Database | Redis | Workers | Purpose |
|-------------|----------|-------|---------|---------|
| Local | Docker Compose (PostgreSQL 16) | Docker Compose (Redis 7) | Local Node.js process | Development & debugging |
| Staging | Neon (separate branch) | Upstash (separate instance) | Railway (staging service) | Integration testing, QA |
| Production | Neon (production branch) | Upstash (production instance) | Railway (production service) | Live system |

**Local development setup:**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    ports: ['5432:5432']
    environment:
      POSTGRES_DB: patentrack_dev
      POSTGRES_USER: patentrack
      POSTGRES_PASSWORD: patentrack_dev
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    volumes:
      - redisdata:/data

  mailhog:
    image: mailhog/mailhog
    ports: ['1025:1025', '8025:8025']

volumes:
  pgdata:
  redisdata:
```

**Environment variables (per environment):**

```bash
# Shared across environments (structure — values differ)
DATABASE_URL=               # PostgreSQL connection string
REDIS_URL=                  # Redis connection string
JWT_SECRET=                 # JWT signing secret (min 256-bit)
JWT_REFRESH_SECRET=         # Refresh token signing secret
NEXT_PUBLIC_APP_URL=        # Public app URL
S3_BUCKET=                  # S3 bucket name
S3_REGION=                  # S3 region
AWS_ACCESS_KEY_ID=          # S3 credentials
AWS_SECRET_ACCESS_KEY=      # S3 credentials
SENTRY_DSN=                 # Sentry error tracking
SLACK_WEBHOOK_URL=          # Alerting
```

### 8.6 Monitoring & Observability

| Category | Tool | Purpose |
|----------|------|---------|
| Error Tracking (APM) | Sentry | Exception capture, performance tracing, release tracking (already partially in use) |
| Structured Logging | Pino (JSON) → service log aggregation | Request logs, error context, audit trail |
| Job Monitoring | BullMQ Board + Slack alerts | Ingestion job status, failure alerts, queue depth |
| Database Monitoring | Neon built-in dashboard | Query performance, connection count, storage usage |
| Redis Monitoring | Upstash built-in dashboard | Memory usage, command rate, key count |
| Uptime Monitoring | Better Uptime (free tier) | HTTP endpoint checks, SSL expiry, status page |
| Alerting | Slack webhooks | Error spikes, failed jobs, DB connection issues, deployment events |

**Structured logging format:**

```typescript
// packages/shared/src/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: process.env.SERVICE_NAME ?? 'patentrack',
    environment: process.env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Usage in API routes:
// logger.info({ requestId, method, path, userId, duration }, 'Request completed');
// logger.error({ requestId, error: err.message, stack: err.stack }, 'Request failed');
```

**Alert rules:**

| Alert | Condition | Channel | Severity |
|-------|-----------|---------|----------|
| Error spike | >10 errors in 5 minutes | Slack `#alerts` | 🔴 Critical |
| Ingestion failure | Any ingestion job fails 3 retries | Slack `#ingestion` | 🔴 Critical |
| Database connection pool exhaustion | Active connections >80% of max | Slack `#alerts` | 🟡 Warning |
| API latency | p95 >2s for 5 minutes | Slack `#alerts` | 🟡 Warning |
| Disk/storage usage | >80% capacity | Slack `#alerts` | 🟡 Warning |
| SSL certificate expiry | <14 days until expiry | Slack `#alerts` | 🟡 Warning |
| Deployment success/failure | Every deploy | Slack `#deployments` | ℹ️ Info |

### 8.7 Deployment Topology Diagram

```mermaid
graph TB
    subgraph "Developer Workstation"
        DEV["Local Dev<br/>(pnpm dev)"]
        DOCKER["Docker Compose<br/>(PG + Redis + MailHog)"]
        DEV --> DOCKER
    end

    subgraph "GitHub"
        REPO["GitHub Repository<br/>(monorepo)"]
        ACTIONS["GitHub Actions<br/>(CI/CD Pipeline)"]
        REPO --> ACTIONS
    end

    subgraph "Vercel (Frontend + API)"
        VERCEL_EDGE["Vercel Edge Network<br/>(Global CDN)"]
        VERCEL_FN["Vercel Serverless Functions<br/>(Next.js API Routes)"]
        VERCEL_SSR["Vercel SSR<br/>(Server Components)"]
        VERCEL_PREVIEW["PR Preview Deployments"]
        
        VERCEL_EDGE --> VERCEL_FN
        VERCEL_EDGE --> VERCEL_SSR
    end

    subgraph "Railway (Workers)"
        WORKER_SVC["Worker Service<br/>(BullMQ Consumers)"]
        SCHEDULER_SVC["Scheduler Service<br/>(Cron Jobs)"]
        BULL_BOARD_SVC["BullMQ Board<br/>(Job Dashboard)"]
    end

    subgraph "Neon (PostgreSQL)"
        NEON_PROD["Production Branch<br/>(PostgreSQL 16)"]
        NEON_STAGING["Staging Branch<br/>(PostgreSQL 16)"]
        NEON_POOL["Connection Pooler<br/>(PgBouncer)"]
        
        NEON_PROD --> NEON_POOL
        NEON_STAGING --> NEON_POOL
    end

    subgraph "Upstash (Redis)"
        UPSTASH_PROD["Production Redis"]
        UPSTASH_STAGING["Staging Redis"]
    end

    subgraph "AWS"
        S3["S3 Bucket<br/>(Private, Signed URLs)"]
    end

    subgraph "Observability"
        SENTRY["Sentry<br/>(Error Tracking)"]
        BETTER_UPTIME["Better Uptime<br/>(Status Page)"]
        SLACK["Slack Webhooks<br/>(Alerts)"]
    end

    %% Connections
    ACTIONS -->|"deploy staging"| VERCEL_FN
    ACTIONS -->|"deploy production"| VERCEL_FN
    ACTIONS -->|"deploy workers"| WORKER_SVC
    ACTIONS -->|"run migrations"| NEON_POOL

    VERCEL_FN -->|"SQL queries"| NEON_POOL
    VERCEL_FN -->|"cache/sessions"| UPSTASH_PROD
    VERCEL_FN -->|"enqueue jobs"| UPSTASH_PROD
    VERCEL_SSR -->|"SQL queries"| NEON_POOL
    VERCEL_FN -->|"signed URLs"| S3

    WORKER_SVC -->|"consume jobs"| UPSTASH_PROD
    WORKER_SVC -->|"SQL writes"| NEON_POOL
    SCHEDULER_SVC -->|"schedule jobs"| UPSTASH_PROD

    VERCEL_FN -->|"errors"| SENTRY
    WORKER_SVC -->|"errors"| SENTRY
    WORKER_SVC -->|"alerts"| SLACK
    BETTER_UPTIME -->|"health checks"| VERCEL_EDGE

    DEV -->|"push"| REPO
    REPO -->|"PR preview"| VERCEL_PREVIEW
```

### 8.8 Infrastructure Cost Estimate (Startup Stage)

| Service | Tier | Estimated Monthly Cost |
|---------|------|----------------------|
| Vercel | Pro | $20/seat |
| Railway | Starter | $5 + usage (~$20-40) |
| Neon | Launch | $19 (includes 10GB storage) |
| Upstash | Pay-as-you-go | ~$10-20 |
| AWS S3 | Standard | ~$5-10 |
| Sentry | Team | $26/month |
| Better Uptime | Free | $0 |
| Infisical | Free (self-hosted) or $5/seat | ~$0-25 |
| **Total** | | **~$105-180/month** |

**Cost notes:**
- This estimate assumes <100 tenants, <10 team members, moderate API traffic.
- The serverless/pay-as-you-go model means costs scale with actual usage, not provisioned capacity.
- Neon's branching feature eliminates the need for a separate staging database instance (included in base tier).
- Vercel's free tier may suffice initially; Pro is recommended for production (team features, analytics, more bandwidth).

---

## Cross-References

- **Domain Model:** See `docs/design/01-domain-model.md` for complete schema design, RLS policies, migration path, and business rule preservation matrix.
- **Stage A Analysis:** See `docs/analysis/07-cross-application-summary.md` for legacy system analysis, all 65 business rules, and 30 security vulnerabilities.
- **Part B (Remaining):** Sections 5 (Caching & Performance Strategy), 6 (Frontend Architecture), and 9 (Testing Strategy) will be covered in follow-up sessions.

---

**Document Status:** Sections 1-4 (Part A) and Sections 7-8 (Part B — API Design Principles & Deployment Infrastructure) complete  
**Next:** Sections 5 (Caching & Performance Strategy), 6 (Frontend Architecture), 9 (Testing Strategy)