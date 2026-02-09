# PatenTrack3 Ingestion Pipeline Design

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Complete

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Data Sources & Ingestion Schedules](#2-data-sources--ingestion-schedules)
3. [Job Queue Architecture](#3-job-queue-architecture)
4. [Source Ingestion — Stage 1](#4-source-ingestion--stage-1)
5. [Organization Pipeline — Stage 2 (8-Step DAG)](#5-organization-pipeline--stage-2-8-step-dag)
6. [Idempotency & Error Handling](#6-idempotency--error-handling)
7. [Monitoring & Observability](#7-monitoring--observability)
8. [Data Retention & Cleanup](#8-data-retention--cleanup)

---

## 1. Pipeline Overview

### 1.1 Two-Stage Architecture

The PatenTrack ingestion pipeline is a two-stage system:

**Stage 1 — Source Ingestion:** Pull raw data from external sources (USPTO, EPO, CPC) into the shared `patent_data` schema. This is global — not org-specific. Runs on cron schedules.

**Stage 2 — Organization Pipeline:** For each affected organization, process the new data through an 8-step DAG that classifies assignments, normalizes entities, builds ownership trees, detects broken titles, and computes dashboard metrics. This is per-org and triggered by Stage 1 completion.

```
Stage 1: Source Ingestion (global, scheduled)
┌──────────────────────────────────────────────────────┐
│  Assignments  │  Biblio  │  EPO  │  CPC  │  Maint.  │
│   (daily)     │ (weekly) │(daily)│(monthly)│(weekly) │
└──────┬────────┴────┬─────┴───┬───┴────┬───┴────┬────┘
       │             │         │        │        │
       ▼             ▼         ▼        ▼        ▼
  ┌─────────────────────────────────────────────────┐
  │         Shared patent_data schema (PostgreSQL)   │
  └──────────────────────┬──────────────────────────┘
                         │
                         ▼  (identify affected orgs)
Stage 2: Organization Pipeline (per-org, event-driven)
  ┌──────────────────────────────────────────────────┐
  │  classify → flag → [tree ‖ timeline]             │
  │    → broken_title → [dashboard ‖ summary]        │
  │    → generate_json                                │
  └──────────────────────────────────────────────────┘
```

### 1.2 Legacy vs New

| Aspect | Legacy | New |
|--------|--------|-----|
| Technology | PHP scripts via `exec()`, Node cron | BullMQ on Redis, TypeScript workers |
| Trigger | Cron → shell → PHP → MySQL | Cron → BullMQ job → PostgreSQL |
| Parallelism | Sequential (1 org at a time) | Parallel with concurrency controls |
| Error handling | Silent failures, no retry | Structured retries, dead-letter queue |
| Monitoring | Manual SSH log checking | BullMQ Board, Pino logs, Sentry alerts |
| Idempotency | None (duplicate rows on re-run) | `ON CONFLICT DO UPDATE` everywhere |
| File processing | Load entire 12GB XML into memory | Streaming XML parser (SAX) |
| Security | PHP bridge with `exec()` (S-01) | No shell execution, no PHP |
| Data isolation | Per-customer databases | Shared schema + RLS |

### 1.3 Worker Process

The ingestion pipeline runs in a separate worker process (`apps/worker`), not inside the Next.js application. This separation is critical:

- **Memory:** 12GB XML files need dedicated memory, not shared with web requests
- **CPU:** Classification and tree-building are CPU-intensive
- **Isolation:** A pipeline crash doesn't take down the API
- **Scaling:** Workers can scale independently on Railway

```
apps/worker/
├── src/
│   ├── index.ts                # Worker entry point, BullMQ worker setup
│   ├── queues/                 # Queue definitions
│   │   ├── ingestion.queue.ts  # Source ingestion jobs
│   │   ├── pipeline.queue.ts   # Org pipeline jobs
│   │   └── enrichment.queue.ts # Logo, domain enrichment
│   ├── processors/             # Job processors
│   │   ├── ingest/             # Stage 1 processors
│   │   │   ├── assignments.ts
│   │   │   ├── bibliographic.ts
│   │   │   ├── epo-family.ts
│   │   │   ├── cpc.ts
│   │   │   └── maintenance.ts
│   │   └── pipeline/           # Stage 2 processors (8 steps)
│   │       ├── classify.ts
│   │       ├── flag.ts
│   │       ├── tree.ts
│   │       ├── timeline.ts
│   │       ├── broken-title.ts
│   │       ├── dashboard.ts
│   │       ├── summary.ts
│   │       └── generate-json.ts
│   ├── lib/
│   │   ├── xml-parser.ts       # Streaming XML parser
│   │   ├── uspto-client.ts     # USPTO bulk data client
│   │   ├── epo-client.ts       # EPO OPS client with OAuth2
│   │   └── s3-client.ts        # S3 for file storage
│   └── cron/
│       └── scheduler.ts        # Cron schedule definitions
├── package.json
└── tsconfig.json
```

---

## 2. Data Sources & Ingestion Schedules

### 2.1 Source Summary

| Source | Data | Size | Schedule | Business Rules |
|--------|------|------|----------|---------------|
| USPTO Assignment Daily XML | Patent assignments (assignors, assignees, conveyance text) | ~50-200MB/day | Daily 02:00 UTC | BR-054 |
| USPTO Bibliographic (Grant + Application) | Title, abstract, inventors, dates, CPC | ~12GB/week (compressed) | Weekly Tuesday 04:00 UTC | BR-055 |
| EPO Open Patent Services | Patent family members | ~5-50 API calls/org | Daily 06:00 UTC (incremental) | BR-057 |
| CPC Classification Scheme | CPC code hierarchy and descriptions | ~200MB (full replacement) | Monthly 1st, 03:00 UTC | BR-056 |
| USPTO Maintenance Fee Events | Fee payments, expirations, abandonments | ~100-500MB/week | Weekly Thursday 05:00 UTC | BR-058 |
| Enrichment (RiteKit, Clearbit) | Company logos, domains | API calls on demand | Event-driven (new company added) | BR-059 |

### 2.2 Assignment Ingestion (Daily) — BR-054

**Source:** USPTO Patent Assignment Daily XML feed  
**URL:** `https://bulkdata.uspto.gov/data/patent/assignment/`  
**Format:** XML (daily delta files)  
**Size:** 50-200MB per file (compressed)

**Process:**
1. Download daily XML file from USPTO bulk data
2. Stream-parse XML using SAX parser (never load full file into memory)
3. For each assignment record:
   - Extract reel-frame ID, conveyance text, dates
   - Extract assignor/assignee names and addresses
   - Extract affected patent/application numbers
4. Upsert into `assignments`, `assignment_assignors`, `assignment_assignees`, `assignment_documents` tables
5. Track which `document_ids` (patents) were affected
6. Identify which organizations own those patents
7. Queue Stage 2 pipeline for each affected organization

**Selective Org Recomputation:** The key optimization. Instead of reprocessing all orgs daily, only orgs with new assignments are reprocessed. This is possible because we index `document_ids` → `org_id` via the `org_assets` table.

```typescript
// Pseudocode: assignment ingestion flow
async function ingestDailyAssignments(xmlUrl: string) {
  const affectedDocIds = new Set<string>();

  // Stream parse — never load 200MB into memory
  for await (const record of streamParseXml(xmlUrl)) {
    await db.transaction(async (tx) => {
      // Upsert assignment (idempotent)
      await tx.insert(assignments)
        .values(mapAssignment(record))
        .onConflictDoUpdate({ target: [assignments.rfId] });

      // Upsert assignors/assignees
      for (const assignor of record.assignors) {
        await tx.insert(assignmentAssignors)
          .values(mapAssignor(record.rfId, assignor))
          .onConflictDoUpdate({ target: [assignmentAssignors.rfId, assignmentAssignors.name] });
      }

      // Track affected documents
      for (const doc of record.documents) {
        affectedDocIds.add(doc.number);
      }
    });
  }

  // Find affected organizations
  const affectedOrgIds = await db
    .selectDistinct({ orgId: orgAssets.orgId })
    .from(orgAssets)
    .where(inArray(orgAssets.documentId, [...affectedDocIds]));

  // Queue Stage 2 for each affected org
  for (const { orgId } of affectedOrgIds) {
    await pipelineQueue.add('pipeline:org', {
      orgId,
      trigger: 'daily-assignments',
      startFromStep: 'classify',
    });
  }
}
```

### 2.3 Bibliographic Ingestion (Weekly) — BR-055

**Source:** USPTO Bulk Data — Patent Grant and Application XML  
**Format:** XML (full weekly dump, compressed)  
**Size:** ~12GB compressed, ~50GB+ uncompressed  
**Challenge:** This is the largest data source — must stream, never load into memory.

**Process:**
1. Download weekly XML dump via HTTPS streaming
2. Decompress on-the-fly (gzip stream piped to XML parser)
3. Stream-parse: for each patent grant/application record:
   - Extract bibliographic fields (title, abstract, dates, inventors)
   - Extract CPC classifications
   - Extract claims count and independent claims
4. Upsert into `patents` and `patent_classifications` tables
5. Only process patents that belong to monitored organizations (skip ~99% of records)

**Filtering optimization:** Pre-load the set of all monitored `document_ids` into a Redis set before parsing. During stream parsing, check each patent number against this set — skip immediately if not monitored. This reduces processing from 12GB to ~100MB of relevant data.

```typescript
// Streaming XML parser for 12GB bibliographic data
import { createReadStream } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import sax from 'sax';

async function ingestBibliographic(gzipUrl: string) {
  // Pre-load monitored document IDs into Redis set
  const monitoredDocs = await redis.smembers('monitored:document_ids');
  const monitoredSet = new Set(monitoredDocs);

  const httpStream = await fetchStream(gzipUrl);
  const gunzipStream = createGunzip();
  const saxParser = sax.createStream(true, { trim: true });

  let currentRecord: PatentRecord | null = null;
  let recordCount = 0;
  let processedCount = 0;

  saxParser.on('opentag', (node) => {
    if (node.name === 'us-patent-grant' || node.name === 'us-patent-application') {
      currentRecord = { fields: {}, classifications: [], inventors: [] };
    }
    // ... extract fields based on tag names
  });

  saxParser.on('closetag', async (name) => {
    if ((name === 'us-patent-grant' || name === 'us-patent-application') && currentRecord) {
      recordCount++;
      const docId = currentRecord.fields.documentNumber;

      // Skip if not monitored — this filters out ~99% of records
      if (!monitoredSet.has(docId)) {
        currentRecord = null;
        return;
      }

      processedCount++;
      await upsertPatent(currentRecord);
      currentRecord = null;

      // Report progress every 10,000 records
      if (recordCount % 10000 === 0) {
        await job.updateProgress(Math.floor((recordCount / estimatedTotal) * 100));
      }
    }
  });

  await pipeline(httpStream, gunzipStream, saxParser);

  return { totalScanned: recordCount, totalProcessed: processedCount };
}
```

### 2.4 EPO Family Data (Daily Incremental) — BR-057

**Source:** EPO Open Patent Services (OPS) REST API  
**Auth:** OAuth2 client credentials (tokens cached in Redis, 20-minute TTL)  
**Rate Limit:** 4 requests/second (EPO throttling)

**Process:**
1. For each organization with new/updated patents, fetch family data from EPO
2. Use patent application number to query EPO `/family/application/`
3. Parse response, extract family members across jurisdictions
4. Upsert into `patent_families` table
5. Rate-limit requests to stay under EPO's 4 req/sec

```typescript
// EPO OAuth2 with Redis token cache
class EpoClient {
  private tokenCacheKey = 'epo:oauth:token';

  async getToken(): Promise<string> {
    const cached = await redis.get(this.tokenCacheKey);
    if (cached) return cached;

    const response = await fetch('https://ops.epo.org/3.2/auth/accesstoken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
      // Basic auth with client_id:client_secret from secrets manager
    });

    const data = await response.json();
    await redis.set(this.tokenCacheKey, data.access_token, 'EX', 1100); // 18 min (token lasts 20)
    return data.access_token;
  }

  async getFamilyMembers(applicationNumber: string): Promise<FamilyMember[]> {
    const token = await this.getToken();
    // Rate limiting: use BullMQ rate limiter at 4/sec
    const response = await fetch(
      `https://ops.epo.org/3.2/rest-services/family/application/epodoc/${applicationNumber}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    // Parse and return family members
    return parseFamilyResponse(await response.json());
  }
}
```

### 2.5 CPC Classification (Monthly) — BR-056

**Source:** USPTO CPC Classification Data  
**Format:** XML/TSV bulk dump  
**Size:** ~200MB  
**Strategy:** Full atomic replacement (not incremental)

**Process:**
1. Download monthly CPC classification dump
2. Parse into memory (200MB is manageable)
3. Begin transaction
4. Truncate staging table `cpc_classifications_staging`
5. Bulk insert all CPC codes into staging table
6. Atomic swap: rename staging → production, old production → old
7. Drop old table
8. Invalidate Redis CPC caches (`org:*:cpc-wordcloud:*`)

```typescript
async function ingestCpcClassifications(dataUrl: string) {
  const records = await downloadAndParseCpc(dataUrl);

  await db.transaction(async (tx) => {
    // Bulk insert to staging table
    await tx.execute(sql`TRUNCATE TABLE cpc_classifications_staging`);
    for (const batch of chunk(records, 5000)) {
      await tx.insert(cpcClassificationsStaging).values(batch);
    }

    // Atomic swap
    await tx.execute(sql`ALTER TABLE cpc_classifications RENAME TO cpc_classifications_old`);
    await tx.execute(sql`ALTER TABLE cpc_classifications_staging RENAME TO cpc_classifications`);
    await tx.execute(sql`DROP TABLE IF EXISTS cpc_classifications_old`);
  });

  // Invalidate all org CPC caches
  const keys = await redis.scanAll('org:*:cpc-wordcloud:*');
  if (keys.length > 0) await redis.del(...keys);
}
```

### 2.6 Maintenance Fee Events (Weekly) — BR-058

**Source:** USPTO PAIR/PatentsView maintenance fee data  
**Format:** Bulk CSV/XML  
**Size:** 100-500MB/week

**Process:**
1. Download weekly maintenance fee dump
2. Stream-parse, extracting fee events per patent
3. Upsert into `maintenance_fee_events` table
4. Update `patents.maintenance_fee_status` (paid, due, surcharge, expired)
5. Queue dashboard refresh for affected orgs

### 2.7 Enrichment (On Demand) — BR-059

**Source:** RiteKit (logos), Clearbit (domains, company data)  
**Trigger:** New company added to org portfolio  
**Auth:** API keys from secrets manager (Infisical — fixing S-05)

**Process:**
1. Company added → enrichment job queued
2. Worker fetches logo from RiteKit
3. Worker fetches domain/metadata from Clearbit
4. Upload logo to private S3 bucket (signed URLs — fixing S-09)
5. Update company record with logo URL and enrichment data
6. Cache enrichment results for 30 days in Redis

---

## 3. Job Queue Architecture

### 3.1 BullMQ Setup

```typescript
// packages/db/src/queues.ts (shared queue definitions)
import { Queue, Worker, QueueScheduler } from 'bullmq';

const redisConnection = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};

// Stage 1: Source ingestion queues
export const ingestionQueue = new Queue('ingestion', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },  // 1min, 2min, 4min
    removeOnComplete: { age: 7 * 24 * 3600 },         // Keep 7 days
    removeOnFail: { age: 30 * 24 * 3600 },             // Keep 30 days
  },
});

// Stage 2: Org pipeline queue
export const pipelineQueue = new Queue('pipeline', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

// Stage 3: Enrichment queue (lower priority)
export const enrichmentQueue = new Queue('enrichment', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 3 * 24 * 3600 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});
```

### 3.2 Job Types

| Queue | Job Name | Trigger | Concurrency |
|-------|----------|---------|------------|
| `ingestion` | `ingest:assignments` | Cron daily 02:00 UTC | 1 (sequential) |
| `ingestion` | `ingest:bibliographic` | Cron weekly Tue 04:00 UTC | 1 |
| `ingestion` | `ingest:epo-family` | Cron daily 06:00 UTC | 1 |
| `ingestion` | `ingest:cpc` | Cron monthly 1st 03:00 UTC | 1 |
| `ingestion` | `ingest:maintenance` | Cron weekly Thu 05:00 UTC | 1 |
| `pipeline` | `pipeline:org` | Event (new assignments for org) | 5 (parallel orgs) |
| `pipeline` | `pipeline:org:rebuild` | Admin trigger (POST /admin/.../rebuild-pipeline) | 1 per org |
| `pipeline` | `pipeline:org:tree` | Admin trigger (POST /admin/.../rebuild-tree) | 1 per org |
| `enrichment` | `enrich:company` | Event (new company added) | 3 |
| `enrichment` | `enrich:logo` | Event (company needs logo) | 3 |

### 3.3 Cron Schedule Registration

```typescript
// apps/worker/src/cron/scheduler.ts
import { ingestionQueue } from '@patentrack/db/queues';

export async function registerCronJobs() {
  // Daily assignment ingestion (BR-054)
  await ingestionQueue.add('ingest:assignments', {}, {
    repeat: { pattern: '0 2 * * *' },     // 02:00 UTC daily
    jobId: 'cron:assignments',             // Prevents duplicate cron registrations
  });

  // Weekly bibliographic (BR-055)
  await ingestionQueue.add('ingest:bibliographic', {}, {
    repeat: { pattern: '0 4 * * 2' },     // 04:00 UTC Tuesday
    jobId: 'cron:bibliographic',
  });

  // Daily EPO family (BR-057)
  await ingestionQueue.add('ingest:epo-family', {}, {
    repeat: { pattern: '0 6 * * *' },     // 06:00 UTC daily
    jobId: 'cron:epo-family',
  });

  // Monthly CPC (BR-056)
  await ingestionQueue.add('ingest:cpc', {}, {
    repeat: { pattern: '0 3 1 * *' },     // 03:00 UTC 1st of month
    jobId: 'cron:cpc',
  });

  // Weekly maintenance fees (BR-058)
  await ingestionQueue.add('ingest:maintenance', {}, {
    repeat: { pattern: '0 5 * * 4' },     // 05:00 UTC Thursday
    jobId: 'cron:maintenance',
  });
}
```

### 3.4 Concurrency Control

```typescript
// Worker concurrency per queue
const ingestionWorker = new Worker('ingestion', processIngestionJob, {
  connection: redisConnection,
  concurrency: 1,                          // Only 1 ingestion job at a time
  limiter: {
    max: 1,
    duration: 1000,                        // Max 1 job per second
  },
});

const pipelineWorker = new Worker('pipeline', processPipelineJob, {
  connection: redisConnection,
  concurrency: 5,                          // 5 orgs in parallel
});

const enrichmentWorker = new Worker('enrichment', processEnrichmentJob, {
  connection: redisConnection,
  concurrency: 3,                          // 3 enrichment jobs in parallel
  limiter: {
    max: 4,
    duration: 1000,                        // 4 req/sec (EPO/API rate limits)
  },
});
```

### 3.5 Job Deduplication

Prevent duplicate pipeline runs for the same org:

```typescript
// Before queuing a pipeline job, check if one is already running
async function queueOrgPipeline(orgId: string, trigger: string) {
  const jobId = `pipeline:org:${orgId}`;

  // Check for existing active/waiting job
  const existing = await pipelineQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active' || state === 'waiting') {
      // Already queued/running — skip
      return existing;
    }
  }

  return pipelineQueue.add('pipeline:org', {
    orgId,
    trigger,
    startFromStep: 'classify',
  }, {
    jobId,                                  // Deduplication key
  });
}
```

---

## 4. Source Ingestion — Stage 1

### 4.1 Job Processor Dispatch

```typescript
// apps/worker/src/processors/ingest/index.ts
import { Job } from 'bullmq';

