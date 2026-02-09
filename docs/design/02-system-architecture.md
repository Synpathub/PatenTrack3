# PatenTrack3 System Architecture

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Complete

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Redesign](#2-data-flow-redesign)
3. [Authentication & Authorization Architecture](#3-authentication--authorization-architecture)
4. [Ingestion Pipeline Architecture](#4-ingestion-pipeline-architecture)
5. [Caching Strategy](#5-caching-strategy)
6. [Real-Time Architecture](#6-real-time-architecture)
7. [API Design Principles](#7-api-design-principles)
8. [Deployment & Infrastructure](#8-deployment--infrastructure)
9. [Security Architecture — Vulnerability Resolution Matrix](#9-security-architecture--vulnerability-resolution-matrix)

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

## 5. Caching Strategy

### 5.1 Problem Statement

The legacy PatenTrack system has **zero caching** — every request hits the database directly. A single dashboard load triggers **10–30 SQL queries** against PostgreSQL, resulting in high latency (p95 > 2s) and unnecessary database load. The rebuilt system introduces a Redis-based caching layer to reduce query volume, improve response times, and provide a foundation for real-time cache invalidation.

### 5.2 Caching Targets

The following data categories are cacheable, each with a specific key pattern, TTL, and invalidation strategy:

| Data | Cache Key Pattern | TTL | Invalidation Trigger |
|------|-------------------|-----|----------------------|
| Dashboard summary | `org:{id}:dashboard` | Until invalidated | New assignment ingestion for this org |
| Ownership tree JSON | `org:{id}:tree:{assetId}` | Until invalidated | New assignment for this org |
| Patent bibliographic | `patent:{grantNum}:biblio` | 24 hours | Immutable after ingestion |
| CPC hierarchy | `cpc:{code}:tree` | 30 days | Monthly CPC refresh |
| Company logo/domain | `company:{name}:logo` | 7 days | Manual refresh |
| User session | `session:{userId}` | 15 minutes | Logout/revocation |
| API response | `api:{hash}` | Varies | Varies |

**Key design decisions:**

- **Dashboard and tree data** use event-driven invalidation with no fixed TTL. They are refreshed only when the ingestion pipeline processes new assignments for the relevant org.
- **Patent bibliographic data** is effectively immutable after initial ingestion and uses a 24-hour TTL as a safety net.
- **CPC hierarchy** changes monthly and is refreshed on the USPTO CPC update schedule.
- **User sessions** use a short 15-minute TTL with sliding expiration to support the authentication architecture (see Section 3).

### 5.3 Cache-Aside Pattern

All cached data follows the **cache-aside** (lazy-loading) pattern:

```mermaid
flowchart TD
    A[Client Request] --> B{Check Redis Cache}
    B -->|Cache HIT| C[Return Cached Data]
    B -->|Cache MISS| D[Query PostgreSQL]
    D --> E[Store Result in Redis]
    E --> F[Return Data to Client]
    
    style B fill:#f9f,stroke:#333,stroke-width:2px
    style C fill:#9f9,stroke:#333,stroke-width:2px
    style D fill:#ff9,stroke:#333,stroke-width:2px
```

**Implementation:**

```typescript
// Generic cache-aside helper
async function cacheAside<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number | null,
  fetcher: () => Promise<T>,
): Promise<T> {
  // 1. Check Redis
  const cached = await redis.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  // 2. Cache miss — query source
  const data = await fetcher();

  // 3. Store in Redis
  if (ttlSeconds !== null) {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } else {
    // No TTL — invalidated by events only (with max TTL safety net)
    await redis.setex(key, 86400, JSON.stringify(data)); // 24h fallback TTL safety net
  }

  return data;
}

// Usage: Dashboard summary
async function getDashboardSummary(orgId: string): Promise<DashboardSummary> {
  return cacheAside(
    redis,
    `org:${orgId}:dashboard`,
    null, // event-driven invalidation
    () => dashboardRepository.getSummary(orgId),
  );
}
```

### 5.4 Invalidation Strategy

Cache invalidation uses a layered approach combining event-driven invalidation with TTL fallbacks:

**Layer 1 — Event-Driven Invalidation:**

When the ingestion pipeline completes processing for an org, it publishes an event to Redis Pub/Sub. The API server subscribes to these events and invalidates affected caches immediately.

```mermaid
flowchart LR
    subgraph "Ingestion Pipeline"
        W[Worker completes<br/>org processing]
    end
    
    subgraph "Redis"
        PS[Pub/Sub Channel:<br/>cache:invalidate]
        CACHE[(Cache Store)]
    end
    
    subgraph "API Server"
        SUB[Subscriber]
        DEL[Delete cached keys<br/>for affected org]
    end
    
    W -->|"Publish {orgId, type}"| PS
    PS -->|"Notify"| SUB
    SUB --> DEL
    DEL -->|"DEL org:{id}:*"| CACHE
    
    style PS fill:#f96,stroke:#333,stroke-width:2px
    style CACHE fill:#69f,stroke:#333,stroke-width:2px
```

**Implementation:**

```typescript
// Publisher: Called by ingestion worker on completion
async function publishCacheInvalidation(
  redis: Redis,
  orgId: string,
  type: 'assignment' | 'biblio' | 'cpc',
): Promise<void> {
  await redis.publish(
    'cache:invalidate',
    JSON.stringify({ orgId, type, timestamp: Date.now() }),
  );
}

// Subscriber: Running in API server process
function subscribeToCacheInvalidation(
  subscriber: Redis,
  cache: Redis,
): void {
  subscriber.subscribe('cache:invalidate');

  subscriber.on('message', async (_channel: string, message: string) => {
    const { orgId, type } = JSON.parse(message);

    if (type === 'assignment') {
      // Invalidate dashboard and tree caches for this org
      // Use SCAN instead of KEYS to avoid blocking Redis
      for await (const key of cache.scanStream({ match: `org:${orgId}:*` })) {
        await cache.del(key);
      }
    } else if (type === 'cpc') {
      // Invalidate all CPC caches
      for await (const key of cache.scanStream({ match: 'cpc:*' })) {
        await cache.del(key);
      }
    }
  });
}
```

**Layer 2 — Write-Through Invalidation:**

User-initiated mutations (e.g., org settings changes, manual data corrections) invalidate caches immediately on write:

```typescript
async function updateOrgSettings(
  orgId: string,
  settings: OrgSettings,
): Promise<void> {
  // 1. Write to PostgreSQL
  await orgRepository.updateSettings(orgId, settings);

  // 2. Immediately invalidate cache (SCAN to avoid blocking Redis)
  for await (const key of redis.scanStream({ match: `org:${orgId}:*` })) {
    await redis.del(key);
  }
}
```

**Layer 3 — TTL Fallback:**

All cached items have a maximum TTL even when using event-driven invalidation, to guard against missed invalidation events:

| Invalidation Type | Max TTL Safety Net |
|---|---|
| Event-driven (dashboard, tree) | 24 hours |
| Immutable (patent biblio) | 24 hours |
| Scheduled (CPC) | 30 days |
| Short-lived (sessions) | 15 minutes |

### 5.5 Cache Warming

On API server startup or after a Redis flush, critical caches are pre-warmed:

```typescript
async function warmCriticalCaches(): Promise<void> {
  // Warm dashboard caches for active orgs
  const activeOrgs = await orgRepository.getActiveOrgs();

  for (const org of activeOrgs) {
    await cacheAside(
      redis,
      `org:${org.id}:dashboard`,
      null,
      () => dashboardRepository.getSummary(org.id),
    );
  }

  logger.info(`Warmed dashboard caches for ${activeOrgs.length} orgs`);
}
```

### 5.6 Target Metrics

| Metric | Before (Legacy) | After (Rebuilt) |
|--------|-----------------|-----------------|
| Queries per dashboard load | 10–30 SQL queries | 1–3 queries + cache hits |
| p95 dashboard response | >2,000ms | <200ms |
| p95 cached endpoint response | N/A | <100ms |
| Cache hit ratio (dashboard) | 0% | >80% |
| Database connection pressure | High (every request) | Low (cache misses only) |

### 5.7 Redis Configuration

```yaml
# Redis cache configuration
redis:
  host: ${REDIS_HOST}
  port: 6379
  db: 0          # Cache store
  # db: 1        # BullMQ job queue (separate DB)
  # db: 2        # Session store (separate DB)
  maxmemory: 512mb
  maxmemory-policy: allkeys-lru   # Evict least-recently-used when full
  
  # Connection pool
  pool:
    min: 5
    max: 20
    idleTimeoutMs: 30000
```

**Redis DB separation:**

| DB | Purpose | Eviction Policy |
|----|---------|-----------------|
| 0 | Data cache (dashboard, biblio, CPC) | `allkeys-lru` |
| 1 | BullMQ job queue | `noeviction` |
| 2 | Session store | `volatile-ttl` |

This separation ensures that cache eviction under memory pressure does not affect job queue or session data.

---

## 6. Real-Time Architecture

### 6.1 Problem Statement

The legacy system uses two incompatible real-time solutions:

- **PT-API:** Socket.IO with **no authentication** (vulnerability S-16). Any client can connect and receive events for any org.
- **PT-Admin:** Pusher.js (third-party SaaS) for admin notifications, adding an external dependency and additional cost.

The rebuilt system replaces both with a unified **Server-Sent Events (SSE)** architecture backed by Redis Pub/Sub.

### 6.2 SSE vs. WebSocket — Justification

| Criteria | SSE | WebSocket |
|----------|-----|-----------|
| **Direction** | Server → Client (push only) | Bidirectional |
| **PatenTrack need** | ✅ All real-time needs are server-push | ❌ No client→server real-time needed |
| **Auto-reconnect** | ✅ Built-in browser support | ❌ Must implement manually |
| **Proxy compatibility** | ✅ Works through HTTP proxies, CDNs | ⚠️ Requires upgrade negotiation |
| **Protocol** | HTTP/1.1 or HTTP/2 | Custom ws:// protocol |
| **Authentication** | ✅ Standard HTTP headers (JWT) | ⚠️ Must pass token in query string or first message |
| **Complexity** | Low — standard HTTP semantics | Higher — connection lifecycle management |
| **Scalability (<1000 users)** | ✅ More than sufficient | ❌ Overkill for this scale |

**Decision: SSE** — PatenTrack's real-time requirements are exclusively server→client push (ingestion progress, refresh triggers, notifications). There is no client→server real-time requirement — user actions like comments and settings changes use standard REST endpoints. SSE provides auto-reconnect, works through proxies/CDNs, uses standard HTTP authentication, and is simpler to implement and maintain.

### 6.3 Event Types

| Event | Source | Target | Payload |
|-------|--------|--------|---------|
| Ingestion progress | Worker → Redis Pub/Sub → SSE | Admin dashboard | `{jobId, step, progress}` |
| New assignments | Ingestion completion → SSE | Affected org users | `{orgId, count, refreshNeeded}` |
| Dashboard refresh | Cache invalidation → SSE | Org viewers | `{orgId, dataType}` |
| Pipeline completion | Worker → SSE | Admin | `{orgId, status, duration}` |

### 6.4 Architecture Diagram

```mermaid
flowchart LR
    subgraph "Background Workers"
        IW[Ingestion Worker]
        PW[Pipeline Worker]
    end
    
    subgraph "Redis"
        PS[Pub/Sub Channels:<br/>events:org:{id}<br/>events:admin]
    end
    
    subgraph "API Server"
        SSE_H[SSE Handler<br/>GET /api/events/stream]
        AUTH[JWT Auth Middleware]
    end
    
    subgraph "Browser Clients"
        ES1[EventSource<br/>Org User A]
        ES2[EventSource<br/>Org User B]
        ES3[EventSource<br/>Admin]
    end
    
    IW -->|"Publish progress"| PS
    PW -->|"Publish completion"| PS
    PS -->|"Subscribe"| SSE_H
    AUTH -->|"Validate JWT"| SSE_H
    SSE_H -->|"Filtered by org"| ES1
    SSE_H -->|"Filtered by org"| ES2
    SSE_H -->|"Admin events"| ES3
    
    style PS fill:#f96,stroke:#333,stroke-width:2px
    style SSE_H fill:#69f,stroke:#333,stroke-width:2px
    style AUTH fill:#9f9,stroke:#333,stroke-width:2px
```

### 6.5 SSE Endpoint Implementation

**Endpoint:** `GET /api/events/stream`

All connections require a valid JWT (fixing vulnerability S-16 from the legacy system).

```typescript
import { Router, Request, Response } from 'express';

const router = Router();

// SSE endpoint — requires authentication
router.get(
  '/api/events/stream',
  authenticateJWT, // Middleware validates JWT (see Section 3)
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const orgId = req.user!.orgId;
    const isAdmin = req.user!.role === 'admin';

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ userId, orgId })}\n\n`);

    // Subscribe to org-specific channel
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`events:org:${orgId}`);

    // Subscribe to admin channel if admin
    if (isAdmin) {
      await subscriber.subscribe('events:admin');
    }

    // Forward events to SSE stream
    subscriber.on('message', (channel: string, message: string) => {
      const event = JSON.parse(message);
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    });

    // Heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    // Cleanup on disconnect
    req.on('close', async () => {
      clearInterval(heartbeat);
      await subscriber.unsubscribe();
      await subscriber.quit();
    });
  },
);
```

### 6.6 Event Publishing (Worker Side)

Workers publish events to Redis Pub/Sub channels:

```typescript
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

interface SSEEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

async function publishEvent(
  redis: Redis,
  channel: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const event: SSEEvent = {
    id: randomUUID(),
    type,
    payload,
  };

  await redis.publish(channel, JSON.stringify(event));
}

// Usage in ingestion worker
async function onIngestionProgress(
  redis: Redis,
  orgId: string,
  jobId: string,
  step: string,
  progress: number,
): Promise<void> {
  // Send to org-specific channel (for org users)
  await publishEvent(redis, `events:org:${orgId}`, 'ingestion:progress', {
    jobId,
    step,
    progress,
  });

  // Send to admin channel
  await publishEvent(redis, 'events:admin', 'ingestion:progress', {
    orgId,
    jobId,
    step,
    progress,
  });
}

// Usage on pipeline completion
async function onPipelineComplete(
  redis: Redis,
  orgId: string,
  status: 'success' | 'error',
  duration: number,
): Promise<void> {
  // Notify org users that new data is available
  await publishEvent(redis, `events:org:${orgId}`, 'assignments:new', {
    orgId,
    refreshNeeded: true,
  });

  // Notify admins of pipeline completion
  await publishEvent(redis, 'events:admin', 'pipeline:complete', {
    orgId,
    status,
    duration,
  });
}
```

### 6.7 Client-Side Integration

```typescript
// Browser client — React hook for SSE
function useSSE(token: string): SSEConnection {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // EventSource with auth via custom header (using eventsource polyfill)
    const es = new EventSourcePolyfill('/api/events/stream', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    es.addEventListener('connected', () => {
      setConnected(true);
    });

    // Auto-reconnect is built into EventSource
    // Last-Event-ID is sent automatically on reconnect
    es.addEventListener('ingestion:progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, { type: 'ingestion:progress', ...data }]);
    });

    es.addEventListener('assignments:new', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      // Trigger dashboard refresh
      queryClient.invalidateQueries(['dashboard', data.orgId]);
    });

    es.addEventListener('dashboard:refresh', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      queryClient.invalidateQueries(['dashboard', data.orgId]);
    });

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects; no manual intervention needed
    };

    return () => {
      es.close();
    };
  }, [token]);

  return { events, connected };
}
```

### 6.8 Auto-Reconnect & Last-Event-ID

SSE has built-in reconnection support via the `Last-Event-ID` header:

1. Server sends each event with an `id` field.
2. If the connection drops, the browser automatically reconnects.
3. On reconnect, the browser sends the `Last-Event-ID` header with the last received event ID.
4. The server can use this to replay missed events (if buffered in Redis).

```typescript
// Server-side: Handle reconnection with Last-Event-ID
router.get(
  '/api/events/stream',
  authenticateJWT,
  async (req: Request, res: Response) => {
    const lastEventId = req.headers['last-event-id'] as string | undefined;

    if (lastEventId) {
      // Replay missed events from Redis stream buffer
      const missedEvents = await getMissedEvents(req.user!.orgId, lastEventId);
      for (const event of missedEvents) {
        res.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
        );
      }
    }

    // Continue with live event stream...
  },
);
```

### 6.9 Security Considerations

| Concern | Mitigation |
|---------|------------|
| Unauthenticated connections (S-16) | All SSE connections require valid JWT |
| Cross-org data leakage | Events filtered by org from JWT claims |
| Connection flooding | Rate limiting on SSE endpoint (max 2 connections per user) |
| Token expiration during stream | Heartbeat checks token validity; close on expiry |
| Event injection | Workers are the only publishers; no client→server channel |

### 6.10 Integration with Caching (Section 5)

The real-time architecture integrates directly with the caching strategy:

```mermaid
flowchart TD
    subgraph "Ingestion Pipeline"
        W[Worker completes<br/>org processing]
    end
    
    subgraph "Redis"
        PS[Pub/Sub]
        CACHE[(Cache Store)]
    end
    
    subgraph "API Server"
        INV[Cache Invalidator]
        SSE[SSE Handler]
    end
    
    subgraph "Browser"
        ES[EventSource Client]
        UI[Dashboard UI]
    end
    
    W -->|"1. Publish completion"| PS
    PS -->|"2a. Invalidate cache"| INV
    INV -->|"DEL org:{id}:*"| CACHE
    PS -->|"2b. Push event"| SSE
    SSE -->|"3. SSE: assignments:new"| ES
    ES -->|"4. Trigger refresh"| UI
    UI -->|"5. Fetch (cache miss → fresh data)"| CACHE
    
    style PS fill:#f96,stroke:#333,stroke-width:2px
    style CACHE fill:#69f,stroke:#333,stroke-width:2px
    style SSE fill:#9f9,stroke:#333,stroke-width:2px
