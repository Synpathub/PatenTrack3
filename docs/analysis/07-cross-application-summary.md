# PatenTrack Cross-Application Summary

**Synthesized from:** 01-data-sources-and-ingestion.md, 02-processing-pipelines.md, 03-database-schema.md, 04-api-surface.md, 05-auth-model.md, 06a-frontend-pt-app.md, 06b-frontend-pt-admin.md, 06c-frontend-pt-share.md  
**Date:** February 2026

---

## 1. Complete System Data Flows

Each data type is traced end-to-end: external source → ingestion → raw storage → processing → API → frontend.

### 1.1 Assignment/Transaction Data

```
USPTO PASDL (Daily ZIP/XML)
  ↓ daily_download.php
  ↓ update_record_daily_xml.php (parse XML)
db_uspto.assignment (rf_id, convey_text, record_dt)
db_uspto.assignor (rf_id, assignor_and_assignee_id, exec_dt)
db_uspto.assignee (rf_id, assignor_and_assignee_id, ee_name)
db_uspto.documentid (rf_id, appno_doc_num, grant_doc_num)
  ↓ update_missing_type.php (classify conveyance text → convey_ty)
db_uspto.assignment_conveyance (rf_id, convey_ty, employer_assign)
  ↓ update_flag.php (inventor-employer matching via Levenshtein)
db_uspto.representative_assignment_conveyance (employer_assign=1)
  ↓ tree.php (build ownership trees per org)
db_new_application.tree (assignor_and_assignee_id, name, parent, type, tab)
  ↓ broken_title.php (chain continuity check)
db_new_application.dashboard_items (type=0 complete, type=1 broken)
  ↓ timeline.php (chronological transaction entries)
db_new_application.timeline (rf_id, record_dt, type, convey_ty)
  ↓ generate_json.php (SVG visualization JSON)
  ↓ PT-API
GET /assets/:asset                    → PT-App (patent detail)
GET /events/tabs/:tabID               → PT-App (event tabs)
POST /dashboards/timeline             → PT-App (timeline widget)
GET /share/illustrate/show/:code      → PT-Share (public diagram)
GET /admin/customers/:id/transactions → PT-Admin (transaction review)
```

### 1.2 Bibliographic Data (Grant + Application)

```
USPTO Bulk Red Book (Weekly TAR/ZIP/XML, ~12GB/week)
  ↓ download_files.js (Node) OR patent_weekly_download.php (PHP) — REDUNDANT
  ↓ Parse XML → extract inventor, assignee, claims, classifications
db_patent_grant_bibliographic.grant_application (grant_doc_num, appno_doc_num)
db_patent_grant_bibliographic.inventor (name, city, state, country)
db_patent_grant_bibliographic.assignee_grant (name, city, country)
db_patent_application_bibliographic.inventor (name, city, country)
  ↓ normalize_file.php / normalize_names.js (suffix normalization)
  ↓ Levenshtein distance grouping (threshold 3-5)
db_uspto.assignor_and_assignee (name, representative_id)
db_uspto.representative (representative_name) — canonical names
  ↓ inventor_levenshtein.js (6 name variations per inventor)
db_inventor.inventors (assignor_and_assignee_id, canonical_name)
  ↓ PT-API
GET /parties/inventor/:inventorID     → PT-App (inventor detail)
GET /assets/:asset                    → PT-App (biblio in patent view)
POST /assets/categories_products      → PT-App (biblio cross-reference)
GET /admin/customers/:id/entities     → PT-Admin (entity normalization)
```

### 1.3 Patent Family Data (EPO)

```
EPO OPS REST API (OAuth2, per-patent queries)
  ↓ epo_api_retrieve_patent_data.php / epo.js / assets_family.js
  ↓ OAuth2 token cached to filesystem
  ↓ XML response parsing (ops:world-patent-data format)
Stored in db_new_application (family relationships)
  ↓ PT-API
GET /family/:applicationNumber        → PT-App (family tree)
GET /family/epo/grant/:grantDocNumber → PT-App (EPO data)
GET /family/list/:grantNumber         → PT-App (family list)
```

### 1.4 CPC Classification Data

```
USPTO API (Monthly ZIP/XML, full dataset)
  ↓ monthly_download_patent_cpc.php
  ↓ monthly_download_applications_cpc.php
db_uspto.patent_cpc (grant_doc_num, cpc_code, cpc_level)
db_uspto.application_cpc (appno_doc_num, cpc_code, cpc_level)
  ↓ cpc_parent_child.php (SPARQL queries to EPO Linked Data)
  ↓ Build CPC hierarchy trees
  ↓ PT-API
POST /assets/cpc                      → PT-App (CPC word cloud)
POST /assets/cpc/:year/:cpcCode       → PT-App (CPC drill-down)
```