export async function processIngestionJob(job: Job) {
  switch (job.name) {
    case 'ingest:assignments':
      return await processAssignments(job);
    case 'ingest:bibliographic':
      return await processBibliographic(job);
    case 'ingest:epo-family':
      return await processEpoFamily(job);
    case 'ingest:cpc':
      return await processCpc(job);
    case 'ingest:maintenance':
      return await processMaintenance(job);
    default:
      throw new Error(`Unknown ingestion job: ${job.name}`);
  }
}
```

### 4.2 Streaming XML Parser

Core utility shared by assignment and bibliographic ingestion:

```typescript
// apps/worker/src/lib/xml-parser.ts
import sax from 'sax';
import { Readable, Transform } from 'node:stream';

interface XmlStreamOptions<T> {
  rootElement: string;            // e.g., 'patent-assignment' or 'us-patent-grant'
  extractRecord: (builder: RecordBuilder) => T;
}

export function createXmlRecordStream<T>(options: XmlStreamOptions<T>): Transform {
  const { rootElement, extractRecord } = options;

  let builder: RecordBuilder | null = null;
  let depth = 0;
  let currentPath: string[] = [];

  const saxParser = sax.createStream(true, { trim: true });
  const outputStream = new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      // Pass-through — records are pushed from SAX events
      callback();
    },
  });

  saxParser.on('opentag', (node) => {
    currentPath.push(node.name);
    if (node.name === rootElement) {
      builder = new RecordBuilder();
      depth = currentPath.length;
    }
    if (builder) {
      builder.pushTag(node.name, node.attributes);
    }
  });

  saxParser.on('text', (text) => {
    if (builder) builder.setText(text);
  });

  saxParser.on('closetag', (name) => {
    if (builder) builder.popTag();
    if (name === rootElement && builder) {
      const record = extractRecord(builder);
      outputStream.push(record);
      builder = null;
    }
    currentPath.pop();
  });

  // Pipe input to SAX, emit records on output stream
  saxParser.on('error', (err) => outputStream.destroy(err));
  saxParser.on('end', () => outputStream.push(null));

  // Return a stream that accepts XML input and emits parsed records
  return outputStream;
}
```

### 4.3 Assignment Record Mapping

Maps raw USPTO assignment XML to database records:

```typescript
// apps/worker/src/processors/ingest/assignments.ts
interface RawAssignmentRecord {
  rfId: string;                     // Reel-frame (e.g., "012345/0678")
  conveyanceText: string;           // Raw text (e.g., "ASSIGNMENT OF ASSIGNORS INTEREST")
  recordDate: string;
  assignors: Array<{
    name: string;
    executionDate?: string;
  }>;
  assignees: Array<{
    name: string;
    address?: string;
  }>;
  documentNumbers: Array<{
    number: string;
    type: 'patent' | 'application';
    country: string;
  }>;
}