```

**Flow:**
1. Ingestion worker completes processing for an org.
2. Redis Pub/Sub triggers two parallel actions:
   - **2a.** Cache invalidator deletes stale cached data for the org.
   - **2b.** SSE handler pushes a `assignments:new` event to connected clients.
3. Browser receives the SSE event.
4. Client-side code triggers a dashboard data refresh (e.g., React Query `invalidateQueries`).
5. The refresh request hits a cache miss (because cache was just invalidated), fetches fresh data from PostgreSQL, and populates the cache.

This ensures users see fresh data immediately after ingestion without polling, and the cache is always consistent with the database.

---

## 7. API Design Principles

This section establishes the conventions for PatenTrack3's ~80 consolidated API endpoints. Detailed endpoint specifications (request/response schemas, authorization requirements per endpoint) will be defined in a subsequent session. The decisions here build on Section 1's hybrid architecture: **Next.js API routes as BFF** for all request-response operations.

### 7.1 Protocol Decision: REST with OpenAPI

**Decision:** REST with OpenAPI 3.1 auto-generated from Zod schemas.

**Evaluation:**

| Criterion | tRPC | REST + OpenAPI |
|-----------|------|----------------|
| Type safety (client ↔ server) | ✅ End-to-end via inference | ✅ Via Zod schemas in `packages/shared` + codegen |
| Developer Experience (DX) with Next.js App Router | ✅ Excellent (direct import) | ✅ Good (standard fetch, React Query) |
| Share Viewer (public-facing) | ⚠️ Requires separate REST layer | ✅ Native — no adapter needed |
| Future third-party integrations | ❌ Non-standard; clients must use tRPC | ✅ Standard HTTP; any client can consume |
| OpenAPI spec / documentation | ❌ Not native (adapters exist but add complexity) | ✅ Auto-generated from Zod via `zod-openapi` |
| Tooling ecosystem | ⚠️ Growing but smaller | ✅ Mature (Postman, Swagger UI, codegen) |
| Learning curve for new devs | ⚠️ tRPC-specific patterns | ✅ Industry-standard REST conventions |

**Rationale:**

The Share Viewer is a public-facing feature that serves read-only portfolio views to unauthenticated external users via shareable links. This is a public API surface that must work with standard HTTP semantics — no tRPC client should be required. Additionally, PatenTrack may eventually expose data to enterprise customers or patent analytics platforms, making REST + OpenAPI the safer long-term choice.

tRPC would offer marginally better DX for internal routes, but the cost of maintaining a separate REST layer for public endpoints (Share Viewer, potential future integrations) outweighs the benefit. With Zod schemas shared via `packages/shared`, we achieve type safety across the stack without tRPC's tight coupling.

### 7.2 URL Structure

All API routes follow a resource-oriented URL pattern with versioning:

```
/api/v1/{resource}
/api/v1/{resource}/{id}
/api/v1/{resource}/{id}/{sub-resource}
```

**Route organization by domain:**

| Domain | Base Path | Examples |
|--------|-----------|---------|
| Assets (patents/trademarks) | `/api/v1/assets` | `GET /api/v1/assets`, `GET /api/v1/assets/:id` |
| Families | `/api/v1/families` | `GET /api/v1/families`, `GET /api/v1/families/:id/assets` |
| Companies | `/api/v1/companies` | `GET /api/v1/companies`, `GET /api/v1/companies/:id` |
| Customers (orgs) | `/api/v1/customers` | `GET /api/v1/customers`, `GET /api/v1/customers/:id/dashboard` |
| Dashboards | `/api/v1/dashboards` | `GET /api/v1/dashboards/:type` |
| Events (assignments) | `/api/v1/events` | `GET /api/v1/events`, `GET /api/v1/events/:id` |
| Ingestion | `/api/v1/ingestion` | `POST /api/v1/ingestion/trigger`, `GET /api/v1/ingestion/status` |
| Admin | `/api/v1/admin` | `GET /api/v1/admin/users`, `POST /api/v1/admin/orgs` |
| Share | `/api/v1/share` | `GET /api/v1/share/:token` |

**Conventions:**
- Plural nouns for collections (`/assets`, not `/asset`)
- Resource IDs use the format `/:id` (UUIDs, matching the domain model)
- Nested resources for strong parent-child relationships only (`/families/:id/assets`)
- Action endpoints use verbs only when CRUD semantics don't apply (`/ingestion/trigger`)

### 7.3 OpenAPI Specification

OpenAPI 3.1 specs are auto-generated from Zod schemas using `zod-openapi`:

```typescript
// packages/shared/src/schemas/asset.ts
import { z } from 'zod';
import { extendZodWithOpenApi } from 'zod-openapi';