### 1.5 Maintenance Fee Events

```
USPTO API (Weekly ZIP/tab-delimited text)
  ↓ weekly_download_maintainence_events.php
db_patent_maintainence_fee.event_maintainence_fees
  ↓ PT-API
POST /events/abandoned/maintainence/assets → PT-App (abandoned patents)
POST /events/filed_assets_events           → PT-App (fee dashboard)
GET /events/tabs/:tabID/companies/:companyID/... → PT-App (fee details)
```

### 1.6 Enrichment Data (Company Logos, Domains)

```
Clearbit API (company name → domain)
RapidAPI Google Image Search (company → logo)
RiteKit Logo API (domain → logo URL)
UpLead Company Data API (company enrichment)
PatentsView API (citations, assignee data)
  ↓ name_to_domain_api.js (ALL keys hardcoded — CRITICAL)
  ↓ logo_assignee_organisation.js
  ↓ retrieve_cited_patents_assignees.js
Various tables for logos, citations, enrichment
  ↓ PT-API
GET /assets/:patentNumber/:type/outsource → PT-App (citation data)
POST /citation                             → PT-App (citation network)
```

---

## 2. API Coverage Map

**Total API endpoints documented:** 388 (across 42 route files in PT-API)

### 2.1 Frontend Consumption

| Frontend | Endpoints Consumed | Access Pattern |
|----------|-------------------|----------------|
| PT-App (Customer Dashboard) | ~120+ API methods via `patenTrack2.js` (1,800+ lines) | JWT auth, Axios, full platform access |
| PT-Admin (Admin Panel) | ~30+ admin endpoints via `patenTrack.js` (64KB) | Admin JWT (type=9), Axios |
| PT-Share (Public Viewer) | 5 endpoints | No auth, raw `fetch()` |

### 2.2 PT-App Endpoint Usage (estimated from action files)

- **Assets group:** ~22 endpoints (asset CRUD, search, validation, external sheets)
- **Dashboards group:** ~13 endpoints (KPI, parties, timeline, counts)
- **Events group:** ~16 endpoints (event tabs, maintenance fees, abandoned)
- **Family group:** ~9 endpoints (EPO family, claims, specifications, images)
- **Charts group:** endpoints for line graphs, sanctions, timelines
- **Companies group:** company CRUD, tree operations
- **Customers group:** customer management, timeline, CPC
- **Share group:** share link creation and management
- **External API group:** PTAB, citations, thumbnails
- **Integrations:** Slack, Microsoft Teams, Google Drive/Sheets

### 2.3 PT-Admin Endpoint Usage

- `POST /signin` — admin login
- `GET /admin/customers` — list customers
- `POST /admin/customers` — create customer (triggers PHP pipeline)
- `GET /admin/customers/:id/create_tree` — rebuild ownership tree
- `POST /admin/normalize` — entity normalization
- `POST /admin/fix_items` — data quality fixes
- `GET /admin/transactions` — transaction review
- `POST /admin/validate` — validation counters
- Various comment, agreement, and settings endpoints

### 2.4 PT-Share Endpoint Usage (complete)

| Endpoint | Purpose |
|----------|---------|
| `GET /share/illustrate/show/:code` | Load illustration data + company logo |
| `GET /share/:code/:type` | Load asset list for shared org |
| `GET /share/illustration/:asset/:code` | Load diagram for specific asset |
| `GET /connection/:popuptop` | Assignment connection popup |
| `GET /assets/:asset/1/outsource` | USPTO TSDR iframe URL |

### 2.5 Estimated Dead Endpoints

Based on frontend analysis, approximately **200+ endpoints** (50%+) appear to have no active frontend consumer. Contributing factors:
- PHP script bridge endpoints (17 endpoints) called only by admin/cron, not frontends
- Duplicate/versioned endpoints (assets group has overlapping routes)
- Legacy endpoints from removed features
- Internal processing endpoints not consumed by any UI

**Note:** Some "dead" endpoints may be consumed by cron jobs, webhooks, or external integrations not visible in frontend code.

---

## 3. Technology Stack Comparison

