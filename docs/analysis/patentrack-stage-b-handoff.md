# PatenTrack Rebuild — Stage B Handoff Document

**Date:** February 8, 2026  
**Purpose:** Complete context for a new Claude session to continue the PatenTrack rebuild project from Stage B (Architecture Design).

---

## Project Overview

PatenTrack is a patent intelligence platform (owned by Uzi, CEO of PatenTrack / Executive Director of Innovation Access Initiative) spread across 7 legacy GitHub repositories under the `Synpathub` org (forked from `iLvrge`). The platform has significant technical debt and needs a ground-up redesign.

**New work repository:** `Synpathub/PatenTrack3` (clean slate — PatenTrack and PatenTrack2 were previous failed rebuild attempts)

---

## What's Done: Stage A (System Analysis) — COMPLETE ✅

9 analysis documents live in `Synpathub/PatenTrack3/docs/analysis/`:

| # | Document | Size | Key Findings |
|---|----------|------|-------------|
| 01 | `01-data-sources-and-ingestion.md` | 48KB | 17 external data sources, 16 download scripts, 17 parsers, 5+ databases, hardcoded API keys |
| 02 | `02-processing-pipelines.md` | 23KB | 10 transaction classification types, name normalization (Levenshtein), broken title detection, 8-step customer pipeline |
| 03 | `03-database-schema.md` | 28KB | 60+ tables, 9 databases + N per-customer DBs, plaintext credentials, no migrations |
| 04 | `04-api-surface.md` | 56KB | 388 endpoints across 42 route files, JWT/OAuth2/Share auth, PHP script bridge (17 scripts via exec()) |
| 05 | `05-auth-model.md` | 16KB | Command injection (CVSS 9.8), token refresh bypass, share links grant admin access, hardcoded JWT secret |
| 06a | `06a-frontend-pt-app.md` | 39KB | React 17 (EOL), Redux, MUI v5, 120+ API methods, 9 viz libraries, Axios CVE |
| 06b | `06b-frontend-pt-admin.md` | 1,802 lines | React 16.8.6, 195 Redux action types, 64KB monolithic action files, 9 admin workflows |
| 06c | `06c-frontend-pt-share.md` | ~400 lines | Copy-paste fork of PT-App (~40% dead code), 5 endpoints, hardcoded API keys in committed .env |
| 07 | `07-cross-application-summary.md` | 35KB | Complete synthesis: 6 data flows, API coverage map, 65 business rules (BR-001–BR-065), 30 security vulnerabilities, tech stack comparison, architecture recommendations |

**The cross-application summary (doc 07) is the most important input for Stage B.** It contains the complete business rule inventory, data flow maps, and architecture recommendations that should drive the redesign.

---

## Legacy Repository Map

All forked to `Synpathub` org (forked from `iLvrge`):

| Repository | Purpose | Language |
|-----------|---------|----------|
| `Synpathub/PT-API` | REST API (Express.js, 388 endpoints) | Node.js |
| `Synpathub/PT-App` | Customer dashboard (React 17) | JavaScript |
| `Synpathub/PT-Admin-Application` | Admin panel (React 16) | JavaScript |
| `Synpathub/PT-Share` | Public share viewer (React 17) | JavaScript |
| `Synpathub/uspto-data-sync` | Data ingestion + processing (PHP) | PHP |
| `Synpathub/script_patent_application_bibliographic` | Ingestion (Node.js) | Node.js |
| `Synpathub/customer-data-migrator` | Customer pipeline orchestration | PHP |

---

## Multi-Session AI Workflow

### Roles
- **Claude (in Claude.ai):** Project manager — holds big picture, drafts prompts, validates outputs, adjusts strategy
- **Uzi:** Executes prompts in GitHub Copilot, reports results
- **GitHub Copilot Agent:** Reads code in repos, produces documents/code via PRs

### Workflow Per Session
1. Claude drafts a focused prompt as a downloadable `.md` file
2. Uzi opens a **new Copilot chat** in PatenTrack3 repo
3. Uzi selects **Claude Opus 4.6** + **Ask** mode
4. Uzi shares the specified repos (varies per session)
5. Uzi pastes the prompt, waits for PR
6. Uzi reports result to Claude **WITHOUT merging**
7. Claude validates, instructs merge or corrections
8. Artifacts accumulate in `PatenTrack3/docs/` (analysis in `docs/analysis/`, design docs will go in `docs/design/`)