extendZodWithOpenApi(z);

export const AssetSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Unique asset identifier' }),
  type: z.enum(['patent', 'trademark', 'application']).openapi({ description: 'Asset type' }),
  title: z.string().openapi({ description: 'Asset title' }),
  number: z.string().openapi({ description: 'Patent/trademark number' }),
  status: z.enum(['active', 'expired', 'pending', 'abandoned']).openapi({ description: 'Current status' }),
  familyId: z.string().uuid().nullable().openapi({ description: 'Parent family ID' }),
  customerId: z.string().uuid().openapi({ description: 'Owning organization ID' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
}).openapi('Asset');
```

The OpenAPI spec is served at `/api/v1/docs` (Swagger UI) and `/api/v1/openapi.json` (raw spec) in non-production environments.

### 7.4 Error Format

All API errors follow a consistent envelope format:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource.",
    "details": {}
  }
}
```

**Standard error codes:**

| HTTP Status | Error Code | Usage |
|-------------|-----------|-------|
| 400 | `VALIDATION_ERROR` | Invalid input (Zod validation failure). `details` contains field-level errors. |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication token. |
| 403 | `FORBIDDEN` | Authenticated but insufficient permissions (RLS or role check). |
| 404 | `NOT_FOUND` | Resource does not exist or is not accessible to the tenant. |
| 409 | `CONFLICT` | Duplicate resource or concurrent modification conflict. |
| 422 | `UNPROCESSABLE_ENTITY` | Valid syntax but semantic error (e.g., invalid state transition). |
| 429 | `RATE_LIMITED` | Rate limit exceeded. `details` contains `retryAfter` (seconds). |
| 500 | `INTERNAL_ERROR` | Unexpected server error. `details` contains `requestId` for tracing. |