| Aspect | PT-App | PT-Admin | PT-Share | PT-API | Ingestion (PHP) | Ingestion (Node) |
|--------|--------|----------|----------|--------|-----------------|------------------|
| **Language** | JavaScript | JavaScript | JavaScript | JavaScript | PHP | Node.js |
| **Framework** | React 17.0.2 | React 16.8.6 | React 17.0.2 | Express 4.x | Raw PHP | Raw Node.js |
| **Build Tool** | CRA 4.0.3 | CRA 3.4.4 | CRA 4.0.3 | N/A | N/A | N/A |
| **State Mgmt** | Redux + Thunk | Redux + Thunk | useState only | N/A | N/A | N/A |
| **UI Library** | MUI v5 | MUI v4 | MUI v4 | N/A | N/A | N/A |
| **HTTP Client** | Axios 0.21.1 | Axios 0.19.2 | Raw fetch() | N/A | cURL | http/https |
| **CSS** | MUI styles + styled-components | JSS + styled-components | MUI makeStyles | N/A | N/A | N/A |
| **ORM** | N/A | N/A | N/A | Sequelize | Raw MySQL (mysqli) | Raw MySQL (mysql2) |
| **Auth** | JWT + OAuth2 | JWT (admin) | None | JWT + Share + OAuth2 | N/A | N/A |
| **Real-time** | None (polling) | Pusher.js | None | Socket.IO | N/A | N/A |
| **Testing** | Libraries installed, no tests | No test infrastructure | No tests | No tests | No tests | No tests |
| **TypeScript** | No | No | No | No | N/A | No |

### Critical Version Issues

| Package | PT-App | PT-Admin | Severity |
|---------|--------|----------|----------|
| React | 17.0.2 (EOL Apr 2024) | 16.8.6 (EOL) | 🔴 CRITICAL |
| Axios | 0.21.1 (CVE-2021-3749) | 0.19.2 (CVE-2021-3749) | 🔴 CRITICAL |
| CRA | 4.0.3 (deprecated) | 3.4.4 (deprecated) | 🟡 HIGH |
| MUI | v5.4.3 | v4.11.0 | 🟡 MEDIUM |
| Redux | 4.0.5 | 4.0.5 | 🟡 LOW |

---

## 4. Code Duplication Inventory

### 4.1 PT-App → PT-Share (Wholesale Copy)

PT-Share is a **copy-paste fork** of PT-App with features disabled by emptying handler functions. ~40% of PT-Share code is dead weight.

| Copied Component | Size | Status in PT-Share |
|-----------------|------|--------------------|
| PatentrackDiagram (D3 SVG engine) | ~1,700 lines | Functional (core feature) |
| VirtualizedTable | Large | Functional but over-featured for read-only |
| AssetsCommentsTimeline | 20KB | Dead (handlers emptied) |
| QuillEditor + CustomToolbar | ~14.5KB | Dead (no comment editing in share) |
| Googlelogin component | — | Dead (no auth in share) |
| tokenStorage.js | — | Dead (Slack/Google tokens unused) |
| ConnectionBox | — | Functional |
| PdfViewer | — | Functional |
| ArrowButton | — | Functional (identical copy) |
| numbers.js (utilities) | — | Functional (identical copy) |

### 4.2 PT-App ↔ PT-Admin Shared Patterns

| Pattern | PT-App | PT-Admin | Notes |
|---------|--------|----------|-------|
| Redux structure | patenTrack + patenTrack2 reducers | auth + patenTrack reducers | Similar but different action types |
| API client class | patenTrack2.js (1,800+ lines) | patenTrack.js (64KB) | Both Axios-based, no shared code |
| Auth flow | JWT with localStorage | JWT with localStorage + cookie | Duplicated token handling |
| Split-pane layout | react-split-pane | react-split-pane | Same library, different configs |
| D3 visualizations | D3 5.16.0 | D3 5.16.0 | Same version |
| Google OAuth | react-google-login | react-google-login | Both use deprecated library |
| Event timeline | react-event-timeline | react-event-timeline | Same component |

### 4.3 Ingestion Script Duplication (PHP ↔ Node.js)

| Function | PHP Script | Node.js Script |
|----------|-----------|----------------|
| Grant download | `patent_weekly_download.php` | `download_files.js` |
| Application download | `application_weekly_download.php` | `application_download_files.js` |
| Grant XML parsing | `update_record_daily_xml.php` | Partial parsers in Node |
| EPO family retrieval | `epo_api_retrieve_patent_data.php` | `epo.js`, `assets_family.js` |
| Name normalization | `normalize_file.php` | `normalize_names.js` |

**Impact:** Same data downloaded and parsed by two languages. Unclear which is production vs. legacy.

---

## 5. Consolidated Security & Vulnerability Summary

### 5.1 CRITICAL (Immediate remediation required)

