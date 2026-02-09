# PatenTrack3 System Architecture

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Draft — Part A (Sections 1–4)

> **⚠️ Part A Only** — This document covers Sections 1 through 4. Sections 5–9 (Caching Strategy, API Design, Frontend Architecture, Deployment & Infrastructure, Testing Strategy) will be added in a follow-up session (Part B).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Redesign](#2-data-flow-redesign)
3. [Authentication & Authorization Architecture](#3-authentication--authorization-architecture)
4. [Ingestion Pipeline Architecture](#4-ingestion-pipeline-architecture)
5. _(Part B)_ Caching & Performance Strategy
6. _(Part B)_ API Design
7. _(Part B)_ Frontend Architecture
8. _(Part B)_ Deployment & Infrastructure
9. _(Part B)_ Testing Strategy

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

## Cross-References

- **Domain Model:** See `docs/design/01-domain-model.md` for complete schema design, RLS policies, migration path, and business rule preservation matrix.
- **Stage A Analysis:** See `docs/analysis/07-cross-application-summary.md` for legacy system analysis, all 65 business rules, and 30 security vulnerabilities.
- **Part B (Sections 5-9):** Will cover caching strategy, API design, frontend architecture, deployment & infrastructure, and testing strategy.

---

**Document Status:** Part A complete (Sections 1-4)  
**Next:** Part B — Sections 5-9 (Caching, API Design, Frontend, Deployment, Testing)