function mapAssignment(raw: RawAssignmentRecord) {
  return {
    rfId: raw.rfId,
    conveyanceText: raw.conveyanceText,
    recordDate: new Date(raw.recordDate),
    // Conveyance type classification happens in Stage 2 (pipeline:classify)
    // Raw data is stored as-is here
  };
}
```

---

## 5. Organization Pipeline — Stage 2 (8-Step DAG)

### 5.1 Pipeline Execution Order

The org pipeline is a DAG (Directed Acyclic Graph) with parallelism at two points:

```
Step 1: classify
    │
    ▼
Step 2: flag
    │
    ├──────────┐
    ▼          ▼
Step 3: tree   Step 4: timeline    ← parallel
    │          │
    ├──────────┘
    ▼
Step 5: broken_title
    │
    ├──────────┐
    ▼          ▼
Step 6: dashboard  Step 7: summary  ← parallel
    │              │
    ├──────────────┘
    ▼
Step 8: generate_json
```

**Business Rule:** BR-060 — Pipeline must execute in this exact order with the specified parallelism.

### 5.2 Pipeline Orchestrator

```typescript
// apps/worker/src/processors/pipeline/orchestrator.ts
import { Job } from 'bullmq';

interface PipelineData {
  orgId: string;
  trigger: string;
  startFromStep: PipelineStep;
}