| # | Vulnerability | Location | CVSS | Impact |
|---|--------------|----------|------|--------|
| S-01 | **Command injection in PHP bridge** | PT-API `runPhpScript.js:34` | 9.8 | Remote code execution via unsanitized user input in `exec()` |
| S-02 | **Token refresh bypasses signature verification** | PT-API `login.js:324-365` | 8.1 | Payload modification → privilege escalation, cross-tenant access |
| S-03 | **Share links grant full org admin access** | PT-API `login.js:25-77` | 8.2 | Share code → admin JWT → access ALL org data, not just shared asset |
| S-04 | **Plaintext DB credentials in db_business** | `db_business.organisation.org_pass` | 8.5 | DB compromise exposes all tenant credentials |
| S-05 | **Hardcoded API keys in source code** | PT-Share `name_to_domain_api.js` | 8.0 | Clearbit, RiteKit, UpLead, Pusher production keys exposed |
| S-06 | **Hardcoded API keys in ingestion scripts** | Multiple files in both repos | 8.0 | AWS credentials (commented but visible), USPTO API keys |
| S-07 | **Axios CVE-2021-3749 (SSRF)** | PT-App `0.21.1`, PT-Admin `0.19.2` | 7.5 | Server-side request forgery |
| S-08 | **React EOL (no security patches)** | PT-App `17.0.2`, PT-Admin `16.8.6` | 7.0 | Unpatched vulnerabilities for 20+ months |
| S-09 | **Public-read-write S3 bucket** | Ingestion scripts (PDF upload) | 8.0 | Anyone can read/write/delete assignment PDFs |
| S-10 | **.env committed with OAuth credentials** | PT-Share `.env` in git | 7.0 | Slack/Google OAuth client IDs and scopes exposed |

### 5.2 HIGH

| # | Vulnerability | Location | Impact |
|---|--------------|----------|--------|
| S-11 | Missing resource-level authorization | Most PT-API endpoints | Horizontal privilege escalation across tenants |
| S-12 | JWT hardcoded secret fallback (`p@nt3nt8@60`) | PT-API `verifyJwtToken.js:5` | Token forgery if env var missing |
| S-13 | No rate limiting on any endpoint | PT-API (all routes) | Brute force, DoS |
| S-14 | No password complexity requirements | PT-API login flow | Weak password acceptance |
| S-15 | No account lockout after failed attempts | PT-API login flow | Unlimited brute force |
| S-16 | WebSocket has no authentication | PT-API `socket.js` | Any client can connect and receive events |
| S-17 | File upload only blocks `.exe` extension | PT-API upload handler | Arbitrary file upload (PHP shells, etc.) |
| S-18 | Server-side script in client repository | PT-Share `name_to_domain_api.js` | DB connection strings, server logic in public repo |
| S-19 | Dual token storage (localStorage + cookie) | PT-Admin auth | XSS → token theft; domain-wide cookie access |

### 5.3 MEDIUM

| # | Vulnerability | Location | Impact |
|---|--------------|----------|--------|
| S-20 | CORS allows all origins | PT-API `app.js:51` | CSRF attacks |
| S-21 | Share links never expire, no revocation | PT-API share system | Permanent access if link leaked |
| S-22 | Google tokens in query strings | PT-API external integrations | Tokens logged in server logs, browser history |
| S-23 | bcrypt salt factor only 8 (recommend 10-12) | PT-API password hashing | Faster brute force on stolen hashes |
| S-24 | Email verification code only 6 hex chars | PT-API verify flow | 16.7M combinations, no rate limit |
| S-25 | No CSRF protection | PT-API (all routes) | Cross-site request forgery |
| S-26 | console.log override adds stack traces | PT-API `app.js:4-22` | Performance overhead, log spam |
| S-27 | 100MB body size limit | PT-API `express.json` | Memory exhaustion |

### 5.4 LOW

| # | Vulnerability | Location | Impact |
|---|--------------|----------|--------|
| S-28 | No MFA/2FA | PT-API auth | Single-factor auth only |
| S-29 | JWT 24hr expiry, no refresh rotation | PT-API token lifecycle | Extended session hijack window |
| S-30 | Sentry DSN in environment (acceptable) | PT-API config | Low risk, properly externalized |

---

## 6. Complete Business Rule Inventory