### Known Limitations & Workarounds
- **Agent mode** can only see repos within the same org → that's why we forked everything to Synpathub
- **Ask mode** allows multi-repo sharing and creates PRs
- **Token limits:** Copilot agent has a ~64K token context limit. Combining all 8 analysis docs exceeds this. Split large synthesis tasks or have Claude do them directly.
- **Agent stalls:** If the agent produces an empty PR or stops with "Initial plan" only, the prompt was too large → split it into smaller scopes
- **"Message too large" error:** Means the combined repo content + prompt exceeds limits → reduce the number of shared repos or split the task
- **Always check "Files changed" tab** before merging a PR — PR #2 was merged with 0 files changed (agent created a plan but never wrote files)

---

## What's Next: Stage B (Architecture Design)

The cross-application summary recommends this migration sequence:

### Phase 0: Security Hotfix (Weeks 1-2)
- Patch command injection, token refresh, share link scoping
- Remove hardcoded secrets, rotate keys
- Lock down S3 bucket

### Phase 1: Foundation (Weeks 3-8)
- Monorepo setup (NX or Turborepo)
- TypeScript + Next.js skeleton
- Unified auth service
- Database migration framework
- CI/CD pipeline

### Phase 2: Business Logic Extraction (Weeks 9-16)
- Extract 65 business rules into tested TypeScript modules
- Transaction classification, name normalization, ownership tree, broken title detection

### Phase 3: Data Layer (Weeks 17-24)
- Consolidated database schema
- Multi-tenant architecture
- Ingestion pipeline rewrite
- Data migration scripts

### Phase 4: API & Frontend (Weeks 25-36)
- New API with proper auth, rate limiting, caching
- Customer dashboard, admin panel, share viewer
- D3 visualization component

### Phase 5: Cutover (Weeks 37-40)
- Parallel run, data migration, DNS cutover

### Suggested Stage B Sessions

| Session | Topic | Output | Repos to Share |
|---------|-------|--------|----------------|
| 5 | Domain Model & Database Design | `docs/design/01-domain-model.md` | PatenTrack3 only |
| 6 | System Architecture & Data Flow | `docs/design/02-system-architecture.md` | PatenTrack3 only |
| 7 | API Contracts & Security Design | `docs/design/03-api-contracts.md` | PatenTrack3 only |
| 8 | Frontend Architecture | `docs/design/04-frontend-architecture.md` | PatenTrack3 only |
| 9 | Ingestion Pipeline Design | `docs/design/05-ingestion-pipeline.md` | PatenTrack3 only |
| 10 | Migration Strategy | `docs/design/06-migration-strategy.md` | PatenTrack3 only |

**Note:** Stage B sessions likely only need PatenTrack3 shared (they read from the analysis docs already committed there). No legacy repos needed.

---

## Key Decisions Made

1. **Clean slate rebuild** — not incremental refactoring of legacy code
2. **Single technology stack** — TypeScript/Node.js (eliminate PHP)
3. **All analysis before any code** — Stage A documents everything first
4. **Business rules are the IP** — 65 rules must be preserved exactly with test coverage
5. **Security first** — Phase 0 hotfixes before any architecture work
6. **The D3 ownership diagram is the hero feature** — must preserve exact visual behavior

---

## How to Start Stage B

1. Open a new Claude chat
2. Upload this handoff document
3. Say: "This is the handoff from Stage A of the PatenTrack rebuild. Please review and let's begin Stage B — Architecture Design. Start with Session 5: Domain Model & Database Design."
4. Claude will read the handoff, review the analysis docs (may ask you to upload key ones like doc 07), and draft the first Stage B prompt.

---

## Critical Files for Stage B Reference

If the new Claude session needs to read analysis docs, the most important ones to upload are:
1. **`07-cross-application-summary.md`** — THE key input (has everything synthesized)
2. **`03-database-schema.md`** — needed for database redesign
3. **`02-processing-pipelines.md`** — needed for business rule extraction
4. **`04-api-surface.md`** — needed for API redesign

All files available at: `https://github.com/Synpathub/PatenTrack3/tree/main/docs/analysis`