type PipelineStep =
  | 'classify' | 'flag' | 'tree' | 'timeline'
  | 'broken_title' | 'dashboard' | 'summary' | 'generate_json';

const STEP_ORDER: PipelineStep[] = [
  'classify', 'flag', 'tree', 'timeline',
  'broken_title', 'dashboard', 'summary', 'generate_json',
];

const PARALLEL_GROUPS: PipelineStep[][] = [
  ['classify'],
  ['flag'],
  ['tree', 'timeline'],           // Run in parallel
  ['broken_title'],
  ['dashboard', 'summary'],       // Run in parallel
  ['generate_json'],
];

export async function processOrgPipeline(job: Job<PipelineData>) {
  const { orgId, startFromStep } = job.data;
  const startIndex = STEP_ORDER.indexOf(startFromStep);

  let groupIndex = 0;
  for (const group of PARALLEL_GROUPS) {
    // Skip groups before the start step
    const groupContainsStartOrLater = group.some(
      (step) => STEP_ORDER.indexOf(step) >= startIndex
    );
    if (!groupContainsStartOrLater) {
      groupIndex++;
      continue;
    }

    // Execute steps in this group (parallel if multiple)
    const stepsToRun = group.filter(
      (step) => STEP_ORDER.indexOf(step) >= startIndex
    );

    await job.updateProgress(Math.floor((groupIndex / PARALLEL_GROUPS.length) * 100));
    await job.log(`Running steps: ${stepsToRun.join(', ')}`);

    await Promise.all(
      stepsToRun.map((step) => executeStep(orgId, step, job))
    );

    groupIndex++;
  }

  // Pipeline complete — emit SSE event
  await emitSseEvent(orgId, 'pipeline-complete', {
    orgId,
    status: 'completed',
    trigger: job.data.trigger,
  });

  // Invalidate all Redis caches for this org
  await invalidateOrgCaches(orgId);
}
```

### 5.3 Step 1 — Classify (BR-001 through BR-012)

Classifies raw conveyance text into structured types. This is the core business logic that maps free-text assignment descriptions to the 10 conveyance types.

```typescript
// apps/worker/src/processors/pipeline/classify.ts
import { packages/business-rules/classification } from '@patentrack/business-rules';