### 6.1 Transaction Classification Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-001 | Conveyance text containing "correct" or "re-record" → type `correct` | `update_missing_type.php`, `update_record_daily_xml.php` | Yes (2 files) |
| BR-002 | Conveyance text containing "employee" or "employment" → type `employee`, set `employer_assign=1` | Same files | Yes (2 files) |
| BR-003 | Conveyance text containing "confirmator" → type `govern` | Same files | Yes (2 files) |
| BR-004 | Conveyance text containing "merger" → type `merger` | Same files | Yes (2 files) |
| BR-005 | Conveyance text containing "change of name" or "change of address" → type `namechg` | Same files | Yes (2 files) |
| BR-006 | Conveyance text containing "license" or "letters of testamentary" → type `license` | Same files | Yes (2 files) |
| BR-007 | Conveyance text containing "release" → type `release` | Same files | Yes (2 files) |
| BR-008 | Conveyance text containing "security" or "mortgage" → type `security` | Same files | Yes (2 files) |
| BR-009 | Conveyance text containing "assignment" → type `assignment` | Same files | Yes (2 files) |
| BR-010 | No match → type `missing` (default fallback) | Same files | Yes (2 files) |
| BR-011 | Lookup table match in `assignment_conveyance` overrides string matching (Phase 1 priority) | `assignment_conveyance.php` CSV import | No |
| BR-012 | Classification priority order: correct > employee > govern > merger > namechg > license > release > security > assignment > missing | `update_missing_type.php` | Partially documented |

### 6.2 Name Normalization Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-013 | Remove trailing "corporation" → append " corp" | `normalize_file.php` | No |
| BR-014 | Remove trailing "incorporated" → append " inc" | `normalize_file.php` | No |
| BR-015 | Remove trailing "limited" → append " ltd" | `normalize_file.php` | No |
| BR-016 | Remove trailing "company" → append " co" | `normalize_file.php` | No |
| BR-017 | Apply entity suffix regex for international suffixes (inc, llc, gmbh, kk, etc.) | `update_flag.php`, `update_retirved_cited_patents_assignees.js` | Yes (2 files, 2 languages) |
| BR-018 | Levenshtein distance < threshold (3-5) → group as same entity | `normalize_names.js` | No |
| BR-019 | Canonical name = name with highest occurrence count | `normalize_names.js` | No |
| BR-020 | Sort names by word count (descending) before matching | `normalize_names.js` | No |

### 6.3 Inventor Deduplication Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-021 | Generate 6 name variations per inventor (Family-Given, Given-Family, Family-Given-Middle, Given-Middle-Family, Family-only, Given-only) | `inventor_levenshtein.js`, `update_flag.php` | Yes (2 files) |
| BR-022 | Levenshtein distance < 5 for any variation → match inventor to assignor | `update_flag.php` | No |
| BR-023 | Match found → set `employer_assign=1`, `convey_ty='employee'` in both `assignment_conveyance` and `representative_assignment_conveyance` | `update_flag.php` | No |

### 6.4 Ownership Tree Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-024 | Tree type 0/1, tab 0/1: Employee assignment (employer_assign=1) | `tree.php` | No |
| BR-025 | Tree type 1, tab 1: Purchase = assignment where assignee matches org | `tree.php` | No |
| BR-026 | Tree type 2, tab 1: Sale = assignment where assignor matches org | `tree.php` | No |
| BR-027 | Tree type 3/4, tab 1: Merger in/out based on assignee/assignor match | `tree.php` | No |
| BR-028 | Tree type 5/6, tab 2: Security out/in based on assignee/assignor match | `tree.php` | No |
| BR-029 | Tree type 7/8, tab 2: Release out/in | `tree.php` | No |
| BR-030 | Tree type 9-13, tab 3: Administrative (namechg, govern, correct, missing, other) | `tree.php` | No |
| BR-031 | Visual mapping: assignment→red, namechg→blue, security→orange, release→green, license→yellow | `generate_json.php`, `tree.php` | Yes (2 files) |

### 6.5 Broken Title Chain Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-032 | Title is broken if no continuous chain from inventor to current owner | `broken_title.php` | No |
| BR-033 | Chain continuity: assignee of transaction N must equal assignor of transaction N+1 | `broken_title.php` | No |
| BR-034 | Employee assignments allowed as chain starters but don't create links | `broken_title.php` | No |
| BR-035 | Complete chain without employee start also marked broken | `broken_title.php` | No |
| BR-036 | Broken chains stored as `dashboard_items.type=1` | `broken_title.php`, `dashboard_with_company.php` | No |

### 6.6 Dashboard & Summary Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-037 | Dashboard type codes: 0=complete chain, 1=broken, 18=encumbrance, 20=law firms, 30/33/35/36=bank | `dashboard_with_company.php`, `dashboard_with_bank.php` | No |
| BR-038 | Activities 11, 12, 13, 16 are grouped as activity 5 in summaries | `summary.php` | No (undocumented) |
| BR-039 | Date filter: only include patents with `appno_date > 1999` | Multiple pipeline scripts | No (hardcoded) |
| BR-040 | Layout filter: `layout_id = 15` for standard views | Multiple scripts | No (hardcoded, meaning unclear) |
| BR-041 | Employee detection date range: 1998-2001 special handling | `summary.php` | No (undocumented) |
| BR-042 | Organization-level summary uses `company_id = 0` | `summary.php` | No |
| BR-043 | Summary metrics: companies, activities, entities, parties, employees, transactions, assets, arrows | `summary.php` | No |