**Validation error example:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body.",
    "details": {
      "fieldErrors": {
        "email": ["Invalid email address"],
        "name": ["Required"]
      }
    }
  }
}
```

### 7.5 Pagination

**Cursor-based pagination** for all collection endpoints. This is critical for PatenTrack's scale — the assignments table has 50M+ rows, and offset-based pagination degrades severely at high page numbers.

**Response format:**

```json
{
  "data": [
    { "id": "...", "..." : "..." }
  ],
  "cursor": {
    "next": "eyJpZCI6IjEyMzQ1In0=",
    "hasMore": true
  },
  "total": 1523847
}
```

**Request parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | `null` | Opaque cursor from previous response. Omit for first page. |
| `limit` | integer | 50 | Items per page. Max: 200. |
| `sort` | string | varies | Sort field (e.g., `createdAt`, `number`). |
| `order` | string | `desc` | Sort direction: `asc` or `desc`. |

**Implementation notes:**
- Cursors are Base64-encoded JSON containing the sort key and ID for deterministic ordering.
- The `total` field is optional and only included when `includeTotal=true` query param is set (expensive COUNT on large tables; uses cached approximate counts when possible).
- For the Share Viewer (`/api/v1/share/:token`), pagination limits are stricter: max 25 items per page.

### 7.6 Rate Limiting

Rate limits are enforced per role using a sliding-window algorithm backed by Redis:

| Role | Limit | Window | Rationale |
|------|-------|--------|-----------|
| Super Admin | 1000 req/min | 1 minute | Admin tooling, bulk operations |
| Org Admin | 300 req/min | 1 minute | Dashboard management, user admin |
| Org Member | 100 req/min | 1 minute | Standard dashboard usage |
| Share Viewer | 30 req/min | 1 minute | Public read-only; abuse prevention |

**Response headers (included on every response):**

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1707451200
```

- `X-RateLimit-Limit`: Maximum requests allowed in the current window.
- `X-RateLimit-Remaining`: Remaining requests in the current window.
- `X-RateLimit-Reset`: Unix timestamp (seconds) when the window resets.

When a rate limit is exceeded, the API responds with:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 32
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1707451200

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again in 32 seconds.",
    "details": { "retryAfter": 32 }
  }
}
```

### 7.7 Input Validation

All input validation uses **Zod schemas** shared via the `packages/shared` package. The same schemas are used for:

1. **API request validation** — Next.js API route handlers parse and validate request bodies/params.
2. **Frontend form validation** — React Hook Form + Zod resolver for client-side validation.
3. **OpenAPI generation** — `zod-openapi` generates OpenAPI specs from the same schemas.

```typescript
// packages/shared/src/schemas/create-customer.ts
import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(63),
  plan: z.enum(['free', 'pro', 'enterprise']),
  settings: z.object({
    emailNotifications: z.boolean().default(true),
    slackWebhookUrl: z.string().url().optional(),
  }).optional(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
```

```typescript
// apps/web/src/app/api/v1/customers/route.ts
import { CreateCustomerSchema } from '@patentrack/shared/schemas';

export async function POST(request: Request) {
  const body = await request.json();
  const result = CreateCustomerSchema.safeParse(body);

  if (!result.success) {
    return Response.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body.',
        details: { fieldErrors: result.error.flatten().fieldErrors },
      },
    }, { status: 400 });
  }

  // result.data is fully typed as CreateCustomerInput
  const customer = await createCustomer(result.data);
  return Response.json({ data: customer }, { status: 201 });
}
```

### 7.8 Response Caching

**ETag + If-None-Match** for immutable and slowly-changing data:

| Data Type | Cache Strategy | Cache-Control | ETag |
|-----------|---------------|---------------|------|
| Patent/trademark metadata | ETag | `private, max-age=3600` | Hash of `updatedAt` |
| Assignment history | ETag | `private, max-age=86400` | Hash of latest assignment timestamp |
| Dashboard aggregations | Short TTL | `private, max-age=300, stale-while-revalidate=60` | — |
| Share Viewer data | ETag + CDN | `public, max-age=3600, s-maxage=86400` | Hash of portfolio snapshot |
| User-specific data | No cache | `private, no-store` | — |

**Key rules:**
- All tenant-scoped data uses `Cache-Control: private` to prevent CDN/proxy caching of tenant data.
- Share Viewer data is the only `public` cacheable resource (it's intentionally public by design).
- Ingestion-triggered cache invalidation (see Section 6) ensures stale data is purged when new data arrives.

### 7.9 Request Tracing

Every API request is assigned a **UUID request ID** for end-to-end tracing:

```
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

- If the client sends an `X-Request-ID` header, the server uses it (enabling client-side correlation).
- If no `X-Request-ID` is provided, the server generates one.
- The request ID is included in all log entries, error responses, and Sentry error reports.
- This enables tracing a request from the browser → API route → database query → background job (if applicable).

### 7.10 Request Body Limits

| Context | Max Body Size | Rationale |
|---------|--------------|-----------|
| Default API requests | 1 MB | Sufficient for all CRUD operations. Reduced from legacy 100MB (S-27). |
| File uploads (via presigned URL) | 50 MB | Patent documents, logos. Uploads go directly to S3 via presigned URLs; the API only receives the S3 key. |
| Ingestion payloads | N/A | Ingestion workers download directly from USPTO; no user-uploaded payloads. |

The 1MB default limit is enforced at the Next.js API route level. File uploads bypass the API body limit entirely by using S3 presigned URLs — the client uploads directly to S3 and then notifies the API with the file metadata (key, size, content type).

### 7.11 CORS Policy

**Explicit origin allowlist only** — fixing legacy vulnerability S-20 (wildcard CORS).

```typescript
// apps/web/next.config.ts — CORS middleware
const ALLOWED_ORIGINS = [
  process.env.APP_URL,                    // e.g., https://app.patentrack.com
  process.env.SHARE_URL,                  // e.g., https://share.patentrack.com
  ...(process.env.NODE_ENV === 'development'
    ? ['http://localhost:3000', 'http://localhost:3001']
    : []),
];
```