export async function executeClassifyStep(orgId: string) {
  // Get all unclassified or reclassifiable assignments for this org
  const assignments = await db
    .select()
    .from(orgAssignments)
    .where(and(
      eq(orgAssignments.orgId, orgId),
      or(
        isNull(orgAssignments.conveyanceType),
        eq(orgAssignments.needsReclassification, true),
      ),
    ));

  for (const assignment of assignments) {
    const classification = classifyConveyance(assignment.conveyanceText);

    await db
      .update(orgAssignments)
      .set({
        conveyanceType: classification.type,         // BR-001–BR-010
        isEmployerAssignment: classification.isEmployer,  // BR-002, BR-023
        needsReclassification: false,
        classifiedAt: new Date(),
      })
      .where(eq(orgAssignments.id, assignment.id));
  }
}
```

**Classification Rules (from `packages/business-rules`):**

```typescript
// packages/business-rules/src/classification.ts

interface ClassificationResult {
  type: ConveyanceType;
  isEmployer: boolean;
  confidence: number;
}

const CONVEYANCE_PATTERNS: Array<{
  type: ConveyanceType;
  patterns: RegExp[];
  rule: string;
}> = [
  {
    type: 'assignment',                    // BR-001
    patterns: [/ASSIGNMENT OF ASSIGNORS INTEREST/i, /ASSIGNMENT/i],
    rule: 'BR-001',
  },
  {
    type: 'employee',                      // BR-002
    patterns: [/EMPLOYMENT AGREEMENT/i, /EMPLOYER/i, /EMPLOYEE/i],
    rule: 'BR-002',
  },
  {
    type: 'govern',                        // BR-003
    patterns: [/GOVERNMENT INTEREST/i, /GOVERNMENT/i],
    rule: 'BR-003',
  },
  {
    type: 'merger',                        // BR-004
    patterns: [/MERGER/i, /CHANGE OF NAME.*MERGER/i],
    rule: 'BR-004',
  },
  {
    type: 'namechg',                       // BR-005
    patterns: [/CHANGE OF NAME/i, /NAME CHANGE/i],
    rule: 'BR-005',
  },
  {
    type: 'license',                       // BR-006
    patterns: [/LICENSE/i, /LICENSING/i],
    rule: 'BR-006',
  },
  {
    type: 'release',                       // BR-007
    patterns: [/RELEASE/i, /RELEASE BY SECURED PARTY/i],
    rule: 'BR-007',
  },
  {
    type: 'security',                      // BR-008
    patterns: [/SECURITY INTEREST/i, /SECURITY AGREEMENT/i],
    rule: 'BR-008',
  },
  {
    type: 'correct',                       // BR-009
    patterns: [/CORRECT/i, /CORRECTION/i, /CORRECTIVE ASSIGNMENT/i],
    rule: 'BR-009',
  },
  // BR-010: 'missing' — default when no pattern matches
];