### 6.7 Share & Access Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-044 | Share code generated via CUID2 (24-32 chars, cryptographically secure) | PT-API share routes | No |
| BR-045 | Share authentication returns PRIMARY ADMIN JWT for the org | PT-API `login.js:25-77` | No (VULNERABILITY) |
| BR-046 | Share links have no expiration or usage limits | PT-API share system | No (VULNERABILITY) |
| BR-047 | IP address logged in `share_link_details` on share access | PT-API share routes | No |

### 6.8 Auth & RBAC Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-048 | User type '0' or '1' = Admin (full org access) | PT-API `verifyJwtToken.js` | No |
| BR-049 | User type '9' = Super Admin (system-wide access) | PT-API `verifyJwtToken.js` | No |
| BR-050 | JWT expiry: 24 hours | PT-API `login.js:173` | No |
| BR-051 | Password hashing: bcrypt with salt factor 8 | PT-API user creation | No |
| BR-052 | Email verification code: 6 hex chars, 1-hour expiry, single use | PT-API verify flow | No |
| BR-053 | Password reset token: 40 hex chars, 1-hour expiry, single use | PT-API reset flow | No |

### 6.9 Data Ingestion Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-054 | USPTO daily assignment download: API key via `x-api-key` header | `daily_download.php` | No |
| BR-055 | Weekly grant/application download: date-based incremental (Tues grants, Thurs apps) | `patent_weekly_download.php` et al. | Yes (PHP + Node) |
| BR-056 | Monthly CPC download: full replacement dataset | `monthly_download_patent_cpc.php` | No |
| BR-057 | EPO OAuth2: client credentials flow, token cached to filesystem | `epo_class.php` | No |
| BR-058 | USPTO API retry: 429 → 1 second sleep, 5 retries max | Various download scripts | Inconsistent |
| BR-059 | Duplicate handling: `INSERT IGNORE` / `ignoreDuplicates: true` (silent skip) | Across all ingestion scripts | Yes (pervasive) |
| BR-060 | Customer pipeline execution order: classify → flag → tree → timeline → broken_title → dashboard → summary → generate_json | `create_data_for_company_db_application.php` | No |

### 6.10 Frontend-Specific Rules

| Rule ID | Rule | Implementation | Duplicated? |
|---------|------|----------------|-------------|
| BR-061 | PT-App environment modes: PRO (full), KPI, DASHBOARD, SAMPLE, SAMPLE-1, STANDARD | PT-App `routes.js` | No |
| BR-062 | PT-Admin widget routing via Redux state (`currentWidget`) not URL | PT-Admin dashboard | No |
| BR-063 | PT-Share URL pattern: last path segment = share code | PT-Share `App.js` | No |
| BR-064 | Dark mode persisted in localStorage | PT-App `useDarkMode.js` | No |
| BR-065 | Token stored in localStorage AND domain-wide cookie (`.patentrack.com`) | PT-App, PT-Admin | Yes (both apps) |

---

## 7. System-Wide Risks & Technical Debt

### 7.1 CRITICAL (Must fix before production use)

| Risk | Components | Impact |
|------|-----------|--------|
| **Remote code execution** via command injection | PT-API (15+ endpoints trigger PHP via `exec()`) | Complete system compromise |
| **Cross-tenant data access** via missing resource authorization | PT-API (most endpoints) | Any authenticated user can access any org's data |
| **Token refresh bypass** allows privilege escalation | PT-API | Attacker can forge admin tokens |
| **Share links grant admin access** to entire org | PT-API + PT-Share | Leaked share code = full org compromise |
| **Hardcoded secrets** in 6+ source files | Ingestion repos, PT-Share | All keys should be considered compromised |
| **Public S3 bucket** with read-write access | Ingestion scripts | Anyone can read/write/delete assignment PDFs |
| **No tests anywhere** in the entire system | All 7 repositories | Any change risks breaking production |
| **Plaintext tenant DB credentials** | `db_business.organisation` | Single breach exposes all tenants |

### 7.2 HIGH (Address in first design phase)