**Rules:**
- No wildcard (`*`) origins in any environment.
- `Access-Control-Allow-Credentials: true` for authenticated endpoints.
- Preflight (`OPTIONS`) responses are cached for 1 hour (`Access-Control-Max-Age: 3600`).
- The Share Viewer origin is explicitly allowed (it's a separate subdomain).

### 7.12 API Design Summary

```mermaid
graph TB
    subgraph "Client Layer"
        BROWSER["Browser<br/>(React Query + Zod)"]
        SHARE["Share Viewer<br/>(Public)"]
        FUTURE["Future Integrations<br/>(REST + OpenAPI)"]
    end

    subgraph "API Layer (Next.js API Routes)"
        MW["Middleware Stack"]
        ROUTES["Route Handlers<br/>(/api/v1/*)"]
        OPENAPI["OpenAPI 3.1<br/>(auto-generated)"]
    end

    subgraph "Middleware Stack"
        CORS_MW["CORS<br/>(origin allowlist)"]
        REQID["Request ID<br/>(X-Request-ID)"]
        AUTH["Auth<br/>(JWT verification)"]
        RLS_MW["RLS Context<br/>(SET app.tenant_id)"]
        RATE["Rate Limiter<br/>(Redis sliding window)"]
        VALIDATE["Input Validation<br/>(Zod schemas)"]
        BODY["Body Size<br/>(1MB limit)"]
    end

    BROWSER -->|"HTTPS"| MW
    SHARE -->|"HTTPS (public)"| MW
    FUTURE -->|"HTTPS + API Key"| MW

    CORS_MW --> REQID --> AUTH --> RLS_MW --> RATE --> VALIDATE --> BODY --> ROUTES

    ROUTES -->|"SQL (Drizzle + RLS)"| PG[("PostgreSQL")]
    ROUTES -->|"Cache/Rate State"| REDIS[("Redis")]

    style MW fill:#f9f,stroke:#333,stroke-width:2px
    style ROUTES fill:#9f9,stroke:#333,stroke-width:2px
    style OPENAPI fill:#ff9,stroke:#333,stroke-width:2px
```

**Middleware execution order:**
1. **CORS** — Reject disallowed origins immediately.
2. **Request ID** — Assign/propagate `X-Request-ID`.
3. **Auth** — Verify JWT, extract user/tenant context (skip for Share Viewer public routes).
4. **RLS Context** — Set `app.tenant_id` on the database connection for row-level security.
5. **Rate Limiter** — Check Redis sliding-window counter by role.
6. **Input Validation** — Parse and validate request body/params with Zod.
7. **Body Size** — Enforce 1MB limit (after validation to provide useful error messages).
8. **Route Handler** — Execute business logic, return response.

---

## 8. Deployment & Infrastructure

This section defines the deployment architecture, CI/CD pipeline, environment strategy, and monitoring for PatenTrack3. The recommendations are optimized for a startup budget while providing a clear upgrade path to AWS-native infrastructure at scale.

### 8.1 Recommended Infrastructure Stack

**Primary stack (startup budget — optimized for cost and operational simplicity):**

| Component | Service | Why |
|-----------|---------|-----|
| Frontend (Next.js) | Vercel | Zero-config Next.js hosting, edge functions, global CDN, PR previews |
| API/BFF | Vercel (same Next.js app) | Unified deployment; API routes colocated with frontend (Section 1 hybrid decision) |
| Workers | Railway | Long-running ingestion workers, BullMQ consumers, cron scheduling |
| PostgreSQL | Neon | Serverless Postgres, branching for staging, connection pooling, autoscaling |
| Redis | Upstash | Serverless Redis, BullMQ compatible, pay-per-request, global replication |
| File Storage | AWS S3 (private buckets + signed URLs) | Fixing S-09 (legacy public file access). Presigned URLs for secure upload/download. |
| Secrets | Environment vars + Infisical | Fixing S-05, S-06, S-10, S-12. Centralized secrets management with rotation support. |
| DNS/CDN | Vercel (built-in) + Cloudflare (DNS) | Automatic SSL, edge caching for Share Viewer |
| Email | Resend or AWS SES | Transactional emails (notifications, share invites) |

### 8.2 AWS-Native Alternative (Scale Path)

If PatenTrack grows beyond startup scale (>100 tenants, >1000 concurrent users), the architecture can migrate to AWS-native services:

| Component | Startup Stack | AWS-Native Alternative |
|-----------|--------------|----------------------|
| Frontend | Vercel | AWS CloudFront + S3 (static) + Lambda@Edge |
| API/BFF | Vercel API Routes | ECS Fargate (containerized Next.js) |
| Workers | Railway | ECS Fargate (dedicated task definitions) |
| PostgreSQL | Neon | Amazon RDS PostgreSQL (Multi-AZ) |
| Redis | Upstash | Amazon ElastiCache (Redis OSS) |
| File Storage | AWS S3 | AWS S3 (same — already AWS-native) |
| Secrets | Infisical | AWS Secrets Manager |
| Load Balancer | Vercel (built-in) | Application Load Balancer (ALB) |
| DNS | Cloudflare | Amazon Route 53 |

**Migration triggers:**
- Vercel function execution time limits hit (>300s for workers — already mitigated by Railway workers)
- Need for VPC-level network isolation (compliance requirements)
- Cost optimization at scale (Vercel per-seat pricing vs. AWS compute pricing)
- Multi-region deployment requirement

### 8.3 CI/CD Pipeline (GitHub Actions)

```mermaid
graph LR
    subgraph "PR Workflow (on pull_request)"
        LINT["Lint + Type-Check<br/>(turbo run lint typecheck)"]
        UNIT["Unit Tests<br/>(Vitest)"]
        INT["Integration Tests<br/>(Docker Compose:<br/>PG + Redis)"]
        SEC["Security Scan<br/>(npm audit + Trivy)"]
        BUILD["Build<br/>(turbo run build)"]
        PREVIEW["PR Preview<br/>(Vercel)"]
    end

    subgraph "Main Branch (on push to main)"
        STAGING_BUILD["Build + Test<br/>(full pipeline)"]
        STAGING_MIGRATE["DB Migration<br/>(Drizzle migrate)"]
        STAGING_DEPLOY["Deploy Staging<br/>(Vercel + Railway)"]
    end

    subgraph "Production (on tag or manual)"
        PROD_APPROVE["Manual Approval<br/>(GitHub Environment)"]
        PROD_MIGRATE["DB Migration<br/>(Drizzle migrate)"]
        PROD_DEPLOY["Deploy Production<br/>(Vercel + Railway)"]
    end

    LINT --> UNIT --> INT --> SEC --> BUILD --> PREVIEW
    STAGING_BUILD --> STAGING_MIGRATE --> STAGING_DEPLOY
    PROD_APPROVE --> PROD_MIGRATE --> PROD_DEPLOY
```

**Pipeline stages (PR workflow):**

| Stage | Tool | Description | Timeout |
|-------|------|-------------|---------|
| Lint | ESLint + `turbo run lint` | Code quality, consistent style | 3 min |
| Type-Check | TypeScript + `turbo run typecheck` | Compile-time type safety across all packages | 3 min |
| Unit Tests | Vitest + `turbo run test` | Fast unit tests, mocked dependencies | 5 min |
| Integration Tests | Vitest + Docker Compose | Real PostgreSQL + Redis; tests RLS, queries, BullMQ jobs | 10 min |
| Security Scan | `npm audit` + Trivy | Dependency vulnerability scanning, container scanning | 3 min |
| Build | `turbo run build` | Full production build of all packages and apps | 5 min |
| PR Preview | Vercel (automatic) | Deploy preview for visual review | 3 min |

**Production deployment:**

```yaml
# .github/workflows/deploy-production.yml (simplified)
name: Deploy Production
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # Requires manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx turbo run lint typecheck test build
      - name: Run DB migrations
        run: npx drizzle-kit migrate
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
      - name: Deploy to Vercel
        run: npx vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}
      - name: Deploy workers to Railway
        run: railway up --service=workers --environment=production
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### 8.4 Branch Strategy

```mermaid
gitgraph
    commit id: "initial"
    branch feature/auth
    checkout feature/auth
    commit id: "add-jwt"
    commit id: "add-rls"
    checkout main
    merge feature/auth id: "merge-auth" tag: "PR Preview ✓"
    commit id: "auto-deploy-staging" type: HIGHLIGHT
    branch production
    checkout production
    commit id: "deploy-prod" tag: "v1.0.0" type: HIGHLIGHT
    checkout main
    branch feature/ingestion
    commit id: "add-workers"
    checkout main
    merge feature/ingestion id: "merge-ingest"
    commit id: "staging-2" type: HIGHLIGHT
    checkout production
    merge main id: "release-1.1" tag: "v1.1.0" type: HIGHLIGHT
```

| Branch | Trigger | Action |
|--------|---------|--------|
| `feature/*` | Push | Vercel PR preview; lint, type-check, test |
| `main` | Merge PR | Auto-deploy to **staging** environment |
| `production` | Merge from `main` (with approval) or version tag | Deploy to **production** (requires GitHub Environment approval) |

**Rules:**
- Direct pushes to `main` and `production` are blocked (branch protection).
- All merges to `main` require passing CI checks and at least one code review.
- Merges to `production` require an additional manual approval via GitHub Environments.
- Hotfixes: Create a branch from `production`, fix, PR to `production` (then cherry-pick to `main`).

### 8.5 Environment Configuration

| Environment | Database | Redis | Workers | Purpose |
|-------------|----------|-------|---------|---------|
| Local | Docker Compose (PostgreSQL 16) | Docker Compose (Redis 7) | Local process (`tsx watch`) | Development, debugging |
| Staging | Neon (branched from production schema) | Upstash (separate instance) | Railway (staging service) | QA, integration testing, demo |
| Production | Neon (production database) | Upstash (production instance) | Railway (production service) | Live application |

**Local development setup:**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: patentrack
      POSTGRES_USER: patentrack
      POSTGRES_PASSWORD: localdev
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']

volumes:
  pgdata:
```

**Environment variable management:**

| Variable Category | Local | Staging | Production |
|-------------------|-------|---------|------------|
| Database URL | `.env.local` | Infisical (staging) | Infisical (production) |
| Redis URL | `.env.local` | Infisical (staging) | Infisical (production) |
| JWT secrets | `.env.local` | Infisical (staging) | Infisical (production) |
| AWS credentials | `.env.local` | GitHub Actions secrets | Infisical (production) |
| Third-party API keys | `.env.local` | Infisical (staging) | Infisical (production) |

All secrets are managed through **Infisical** (fixing S-05, S-06, S-10, S-12):
- No secrets in code or `.env` files committed to the repository.
- Secrets are injected at runtime via Infisical SDK or synced to Vercel/Railway environment variables.
- Automatic rotation support for database credentials and API keys.
- Audit log of all secret access.

### 8.6 Monitoring & Observability

| Category | Tool | What It Monitors |
|----------|------|-----------------|
| Error Tracking | Sentry (already partially in use) | Unhandled exceptions, API errors, frontend crashes |
| Structured Logging | JSON logs → Vercel/Railway log aggregation | Request logs, query performance, auth events |
| Job Monitoring | BullMQ Board + Slack alerts | Ingestion job status, failures, queue depth, stalled jobs |
| Database | Neon built-in monitoring | Query performance, connection count, storage usage |
| Redis | Upstash built-in console | Memory usage, command rate, key count |
| Uptime | Better Uptime (free tier) | HTTP health checks on `/api/v1/health` every 1 minute |
| Alerting | Slack webhooks | Error spikes, job failures, database issues, uptime incidents |

**Health check endpoint:**

```typescript
// apps/web/src/app/api/v1/health/route.ts
export async function GET() {
  const checks = {
    database: await checkDatabase(),   // SELECT 1
    redis: await checkRedis(),         // PING
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || 'unknown',
  };

  const healthy = checks.database && checks.redis;

  return Response.json(
    { status: healthy ? 'healthy' : 'degraded', checks },
    { status: healthy ? 200 : 503 }
  );
}
```

**Alert thresholds:**

| Metric | Warning | Critical | Channel |
|--------|---------|----------|---------|
| API error rate (5xx) | >1% over 5 min | >5% over 5 min | Slack `#alerts` |
| API latency (p95) | >2s | >5s | Slack `#alerts` |
| Ingestion job failures | >3 consecutive | >10 in 1 hour | Slack `#ingestion` |
| Queue depth (waiting) | >1000 jobs | >5000 jobs | Slack `#ingestion` |
| Database connections | >80% of pool | >95% of pool | Slack `#alerts` |
| Disk/storage usage | >80% | >90% | Slack `#alerts` |
| Uptime check failure | 1 failure | 3 consecutive | Slack `#alerts` + PagerDuty |

### 8.7 Deployment Topology Diagram

```mermaid
graph TB
    subgraph "Users"
        CUSTOMER["Customer Users<br/>(Browser)"]
        ADMIN["Admin Users<br/>(Browser)"]
        PUBLIC["Public Share Viewers<br/>(Browser)"]
    end

    subgraph "Edge Layer (Vercel)"
        CDN["Vercel CDN<br/>(Global Edge Network)"]
        EDGE_MW["Edge Middleware<br/>(Auth, CORS, Rate Limit)"]
    end

    subgraph "Application Layer (Vercel)"
        NEXTJS["Next.js 15+<br/>(SSR + API Routes)"]
        SSE_HANDLER["SSE Route Handler<br/>(/api/v1/events/stream)"]
    end

    subgraph "Worker Layer (Railway)"
        SCHEDULER["BullMQ Scheduler<br/>(Cron Jobs)"]
        INGEST_WORKER["Ingestion Workers<br/>(USPTO data processing)"]
        PIPELINE_WORKER["Pipeline Workers<br/>(8-step org DAG)"]
        BULL_BOARD["BullMQ Board<br/>(Job Dashboard)"]
    end

    subgraph "Data Layer"
        NEON[("Neon PostgreSQL<br/>(Serverless, RLS)")]
        UPSTASH[("Upstash Redis<br/>(Cache + Queue + Pub/Sub)")]
        S3[("AWS S3<br/>(Private Buckets)")]
    end

    subgraph "External Services"
        USPTO["USPTO APIs<br/>(PASDL, Bulk, CPC)"]
        SENTRY_SVC["Sentry<br/>(Error Tracking)"]
        INFISICAL["Infisical<br/>(Secrets)"]
        SLACK["Slack<br/>(Alerts)"]
        BETTER_UPTIME["Better Uptime<br/>(Health Checks)"]
    end

    CUSTOMER --> CDN
    ADMIN --> CDN
    PUBLIC --> CDN

    CDN --> EDGE_MW --> NEXTJS
    NEXTJS --> NEON
    NEXTJS --> UPSTASH
    NEXTJS --> S3
    NEXTJS --> SSE_HANDLER

    SSE_HANDLER -.->|"subscribe"| UPSTASH

    SCHEDULER --> UPSTASH
    UPSTASH -->|"consume jobs"| INGEST_WORKER
    UPSTASH -->|"consume jobs"| PIPELINE_WORKER
    INGEST_WORKER --> NEON
    PIPELINE_WORKER --> NEON
    INGEST_WORKER --> S3
    INGEST_WORKER -->|"publish events"| UPSTASH

    INGEST_WORKER --> USPTO

    NEXTJS -.-> SENTRY_SVC
    INGEST_WORKER -.-> SENTRY_SVC
    PIPELINE_WORKER -.-> SENTRY_SVC

    NEXTJS -.-> INFISICAL
    INGEST_WORKER -.-> INFISICAL

    INGEST_WORKER -.->|"failure alerts"| SLACK
    BETTER_UPTIME -->|"health check"| NEXTJS

    style CDN fill:#0070f3,stroke:#333,stroke-width:2px,color:#fff
    style NEXTJS fill:#0070f3,stroke:#333,stroke-width:2px,color:#fff
    style INGEST_WORKER fill:#7c3aed,stroke:#333,stroke-width:2px,color:#fff
    style PIPELINE_WORKER fill:#7c3aed,stroke:#333,stroke-width:2px,color:#fff
    style NEON fill:#00e699,stroke:#333,stroke-width:2px
    style UPSTASH fill:#ff4438,stroke:#333,stroke-width:2px,color:#fff
    style S3 fill:#ff9900,stroke:#333,stroke-width:2px
```

### 8.8 Infrastructure Cost Estimate (Startup Phase)

| Service | Plan | Estimated Monthly Cost |
|---------|------|----------------------|
| Vercel | Pro ($20/seat) | ~$40–60 (2–3 devs) |
| Railway | Starter ($5/service) | ~$15–25 (3 services) |
| Neon | Pro ($19/project) | ~$19–40 |
| Upstash | Pay-as-you-go | ~$10–20 |
| AWS S3 | Pay-as-you-go | ~$5–15 |
| Infisical | Team ($8/user) | ~$24 (3 users) |
| Sentry | Team ($26/mo) | ~$26 |
| Better Uptime | Free tier | $0 |
| **Total** | | **~$140–220/mo** |

This compares favorably to an AWS-native deployment (ECS + RDS + ElastiCache) which would typically cost $300–500/mo for equivalent capacity but require significantly more DevOps overhead.

---

## Cross-References

- **Domain Model:** See `docs/design/01-domain-model.md` for complete schema design, RLS policies, migration path, and business rule preservation matrix.
- **Stage A Analysis:** See `docs/analysis/07-cross-application-summary.md` for legacy system analysis, all 65 business rules, and 30 security vulnerabilities.
- **Security Architecture:** See [Section 9](#9-security-architecture--vulnerability-resolution-matrix) for the complete vulnerability resolution matrix mapping all 30 Stage A vulnerabilities to architectural fixes.

---

## 9. Security Architecture — Vulnerability Resolution Matrix

This section maps all 30 security vulnerabilities identified during the Stage A analysis (`docs/analysis/07-cross-application-summary.md`, Section 5) to their resolutions in the new PatenTrack3 architecture. Each vulnerability is categorized by the type of fix: eliminated by design, fixed by the authentication redesign (Section 3), fixed by infrastructure choices (Section 8), or fixed by framework and library selections.

**Summary:**

| Category | Count | Vulnerabilities |
|----------|-------|-----------------|
| Eliminated by Design | 5 | S-01, S-07, S-08, S-18, S-26 |
| Fixed by Auth Redesign (Section 3) | 11 | S-02, S-03, S-11, S-12, S-13, S-14, S-15, S-16, S-19, S-21, S-29 |
| Fixed by Infrastructure (Section 8) | 6 | S-04, S-05, S-06, S-09, S-10, S-30 |
| Fixed by Framework/Library Choices | 8 | S-17, S-20, S-22, S-23, S-24, S-25, S-27, S-28 |
| **Total** | **30** | **S-01 through S-30** |

### 9.1 Eliminated by Design

These vulnerabilities no longer exist because the legacy components that caused them have been completely removed from the architecture. The new system is built from scratch in TypeScript/Next.js, so these attack vectors cannot recur.

| ID | Vulnerability | Severity | Resolution | Why It Cannot Recur |
|----|--------------|----------|------------|---------------------|
| **S-01** | Command injection in PHP bridge (`exec()` in `runPhpScript.js`) | CRITICAL (CVSS 9.8) | The PHP bridge has been entirely eliminated. PatenTrack3 contains zero PHP code. All business logic is implemented in TypeScript within the Next.js monorepo. | There is no `exec()`, `spawn()`, or shell invocation anywhere in the codebase. The `runPhpScript.js` file does not exist. The attack vector — passing user input to a PHP CLI process — is architecturally impossible. |
| **S-07** | Axios CVE-2021-3749 SSRF | CRITICAL (CVSS 7.5) | Axios has been removed as a dependency. The new architecture uses the built-in `fetch` API (available natively in Node.js 18+ and Next.js server components) for all HTTP requests. | No Axios dependency exists in the monorepo. The native `fetch` API does not have the CVE-2021-3749 vulnerability. External API calls (USPTO, enrichment) use `fetch` with explicit URL allowlisting in the ingestion workers. |
| **S-08** | React 16/17 EOL, no security patches | CRITICAL (CVSS 7.0) | The legacy React 16 (PT-App) and React 17 (PT-Share) frontends have been replaced by Next.js 15+ with React 19. | Next.js 15+ is actively maintained and receives regular security patches. The framework is specified as a core dependency (Section 1.1) and kept current via Dependabot (Section 8.3). |
| **S-18** | Server-side script in client repository | HIGH | The monorepo architecture (Section 1) cleanly separates concerns: `apps/web` (frontend), `apps/workers` (background jobs), and `packages/*` (shared libraries). No server-side scripts exist in client-facing packages. | Turborepo workspace boundaries enforce separation. The build pipeline (Section 8.3) validates that `apps/web` does not import from `apps/workers`. Server-side code lives exclusively in API routes and worker packages. |
| **S-26** | `console.log` override adds stack traces | MEDIUM | The legacy `console.log` override that injected stack traces into client-side output has been removed. PatenTrack3 uses structured logging via Pino (server-side) and Sentry (client-side error tracking). | All logging goes through a centralized logger (Section 8.6). `console.log` is not overridden. Production builds strip `console.log` statements via the Next.js compiler. Stack traces are only captured server-side in Sentry, never exposed to the client. |

### 9.2 Fixed by Auth Redesign

These vulnerabilities are resolved by the authentication and authorization architecture defined in **Section 3**. Each fix references the specific subsection where the implementation is detailed.

| ID | Vulnerability | Severity | Resolution | Architecture Reference |
|----|--------------|----------|------------|----------------------|
| **S-02** | Token refresh bypasses signature verification | CRITICAL (CVSS 8.1) | Refresh tokens are opaque random values (not JWTs), stored server-side in Redis with a SHA-256 hash. On refresh, the server looks up the hash in Redis and validates it — there is no JWT signature to bypass. Tokens are rotated on every use (one-time use). | Section 3.2 (Security Vulnerability Fixes table), Section 3.4 (Token Lifecycle — refresh flow) |
| **S-03** | Share links grant full org admin access | CRITICAL (CVSS 8.2) | Share tokens are scoped JWTs containing `scope: 'share:read'`, `resource_type`, and `resource_id`. PostgreSQL RLS policies enforce that share tokens can only read the specific shared resource. Write operations are rejected at the middleware level. | Section 3.2 (share link fix), Section 3.3 (RBAC — Share Viewer role), Section 3.4 (Share Link Access flow) |
| **S-11** | Missing resource-level authorization on most endpoints | HIGH | Every authenticated request passes through Next.js middleware which extracts `org_id` from the JWT and sets `app.current_org_id` as a PostgreSQL session variable. RLS policies on all tables enforce row-level filtering by organization. | Section 3.2 (RLS + middleware), Section 3.3 (RBAC Model), Section 3.5 (middleware implementation) |
| **S-12** | JWT hardcoded secret fallback (`p@nt3nt8@60`) | HIGH | The application requires `JWT_SECRET` to be set via environment variable (managed by Infisical — Section 8.5). If the variable is not set, the application fails to start. There is no fallback value. Production deployments are recommended to use asymmetric signing (RS256) via KMS. | Section 3.2 (hardcoded JWT secret fix), Section 8.5 (secrets management via Infisical) |
| **S-13** | No rate limiting on any endpoint | HIGH | Redis-backed sliding window rate limiter is applied at the middleware level. Auth endpoints: 10 attempts per minute per IP. API endpoints: 1,000 requests per minute per tenant. Exceeding limits returns HTTP 429 with `Retry-After` header. | Section 3.2 (rate limiting specification) |
| **S-14** | No password complexity requirements | HIGH | Password policy enforced at both API and client levels: minimum 12 characters, at least 1 uppercase letter, 1 lowercase letter, and 1 digit. Passwords are hashed with bcrypt (salt factor 12 — also fixes S-23). | Section 3.2 (password complexity fix), Section 3.4 (login flow — bcrypt factor 12) |
| **S-15** | No account lockout after failed attempts | HIGH | Progressive lockout tracked in Redis: 5 failed attempts → 1-minute lockout, 10 failed attempts → 15-minute lockout, 20 failed attempts → account locked (requires admin unlock). Failed attempt counters are per-email and expire after 24 hours. | Section 3.2 (progressive delays specification) |
| **S-16** | WebSocket has no authentication | HIGH | WebSocket has been replaced by Server-Sent Events (SSE) routed through Next.js API routes (Section 6). All SSE connections pass through the same middleware that validates JWTs and sets RLS context. No anonymous real-time connections are permitted. | Section 3.2 (WebSocket fix), Section 6 (Real-Time Architecture — SSE implementation) |
| **S-19** | Dual token storage (localStorage + cookie) | HIGH | Tokens are stored exclusively in httpOnly, Secure, SameSite=Strict cookies. No tokens are ever placed in `localStorage` or `sessionStorage`. The access token cookie has `Max-Age=900` (15 min) and the refresh token cookie is restricted to `Path=/api/auth/refresh`. | Section 3.2 (dual token storage fix), Section 3.4 (Token specifications table) |
| **S-21** | Share links never expire, no revocation | MEDIUM | Share links have configurable expiration (`expires_at`) and maximum use counts (`max_uses`). The `share_links` table includes `deleted_at` for soft-delete revocation. Every access is logged in `share_access_log` with IP and user agent for audit purposes (BR-046, BR-047). | Section 3.4 (Share Link Access flow — expiry and use count checks) |
| **S-29** | JWT 24hr expiry, no refresh rotation | LOW | Access tokens expire in 15 minutes (not 24 hours). Refresh tokens are rotated on every use — the old token is deleted from Redis and a new one is issued. Refresh tokens have a 7-day TTL. If a refresh token is reused (replay attack), all tokens for that user are invalidated. | Section 3.4 (Token Lifecycle — refresh rotation), Section 3.4 (Token specifications table) |

### 9.3 Fixed by Infrastructure

These vulnerabilities are resolved by the infrastructure and deployment architecture defined in **Section 8**.

| ID | Vulnerability | Severity | Resolution | Architecture Reference |
|----|--------------|----------|------------|----------------------|
| **S-04** | Plaintext DB credentials in `db_business` | CRITICAL (CVSS 8.5) | Database credentials are managed through Infisical (centralized secrets manager). Credentials are injected at runtime as environment variables — never stored in plaintext files, configuration files, or source code. Neon (managed PostgreSQL) provides connection strings that are stored exclusively in Infisical. | Section 8.1 (Secrets — Infisical), Section 8.5 (secrets management) |
| **S-05** | Hardcoded API keys in PT-Share source code | CRITICAL (CVSS 8.0) | All API keys (Google, enrichment services, USPTO) are stored in Infisical and injected as environment variables at deployment time. The Infisical SDK loads secrets at runtime. No API keys exist in source code. | Section 8.1 (Secrets — Infisical), Section 8.5 (secrets management), Section 4 (ingestion workers — secrets loaded from environment) |
| **S-06** | Hardcoded API keys in ingestion scripts | CRITICAL (CVSS 8.0) | Ingestion workers (Section 4) load all API keys from environment variables provided by Infisical. The worker startup sequence validates that all required secrets are present before accepting jobs. No hardcoded keys exist in the worker codebase. | Section 8.5 (secrets management), Section 4.4 (worker configuration) |
| **S-09** | Public-read-write S3 bucket | CRITICAL (CVSS 8.0) | S3 buckets are configured as private (no public access). All file access uses presigned URLs with configurable expiration (default: 1 hour for downloads, 15 minutes for uploads). Bucket policies explicitly deny public access. CloudFront is not used for direct S3 access. | Section 8.1 (File Storage — private buckets + signed URLs) |
| **S-10** | `.env` committed with OAuth credentials | CRITICAL (CVSS 7.0) | `.env` files are in `.gitignore` and are never committed. All credentials are managed through Infisical for staging and production environments. Local development uses `.env.local` (also gitignored) with developer-specific credentials. CI/CD uses GitHub Actions secrets. | Section 8.5 (secrets management — environment table), Section 8.3 (CI/CD — security scan step) |
| **S-30** | Sentry DSN in environment | LOW | The Sentry DSN is stored as a non-secret environment variable, which is acceptable per Sentry's own documentation (DSNs are designed to be public-facing). However, it is still managed through Infisical for consistency. Source maps are uploaded to Sentry via auth token (stored in Infisical), not embedded in client bundles. | Section 8.1 (Observability — Sentry), Section 8.5 (secrets management) |

### 9.4 Fixed by Framework/Library Choices

These vulnerabilities are resolved by the technology choices, framework configurations, and library selections in the new architecture.

| ID | Vulnerability | Severity | Resolution | Implementation Detail |
|----|--------------|----------|------------|----------------------|
| **S-17** | File upload only blocks `.exe` extension | HIGH | File uploads use an allowlist approach (not a blocklist). Only specific MIME types are permitted: `application/pdf`, `image/png`, `image/jpeg`, `image/svg+xml`. Files are validated by both extension and magic bytes (file header inspection). Maximum file size is 10MB. Uploaded files are stored in S3 with randomized keys (no user-controlled filenames). | Next.js API route with `multer`-compatible middleware; S3 presigned upload URLs with content-type conditions. |
| **S-20** | CORS allows all origins | MEDIUM | CORS is configured with an explicit allowlist of permitted origins. In production, only the PatenTrack domain (`app.patentrack.com`) and share domain (`share.patentrack.com`) are allowed. Vercel's built-in CORS headers are configured in `next.config.ts`. Credentials mode requires exact origin match (no wildcards). | Next.js `next.config.ts` headers configuration; API route middleware validates `Origin` header. |
| **S-22** | Google tokens in query strings | MEDIUM | Google OAuth tokens are exchanged via the authorization code flow (server-side). The authorization code is received via redirect URL query parameter (standard OAuth2), but is immediately exchanged for tokens via a server-side POST request. Tokens are never exposed in URLs, browser history, or server logs. All token storage uses httpOnly cookies (Section 3.4). | Next.js API route `/api/auth/callback/google` handles the code exchange server-side. |
| **S-23** | bcrypt salt factor only 8 | MEDIUM | The bcrypt salt factor has been increased from 8 to 12 (industry standard). This is configured as a constant in the auth module and applies to all new password hashes. Existing users' passwords are rehashed on next successful login (transparent migration). | Auth module configuration: `BCRYPT_ROUNDS = 12`. Section 3.4 (login flow specifies bcrypt factor 12). |
| **S-24** | Email verification code only 6 hex chars | MEDIUM | Email verification codes are generated using `crypto.randomBytes(32)` (32 bytes), producing a 64-character hex string (256 bits of entropy). Codes expire after 15 minutes and are single-use (deleted from Redis after verification). Rate limiting prevents brute-force attempts on the verification endpoint. | Auth module uses Node.js `crypto` for secure random generation. |
| **S-25** | No CSRF protection | MEDIUM | CSRF protection is implemented via the double-submit cookie pattern. A CSRF token is set in a non-httpOnly cookie and must be included in request headers (`X-CSRF-Token`) for all state-changing requests. SameSite=Strict cookies provide additional defense-in-depth. Next.js middleware validates the CSRF token on POST/PUT/PATCH/DELETE requests. | Section 3.2 (S-19 fix mentions CSRF double-submit pattern); Next.js middleware implementation. |
| **S-27** | 100MB body size limit | MEDIUM | The default body size limit has been reduced to 1MB for JSON payloads (`bodyParser: { sizeLimit: '1mb' }` in Next.js API routes). File uploads bypass the body parser and use presigned S3 URLs with a 10MB limit enforced by S3 policy. This prevents denial-of-service via oversized request bodies. | Next.js API route configuration; S3 presigned URL content-length conditions. |
| **S-28** | No MFA/2FA | LOW | Multi-factor authentication is supported via TOTP (Time-based One-Time Password, RFC 6238). Users can enable MFA in their account settings. MFA is enforced for Super Admin and Org Admin roles. TOTP secrets are encrypted at rest in the database. Recovery codes (10 single-use codes) are generated on MFA enrollment. | Auth module supports TOTP via `otpauth` library; QR code generation for authenticator app enrollment. |

### 9.5 Vulnerability Coverage Verification

All 30 vulnerabilities from the Stage A analysis are accounted for across Sections 9.1–9.4:

| Severity | IDs | Section | Count |
|----------|-----|---------|-------|
| CRITICAL (S-01 to S-10) | S-01 | 9.1 Eliminated by Design | 1 |
| | S-02 | 9.2 Auth Redesign | 1 |
| | S-03 | 9.2 Auth Redesign | 1 |
| | S-04 | 9.3 Infrastructure | 1 |
| | S-05 | 9.3 Infrastructure | 1 |
| | S-06 | 9.3 Infrastructure | 1 |
| | S-07 | 9.1 Eliminated by Design | 1 |
| | S-08 | 9.1 Eliminated by Design | 1 |
| | S-09 | 9.3 Infrastructure | 1 |
| | S-10 | 9.3 Infrastructure | 1 |
| HIGH (S-11 to S-19) | S-11 | 9.2 Auth Redesign | 1 |
| | S-12 | 9.2 Auth Redesign | 1 |
| | S-13 | 9.2 Auth Redesign | 1 |
| | S-14 | 9.2 Auth Redesign | 1 |
| | S-15 | 9.2 Auth Redesign | 1 |
| | S-16 | 9.2 Auth Redesign | 1 |
| | S-17 | 9.4 Framework/Library | 1 |
| | S-18 | 9.1 Eliminated by Design | 1 |
| | S-19 | 9.2 Auth Redesign | 1 |
| MEDIUM (S-20 to S-27) | S-20 | 9.4 Framework/Library | 1 |
| | S-21 | 9.2 Auth Redesign | 1 |
| | S-22 | 9.4 Framework/Library | 1 |
| | S-23 | 9.4 Framework/Library | 1 |
| | S-24 | 9.4 Framework/Library | 1 |
| | S-25 | 9.4 Framework/Library | 1 |
| | S-26 | 9.1 Eliminated by Design | 1 |
| | S-27 | 9.4 Framework/Library | 1 |
| LOW (S-28 to S-30) | S-28 | 9.4 Framework/Library | 1 |
| | S-29 | 9.2 Auth Redesign | 1 |
| | S-30 | 9.3 Infrastructure | 1 |
| **Total** | | | **30** |

**Zero gaps. Zero duplicates. All 30 vulnerabilities resolved.**

---

**Document Status:** Complete  
**Next:** `docs/design/03-api-contracts.md` (API endpoint specifications)