export function classifyConveyance(text: string): ClassificationResult {
  const normalizedText = text.toUpperCase().trim();

  for (const { type, patterns } of CONVEYANCE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedText)) {
        // BR-002/BR-023: Check employer flag
        const isEmployer = type === 'employee' ||
          /EMPLOYER|EMPLOYMENT/.test(normalizedText);

        return { type, isEmployer, confidence: 1.0 };
      }
    }
  }

  // BR-010: Default to 'missing' if no classification matches
  return { type: 'missing', isEmployer: false, confidence: 0.0 };
}
```

### 5.4 Step 2 — Flag (BR-011, BR-012)

Flags assignments that need special attention:

```typescript
// packages/business-rules/src/flag.ts
export async function executeFlagStep(orgId: string) {
  // BR-011: Flag assignments where assignor === assignee (self-assignments)
  await db.execute(sql`
    UPDATE org_assignments oa
    SET flagged = true, flag_reason = 'self_assignment'
    WHERE oa.org_id = ${orgId}
      AND EXISTS (
        SELECT 1 FROM assignment_assignors ar
        JOIN assignment_assignees ae ON ar.rf_id = ae.rf_id
        WHERE ar.rf_id = oa.rf_id
          AND UPPER(TRIM(ar.name)) = UPPER(TRIM(ae.name))
      )
  `);

  // BR-012: Flag assignments with future dates
  await db.execute(sql`
    UPDATE org_assignments
    SET flagged = true, flag_reason = 'future_date'
    WHERE org_id = ${orgId}
      AND record_date > NOW()
  `);
}
```

### 5.5 Steps 3 & 4 — Tree + Timeline (Parallel)

**Tree (BR-024–BR-030):** Build the ownership tree structure for each patent in the org. This is the computation behind the "hero feature" diagram.

```typescript
// apps/worker/src/processors/pipeline/tree.ts
export async function executeTreeStep(orgId: string) {
  // Get all assets for this org
  const assets = await db
    .select()
    .from(orgAssets)
    .where(eq(orgAssets.orgId, orgId));

  for (const asset of assets) {
    const assignments = await db
      .select()
      .from(orgAssignments)
      .where(and(
        eq(orgAssignments.orgId, orgId),
        eq(orgAssignments.documentId, asset.documentId),
      ))
      .orderBy(orgAssignments.recordDate);

    // Build tree from assignments
    const tree = buildOwnershipTree(assignments);

    // Determine tree type (BR-024–BR-030)
    const treeType = determineTreeType(tree);

    // Determine tab (BR-024–BR-030 mapping)
    const tab = determineTab(treeType);

    // Assign color (BR-031)
    const color = CONVEYANCE_COLORS[tree.rootConveyanceType] || '#A0AEC0';

    // Store tree in dashboard_items
    await db.insert(dashboardItems)
      .values({
        orgId,
        assetId: asset.id,
        type: treeType,
        tab,
        color,
        treeJson: JSON.stringify(tree),
      })
      .onConflictDoUpdate({
        target: [dashboardItems.orgId, dashboardItems.assetId],
        set: { type: treeType, tab, color, treeJson: JSON.stringify(tree), updatedAt: new Date() },
      });
  }

  // Cache tree JSONs in Redis for fast API retrieval
  await cacheOrgTrees(orgId);
}
```

**Timeline (Step 4):** Compute chronological transaction timeline for the org. Runs in parallel with tree building.

```typescript
export async function executeTimelineStep(orgId: string) {
  // Aggregate timeline data from all org assignments
  // Group by date, compute daily activity counts
  // Store in timeline_entries table

  await db.execute(sql`
    INSERT INTO timeline_entries (org_id, entry_date, assignment_count, types)
    SELECT
      ${orgId},
      DATE(record_date),
      COUNT(*),
      ARRAY_AGG(DISTINCT conveyance_type)
    FROM org_assignments
    WHERE org_id = ${orgId}
    GROUP BY DATE(record_date)
    ON CONFLICT (org_id, entry_date) DO UPDATE
      SET assignment_count = EXCLUDED.assignment_count,
          types = EXCLUDED.types,
          updated_at = NOW()
  `);
}
```

### 5.6 Step 5 — Broken Title Detection (BR-032–BR-036)

This is one of PatenTrack's core value propositions: detecting patents with broken ownership chains.

```typescript
// packages/business-rules/src/broken-title.ts

export function detectBrokenTitle(
  assignments: Assignment[],
  inventors: string[],
  currentAssignee: string | null,
): BrokenTitleResult {
  // BR-032: A title is "broken" if there's no continuous chain from inventor to current owner
  // BR-033: Chain continuity = each assignee in step N must appear as assignor in step N+1
  // BR-034: Employee assignments count as chain starters (inventor → employer)
  // BR-035: Complete chain WITHOUT employee assignment at start = also broken

  if (assignments.length === 0) {
    return { isBroken: true, reason: 'no_assignments' };
  }

  // Sort by date
  const sorted = [...assignments].sort(
    (a, b) => new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime()
  );

  // Check for employee assignment as first link (BR-034)
  const firstAssignment = sorted[0];
  const hasEmployeeStart = firstAssignment.isEmployerAssignment;

  if (!hasEmployeeStart) {
    // BR-035: No employee assignment at start — check if any assignor is an inventor
    const firstAssignors = firstAssignment.assignors.map(a => a.name.toUpperCase());
    const inventorNames = inventors.map(i => i.toUpperCase());
    const inventorIsAssignor = firstAssignors.some(a =>
      inventorNames.some(inv => levenshteinDistance(a, inv) <= 3)
    );

    if (!inventorIsAssignor) {
      return {
        isBroken: true,
        reason: 'no_inventor_link',
        missingLink: {
          from: inventors[0] || 'Unknown Inventor',
          to: firstAssignment.assignors[0]?.name || 'Unknown',
        },
      };
    }
  }

  // BR-033: Check chain continuity
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentAssignees = sorted[i].assignees.map(a => a.name.toUpperCase());
    const nextAssignors = sorted[i + 1].assignors.map(a => a.name.toUpperCase());

    const hasLink = currentAssignees.some(assignee =>
      nextAssignors.some(assignor => levenshteinDistance(assignee, assignor) <= 3)
    );

    if (!hasLink) {
      return {
        isBroken: true,
        reason: 'chain_break',
        missingLink: {
          from: sorted[i].assignees[0]?.name || 'Unknown',
          to: sorted[i + 1].assignors[0]?.name || 'Unknown',
        },
        breakPoint: i + 1,
      };
    }
  }

  return { isBroken: false };
}
```

### 5.7 Steps 6 & 7 — Dashboard + Summary (Parallel)

**Dashboard (Step 6):** Compute dashboard-level metrics for the org.

```typescript
export async function executeDashboardStep(orgId: string) {
  // BR-037: Compute type breakdown (complete=0, broken=1, encumbered=18, etc.)
  // BR-038: Group activities 11,12,13,16 as activity type 5
  // BR-042: Org-level summary uses company_id=0 convention

  const metrics = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE type = 0) AS complete_chains,
      COUNT(*) FILTER (WHERE type = 1) AS broken_chains,
      COUNT(*) FILTER (WHERE type = 18) AS encumbrances,
      COUNT(*) FILTER (WHERE type = 20) AS law_firm_involved,
      COUNT(*) FILTER (WHERE type IN (30, 33, 35, 36)) AS bank_involved
    FROM dashboard_items
    WHERE org_id = ${orgId}
  `);

  // Store in summary_metrics table (BR-043)
  await db.insert(summaryMetrics)
    .values({
      orgId,
      companyId: '00000000-0000-0000-0000-000000000000',  // BR-042: org-level
      ...metrics.rows[0],
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [summaryMetrics.orgId, summaryMetrics.companyId],
      set: { ...metrics.rows[0], computedAt: new Date() },
    });
}
```