| Risk | Components | Impact |
|------|-----------|--------|
| **EOL frameworks** (React 16/17, CRA 3/4) with known CVEs | PT-App, PT-Admin, PT-Share | Unpatched security vulnerabilities |
| **Axios SSRF vulnerability** (CVE-2021-3749) | PT-App, PT-Admin | Server-side request forgery |
| **Dual PHP/Node ingestion** with unclear ownership | Ingestion repos | Which scripts are production? Maintenance burden doubled |
| **200KB+ monolithic PHP files** (`dashboard_with_company.php` ~220KB) | Processing pipelines | Impossible to test, debug, or modify safely |
| **64KB Redux action files** | PT-Admin, PT-App | Maintenance nightmare, no separation of concerns |
| **Database-per-customer with plaintext passwords** | Architecture-wide | Scaling limit, security risk, operational complexity |
| **No caching anywhere** (Redis, CDN, query cache) | PT-API, all frontends | Every request hits the database; 10-30 SQL queries per dashboard load |
| **O(n²) algorithms** for name normalization | Processing pipelines | Performance degrades quadratically with portfolio size |
| **No automated scheduling** for ingestion | Ingestion scripts | Manual intervention required for weekly/monthly downloads |

### 7.3 MEDIUM (Address in architecture design)

| Risk | Components | Impact |
|------|-----------|--------|
| **9 visualization libraries** in PT-App | PT-App | ~500KB bundle overhead, inconsistent UX |
| **4 grid/table libraries** in PT-Admin | PT-Admin | ~40KB duplication, DX confusion |
| **3 charting libraries** in PT-Admin | PT-Admin | Redundant, bundle bloat |
| **No error handling** in PT-Share | PT-Share | Invalid share codes show blank page |
| **Not mobile responsive** | PT-Share (explicit 800px min-width) | Share links unusable on mobile |
| **Widget-based routing** (no URL routing in admin) | PT-Admin | No deep linking, back button broken |
| **No schema migrations** | Database layer | Schema changes applied ad-hoc with no versioning |
| **Mixed collations** (utf8mb4 vs latin1) | Database layer | Potential encoding issues |
| **No backup/recovery strategy** documented | Database layer | Data loss risk |

### 7.4 LOW (Address during implementation)

| Risk | Components | Impact |
|------|-----------|--------|
| **No TypeScript** across entire codebase | All repos | Runtime type errors, poor IDE support |
| **Inconsistent CSS approaches** (3+ methods per app) | PT-App, PT-Admin | Developer confusion |
| **Deprecated Google libraries** (react-google-login, react-google-maps) | PT-App, PT-Admin | Will stop working when Google drops support |
| **console.log override** with stack traces | PT-API | Performance overhead |
| **No SEO/Open Graph tags** on share pages | PT-Share | Missed opportunity for social sharing |
| **~40% dead code** in PT-Share | PT-Share | Bundle size, maintenance confusion |

---

## 8. Architecture Phase Recommendations

### 8.1 Non-Negotiable Requirements for Redesign

1. **Single technology stack** — Choose one language (recommended: TypeScript/Node.js) and eliminate PHP/Node duplication
2. **Secrets management** — Zero hardcoded credentials; use AWS Secrets Manager or equivalent
3. **Resource-level authorization** — Every endpoint must verify the requesting user owns the resource
4. **Automated testing** — Unit tests for business rules, integration tests for data pipelines, E2E tests for critical paths
5. **Schema migrations** — Version-controlled, reversible database migrations
6. **Centralized authentication** — Single auth service with proper token lifecycle (rotation, revocation, scoping)
7. **Multi-tenant security** — Encrypted credentials, connection isolation, audit logging
8. **CI/CD pipeline** — Automated build, test, deploy with security scanning

### 8.2 Top 5 Priorities (Address First)

1. **Security remediation** — Fix command injection, token refresh bypass, share link scoping, remove hardcoded secrets. These are exploitable TODAY.
2. **Business rule extraction** — The 65 business rules documented above are scattered across 200KB PHP files with no tests. Extract into a tested, documented rule engine before any migration.
3. **Database consolidation** — Design a unified schema that replaces the 9-database architecture while preserving multi-tenant isolation. Migrate from plaintext credentials to encrypted secrets.
4. **API redesign** — Reduce 388 endpoints to a clean, resource-oriented API (~60-80 endpoints) with proper auth middleware, rate limiting, and input validation.
5. **Single frontend** — Replace 3 React apps (PT-App, PT-Admin, PT-Share) with one Next.js application using role-based views and shared components.

### 8.3 Key Constraints & Trade-offs

| Constraint | Trade-off |
|-----------|-----------|
| **Business rules must be preserved exactly** — Transaction classification, broken title detection, and ownership tree construction are the core IP | Extracting rules from 200KB PHP files into testable modules will be slow but is essential |
| **Existing customer data must migrate** — Database-per-customer architecture means N migrations, not one | May need to run old and new systems in parallel during transition |
| **USPTO data freshness** — Daily/weekly/monthly ingestion schedules are external constraints | New architecture must match or improve current ingestion timing |
| **No downtime migration** — Customers use the platform actively | Blue/green deployment or feature flags required |
| **Visualization fidelity** — The D3 ownership diagram is the "hero" feature (shared via PT-Share) | Must preserve exact visual behavior while modernizing the rendering code |

### 8.4 Recommended Migration Sequence

**Phase 0: Security Hotfix (Week 1-2)**
- Patch command injection (`spawn()` instead of `exec()`)
- Fix token refresh (add signature verification)
- Scope share link tokens
- Remove hardcoded secrets, rotate all keys
- Lock down S3 bucket

**Phase 1: Foundation (Weeks 3-8)**
- Set up monorepo (NX or Turborepo)
- TypeScript + Next.js skeleton
- Unified auth service (replace 3 auth implementations)
- Database migration framework (Prisma or Drizzle)
- CI/CD pipeline with security scanning

**Phase 2: Business Logic Extraction (Weeks 9-16)**
- Extract all 65 business rules into tested TypeScript modules
- Transaction classification engine with unit tests
- Name normalization service
- Ownership tree builder
- Broken title chain detector
- Each rule gets a test case derived from production data

**Phase 3: Data Layer (Weeks 17-24)**
- Consolidated database schema
- Multi-tenant architecture (shared schema with row-level security, or schema-per-tenant)
- Ingestion pipeline rewrite (single language, proper scheduling, monitoring)
- Data migration scripts with rollback capability

**Phase 4: API & Frontend (Weeks 25-36)**
- New API with resource authorization, rate limiting, caching
- Customer dashboard (replaces PT-App)
- Admin panel (replaces PT-Admin)
- Share viewer (replaces PT-Share)
- D3 visualization component (extracted, shared)

**Phase 5: Cutover (Weeks 37-40)**
- Parallel run (old + new)
- Customer data migration
- DNS cutover
- Decommission legacy systems

---

## Appendix A: Repository Map

| Repository | Purpose | Language | LOC (est.) | Status |
|-----------|---------|----------|------------|--------|
| PT-API | REST API server | Node.js/Express | ~37,000 (routes) | Active, critical security issues |
| PT-App | Customer dashboard | React 17/Redux | ~50,000+ | Active, EOL framework |
| PT-Admin-Application | Admin panel | React 16/Redux | ~30,000+ | Active, EOL framework |
| PT-Share | Public share viewer | React 17 | ~15,000 (40% dead) | Active, copy-paste fork |
| uspto-data-sync | Ingestion + processing | PHP | ~100,000+ | Active, monolithic |
| script_patent_application_bibliographic | Ingestion (Node) | Node.js | ~10,000+ | Unclear if active |
| customer-data-migrator | Customer pipeline orchestration | PHP | ~5,000+ | Active |

## Appendix B: Database Map

| Database | Purpose | Tables (est.) | Volume |
|----------|---------|---------------|--------|
| `db_uspto` | Core patent assignment data | 15+ | 50M+ assignments, 200M+ document IDs |
| `db_business` | Organization/user management | 5+ | Hundreds of orgs |
| `db_new_application` | Shared application data, dashboards, trees | 15+ | 1M+ assets |
| `db_patent_grant_bibliographic` | Grant bibliographic data | 10+ | 30M+ inventors |
| `db_patent_application_bibliographic` | Application bibliographic data | 10+ | 40M+ inventors |
| `db_patent_maintainence_fee` | Maintenance fee events | 1+ | Millions of events |
| `db_inventor` | Inventor deduplication (separate host) | 1+ | Millions |
| `big_data` | Secondary/archive | Unknown | Unknown |
| `db_{orgId}{uniqid}` (× N) | Per-customer isolated data | 20+ each | Varies (1-10K records each) |

## Appendix C: Key Metrics

| Metric | Value |
|--------|-------|
| Total API endpoints | 388 |
| Total external data sources | 17 |
| Total databases | 9 shared + N per-customer |
| Total business rules identified | 65 |
| Total security vulnerabilities | 30 (10 critical, 9 high, 8 medium, 3 low) |
| Estimated dead code | 40% of PT-Share, significant in ingestion repos |
| Total ingestion scripts | 16 download + 17 parsers (across 2 languages) |
| Processing pipeline steps | 8 (sequential, per-customer) |
| Test coverage | 0% (no tests in any repository) |

---

**Document Status:** Complete synthesis of Stage A analysis  
**Next Step:** Stage B — Architecture Design (starting with domain model and database design)