**Summary (Step 7):** Compute aggregate counts.

```typescript
export async function executeSummaryStep(orgId: string) {
  // BR-043: Summary metric fields
  const summary = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM org_assets WHERE org_id = ${orgId}) AS total_assets,
      (SELECT COUNT(*) FROM entities WHERE org_id = ${orgId}) AS total_entities,
      (SELECT COUNT(*) FROM companies WHERE org_id = ${orgId}) AS total_companies,
      (SELECT COUNT(*) FROM org_assignments WHERE org_id = ${orgId}) AS total_transactions,
      (SELECT COUNT(*) FROM org_assignments WHERE org_id = ${orgId} AND is_employer_assignment = true) AS total_employees,
      (SELECT COUNT(DISTINCT assignor_name) + COUNT(DISTINCT assignee_name)
       FROM org_assignments WHERE org_id = ${orgId}) AS total_parties
  `);

  await db.update(summaryMetrics)
    .set(summary.rows[0])
    .where(and(
      eq(summaryMetrics.orgId, orgId),
      eq(summaryMetrics.companyId, '00000000-0000-0000-0000-000000000000'),
    ));

  // Cache in Redis for <200ms dashboard loads
  await redis.set(
    `org:${orgId}:dashboard`,
    JSON.stringify(summary.rows[0]),
  );
}
```

### 5.8 Step 8 — Generate JSON

Final step: pre-compute the JSON structures served by the API for maximum performance.

```typescript
export async function executeGenerateJsonStep(orgId: string) {
  // Pre-generate diagram JSONs for each asset
  const trees = await db
    .select()
    .from(dashboardItems)
    .where(eq(dashboardItems.orgId, orgId));

  for (const tree of trees) {
    const diagramJson = buildDiagramJson(tree);

    // Cache in Redis (served directly by GET /assets/:id/diagram)
    await redis.set(
      `org:${orgId}:tree:${tree.assetId}`,
      JSON.stringify(diagramJson),
    );
  }

  // Pre-generate dashboard summary JSON
  const summary = await db
    .select()
    .from(summaryMetrics)
    .where(eq(summaryMetrics.orgId, orgId));

  await redis.set(
    `org:${orgId}:dashboard`,
    JSON.stringify(summary[0]),
  );

  // Emit SSE event — frontend will invalidate caches
  await emitSseEvent(orgId, 'dashboard-refresh', { orgId, dataType: 'all' });
}
```

---

## 6. Idempotency & Error Handling

### 6.1 Idempotent Upserts

Every database write in the pipeline uses `ON CONFLICT DO UPDATE` to be safely re-runnable:

```typescript
// Pattern used throughout the pipeline
await db.insert(targetTable)
  .values(record)
  .onConflictDoUpdate({
    target: [targetTable.naturalKey],      // e.g., rfId for assignments
    set: {
      ...updatedFields,
      updatedAt: new Date(),               // Track when last modified
    },
  });
```

**Why this matters:** If a job fails midway and is retried, the same records are simply updated (not duplicated). This is the #1 fix for the legacy system's data quality issues — the old system had no upsert logic and created duplicate rows on every re-run.

### 6.2 Retry Strategy

| Queue | Max Attempts | Backoff | Dead Letter |
|-------|-------------|---------|-------------|
| ingestion | 3 | Exponential: 1min, 2min, 4min | Yes — manual review |
| pipeline | 3 | Exponential: 30s, 60s, 120s | Yes — manual review |
| enrichment | 5 | Exponential: 10s, 20s, 40s, 80s, 160s | Yes — auto-ignore after 5 |

### 6.3 Error Classification

```typescript
// apps/worker/src/lib/error-handler.ts

enum ErrorType {
  TRANSIENT = 'transient',       // Retry: network timeout, DB connection lost
  PERMANENT = 'permanent',       // Dead letter: invalid data, schema violation
  RATE_LIMIT = 'rate_limit',     // Delay retry: API rate limited (EPO, etc.)
}

function classifyError(error: unknown): ErrorType {
  if (error instanceof NetworkError || error instanceof ConnectionError) {
    return ErrorType.TRANSIENT;
  }
  if (error instanceof RateLimitError) {
    return ErrorType.RATE_LIMIT;
  }
  if (error instanceof ValidationError || error instanceof SchemaError) {
    return ErrorType.PERMANENT;
  }
  return ErrorType.TRANSIENT;     // Default to retry
}

// In job processor:
try {
  await processStep(job);
} catch (error) {
  const errorType = classifyError(error);

  if (errorType === ErrorType.PERMANENT) {
    // Don't retry — move to dead letter queue
    await job.moveToFailed(error, false);   // token=false → no retry
  } else if (errorType === ErrorType.RATE_LIMIT) {
    // Delay retry by rate limit window
    throw error;                            // BullMQ will retry with backoff
  } else {
    // Transient — throw to trigger normal retry
    throw error;
  }
}
```

### 6.4 Pipeline Resumption

If the org pipeline fails at step 5 (broken_title), the admin can restart from that step without re-running steps 1-4:

```typescript
// POST /admin/organizations/:orgId/rebuild-pipeline
// Body: { startFromStep: 'broken_title' }

// The orchestrator skips steps before the start step
// Steps 1-4 results are still in the database (idempotent)
// Steps 5-8 recompute from the existing data
```

---

## 7. Monitoring & Observability

### 7.1 Logging

```typescript
// Structured logging with Pino (from 02-system-architecture.md Section 8)
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    job: (job: Job) => ({
      id: job.id,
      name: job.name,
      queue: job.queueName,
      attempts: job.attemptsMade,
      data: { orgId: job.data.orgId },     // Never log full data (may contain PII)
    }),
  },
});

// Usage in processors:
logger.info({ job, step: 'classify', recordCount: 150 }, 'Classification complete');
logger.error({ job, step: 'tree', error: err.message }, 'Tree building failed');
```

### 7.2 Job Progress Tracking

```typescript
// Real-time progress updates via BullMQ + SSE
async function processStep(job: Job, stepName: string) {
  await job.log(`Starting step: ${stepName}`);

  // Update progress for SSE consumers
  const stepIndex = STEP_ORDER.indexOf(stepName);
  const progress = Math.floor((stepIndex / STEP_ORDER.length) * 100);
  await job.updateProgress(progress);

  // Emit SSE event for real-time UI updates
  await emitSseEvent(job.data.orgId, 'ingestion-progress', {
    jobId: job.id,
    step: stepName,
    progress,
  });
}
```

### 7.3 Health Checks

```typescript
// Exposed via admin API: GET /admin/ingestion/status
interface IngestionHealth {
  sources: Array<{
    name: string;
    schedule: string;
    lastSuccessAt: Date | null;
    status: 'healthy' | 'stale' | 'critical';
  }>;
  activeJobs: number;
  failedJobsLast24h: number;
  queueDepth: number;
}

// Stale thresholds:
// - Assignments: stale after 36 hours (expected daily)
// - Bibliographic: stale after 10 days (expected weekly)
// - CPC: stale after 45 days (expected monthly)
```

### 7.4 Alerting

| Condition | Severity | Action |
|-----------|----------|--------|
| Source ingestion fails 3x | Critical | Slack alert, Sentry error |
| Org pipeline fails after retries | Warning | Slack alert, moves to dead letter |
| Queue depth > 50 | Warning | Slack alert — possible backlog |
| No assignment ingestion in 36 hours | Critical | Slack alert — data going stale |
| Enrichment API rate limited | Info | Log only — auto-retries handle it |

---

## 8. Data Retention & Cleanup

### 8.1 Job History Retention

| Queue | Completed Jobs | Failed Jobs |
|-------|---------------|-------------|
| ingestion | 7 days | 30 days |
| pipeline | 7 days | 30 days |
| enrichment | 3 days | 14 days |

BullMQ's `removeOnComplete` and `removeOnFail` configuration handles this automatically (configured in Section 3.1).

### 8.2 Data Retention

| Data | Retention | Rationale |
|------|-----------|-----------|
| Assignment records | Indefinite | Core business data — never delete |
| Patent bibliographic data | Indefinite | Reference data |
| Dashboard items (computed) | Until recomputed | Overwritten on each pipeline run |
| Redis caches | TTL-based (5min–30d) | Auto-expire, regenerated on miss |
| Ingestion job logs | 30 days | Sufficient for debugging |
| Pipeline progress events | 7 days | Short-lived operational data |

### 8.3 Orphan Cleanup

Periodic job to clean up orphaned data from deleted organizations:

```typescript
// Weekly cleanup job
await ingestionQueue.add('cleanup:orphans', {}, {
  repeat: { pattern: '0 0 * * 0' },       // Sunday midnight
  jobId: 'cron:cleanup',
});

async function cleanupOrphans() {
  // Find org_ids in data tables that don't exist in organizations table
  const orphanOrgIds = await db.execute(sql`
    SELECT DISTINCT oa.org_id
    FROM org_assignments oa
    LEFT JOIN organizations o ON oa.org_id = o.id
    WHERE o.id IS NULL AND o.deleted_at IS NOT NULL
  `);

  for (const { orgId } of orphanOrgIds.rows) {
    // Cascade delete all org data
    await db.delete(orgAssignments).where(eq(orgAssignments.orgId, orgId));
    await db.delete(dashboardItems).where(eq(dashboardItems.orgId, orgId));
    await db.delete(summaryMetrics).where(eq(summaryMetrics.orgId, orgId));

    // Clear Redis caches
    const keys = await redis.scanAll(`org:${orgId}:*`);
    if (keys.length > 0) await redis.del(...keys);

    logger.info({ orgId }, 'Cleaned up orphaned org data');
  }
}
```

---

## Cross-References

- **Domain Model:** `docs/design/01-domain-model.md` — All table schemas (assignments, dashboard_items, summary_metrics, entities)
- **System Architecture:** `docs/design/02-system-architecture.md` — Section 4 (Data Flows), Section 5 (Caching), Section 6 (SSE for pipeline events)
- **API Contracts:** `docs/design/03-api-contracts.md` — Section 6 (Admin endpoints for pipeline management)
- **Business Rules:** `docs/analysis/07-cross-application-summary.md` — Section 6 (BR-001–BR-012 classification, BR-013–BR-020 normalization, BR-024–BR-036 trees/broken titles, BR-037–BR-043 dashboards, BR-054–BR-060 ingestion)

---

**Document Status:** Complete  
**Next:** `docs/design/06-migration-strategy.md` (Migration strategy)
