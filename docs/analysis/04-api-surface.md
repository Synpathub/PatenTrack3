# PT-API Surface Analysis

**Repository:** /tmp/PT-API  
**Analysis Date:** December 2024  
**Total Route Files:** 40  
**Total Lines of Code:** ~37,000 (routes only)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Application Architecture](#application-architecture)
3. [Complete Endpoint Inventory](#complete-endpoint-inventory)
4. [PHP Script Execution Bridge](#php-script-execution-bridge)
5. [External Service Integrations](#external-service-integrations)
6. [Database Access Patterns](#database-access-patterns)
7. [Security Analysis](#security-analysis)
8. [WebSocket Interface](#websocket-interface)
9. [Logging & Monitoring](#logging--monitoring)
10. [Configuration & Environment](#configuration--environment)
11. [Performance Considerations](#performance-considerations)

---

## 1. Executive Summary

The PT-API is a Node.js/Express application providing REST APIs for patent management, with **388 endpoints** across three main domains:

- **Business Routes** (9 files): Authentication, admin operations, user management
- **Application Routes** (15 files): Patent data, transactions, family, events, dashboards
- **Client Routes** (16 files): Customer management, documents, integrations (Slack/Microsoft)

### Key Technologies
- **Runtime:** Node.js + Express.js 4.x
- **Database:** MySQL via Sequelize ORM (multi-tenant with dynamic connections)
- **Authentication:** JWT (jsonwebtoken) with 24-hour expiry
- **External APIs:** USPTO, EPO, PatentsView, Microsoft Graph, Slack, Google Drive/Sheets
- **File Storage:** AWS S3 (with local filesystem fallback)
- **Monitoring:** Sentry error tracking
- **Real-time:** Socket.IO for WebSocket communication

---

## 2. Application Architecture

### 2.1 Entry Point: app.js


```javascript
// Middleware Stack in app.js
app.use(cors());  // Line 51 - Allow all origins
app.use(express.json({limit: '100mb'}));  // Line 56
app.use(bodyParser.json({limit: '100mb'}));  // Line 59
app.use(upload());  // Line 62 - File upload
app.set('trust proxy', true);  // Line 63
app.use(requestLogger);  // Line 118 - Custom logger

// Route mounting (lines 183-267)
app.use("/", appLogin);
app.use("/", profile);
// ... 38 more route mounts

// Error handling (lines 275-300)
app.use((req,res,next)=> { /* 404 handler */ });
Sentry.setupExpressErrorHandler(app);
app.use((error, req, res, next)=> { /* Global error */ });
```

### 2.2 Database Connection Pool

**File:** helpers/dbConnectionCache.js

```javascript
// Connection caching per organization
const connectionCache = {};

// Pooling configuration
{
  max: 5,      // Max connections
  min: 0,      // Min connections
  acquire: 30000,  // 30s timeout
  idle: 10000      // 10s idle
}

// Cleanup job (app.js:317)
setInterval(() => {
  cleanupConnections(5 * 60 * 1000); // 5 min TTL
}, 2 * 60 * 1000); // Every 2 mins
```

---

## 3. Complete Endpoint Inventory

**Total Endpoints:** 388  
**Files Analyzed:** 42 route files  
**Coverage:** Complete - Every endpoint documented

This comprehensive inventory documents all REST API endpoints across the three main route categories.

### Documentation Legend

- **Auth Middleware:**
  - `vT` = verifyToken (JWT required)
  - `iA` = isAdmin (Admin role required)
  - `cDB` = clientDBConnection (Tenant-specific database)
- **Params:** `P` = Path, `Q` = Query, `B` = Body
- **DB:** Database tables/models accessed (abbreviated if >35 chars)

---

### Summary by Category

| Category | Endpoints | Key Functionality |
|----------|-----------|-------------------|
| Application | 93 | Patent data, transactions, families, events, dashboards |
| Business | 143 | Authentication, admin panel, customer management |
| Client | 152 | Activities, documents, integrations (Slack/Microsoft), custom data |

---

### 3.1 Application Routes (93 endpoints)

**Purpose:** Patent data, transactions, families, events, dashboards

#### 3.1.1 `assets` (22 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/assets` | vT | - | dashboard_items, Assets, db_uspto +1 |
| 2 | POST | `/assets/categories_products` | vT+cDB | - | db_uspto, db_patent_application_bibli... |
| 3 | POST | `/assets/cpc` | vT+cDB | - | Representative |
| 4 | POST | `/assets/cpc/:year/:cpcCode` | vT+cDB | P:year,cpcCode | db_new_application |
| 5 | GET | `/assets/:patentNumber/files/:channelID/sla...` | vT | P:patentNumber,channelID +1 | report_representative_assets_transact... |
| 6 | GET | `/assets/download/:itemID` | vT | P:itemID | fs, ResourceAssignments, assignment +1 |
| 7 | GET | `/assets/:asset` | vT | P:asset Q:flag | Documentids, db_patent_grant_bibliogr... |
| 8 | GET | `/assets/:patentNumber/:type/outsource` | vT | P:patentNumber,type Q:flag | Documentids, db_patent_grant_bibliogr... |
| 9 | GET | `/assets/:patentNumber/:type/outsource` | - | P:patentNumber,type Q:flag | Documentids, db_patent_grant_bibliogr... |
| 10 | POST | `/assets/move` | vT | - | assets_transfer |
| 11 | DELETE | `/assets/rollback` | vT | B:value | company, AssetsTransfer, Representati... |
| 12 | POST | `/assets/search` | vT+cDB | B:value | Assignees, RepresentativeTransactions... |
| 13 | POST | `/assets/validate` | vT | - | ResourceDocumentids |
| 14 | POST | `/assets/assets_for_sale` | vT+cDB | - | - |
| 15 | POST | `/assets/assets_for_sale` | vT+cDB | - | - |
| 16 | POST | `/assets/external_assets/sheets` | vT+cDB | - | Repository |
| 17 | POST | `/assets/external_assets/sheets/assets` | vT+cDB | - | Repository |
| 18 | POST | `/assets/external_assets/sheets/timeline` | vT | - | files, ResourceDocumentids |
| 19 | PUT | `/assets/external_assets` | vT+cDB | - | Repository, ResourceDocumentids |
| 20 | PATCH | `/assets/external_assets` | vT+cDB | - | Repository |
| 21 | DELETE | `/assets/external_assets` | vT+cDB | - | Repository |
| 22 | POST | `/assets/external_assets` | vT+cDB | - | Repository, ResourceDocumentids |

#### 3.1.2 `dashboards` (13 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/` | vT | - | dashboard_items, Dashboards, owned_as... |
| 2 | POST | `/collateral` | vT | - | dashboard_items |
| 3 | POST | `/parties/assignor` | vT+cDB | - | dashboard_items, assets, db_new_appli... |
| 4 | GET | `/parties/inventor/:inventorID` | vT | P:inventorID | db_patent_grant_bibliographic, db_pat... |
| 5 | POST | `/parties` | vT+cDB | - | - |
| 6 | POST | `/filed_assets_events` | vT | - | dashboard_items, db_patent_maintainen... |
| 7 | POST | `/timeline` | vT | - | AssignorAndAssignee |
| 8 | POST | `/count` | vT | - | dashboard_items_count |
| 9 | POST | `/example` | vT | - | dashboard_items |
| 10 | POST | `/` | vT | - | - |
| 11 | POST | `/temp` | vT | - | db_new_application |
| 12 | POST | `/share` | vT+cDB | - | Share, Representative |
| 13 | GET | `/check` | - | - | - |

#### 3.1.3 `entity` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/search/:search_string/:type` | vT | P:search_string,type | assignor_and_assignee, assignment |

#### 3.1.4 `errors` (3 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/errors` | vT+cDB | Q:companies,tabs +8 | tree_parties_collection, query, docum... |
| 2 | GET | `/errors/filters` | vT+cDB | Q:companies,tabs +3 | tree_parties_collection, documentid |
| 3 | GET | `/errors/:type/:companyName` | vT+cDB | P:type,companyName | - |

#### 3.1.5 `events` (16 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/events/tabs/:tabID` | vT+cDB | P:tabID | - |
| 2 | GET | `/events/tabs/:tabID/companies/:companyID` | vT+cDB | P:tabID,companyID | - |
| 3 | GET | `/events/tabs/:tabID/companies/:companyID/c...` | vT+cDB | P:tabID,companyID +1 | db_new_application |
| 4 | GET | `/events/tabs/:tabID/companies/:representat...` | vT+cDB | P:tabID,representativeID +2 | db_new_application |
| 5 | POST | `/events/assets` | vT+cDB | - | db_new_application, Representative |
| 6 | POST | `/events/abandoned/maintainence/assets` | vT | - | db_new_application, db_patent_maintai... |
| 7 | POST | `/events/abandoned/yearly/assets` | vT | - | db_new_application, db_uspto |
| 8 | POST | `/events/assets` | vT | - | db_new_application |
| 9 | GET | `/events/tabs` | vT | - | - |
| 10 | GET | `/events/tabs/:tabID/companies/:companyID/c...` | vT+cDB | P:tabID,companyID +3 | MaintainenceFees |
| 11 | GET | `/events/all/assets/:category_type` | vT | P:category_type | dashboard_items, db_new_application, ... |
| 12 | GET | `/events/all/assets/to_record/detail/:appli...` | vT | P:application | db_patent_grant_bibliographic, db_pat... |
| 13 | GET | `/events/:applicationNumber` | vT | P:applicationNumber | db_patent_grant_bibliographic, db_usp... |
| 14 | GET | `/events/:applicationNumber/:patentNumber` | vT | P:applicationNumber,patentNumber | db_patent_grant_bibliographic, db_usp... |
| 15 | GET | `/events/assets/status/:applicationNumber` | vT | P:applicationNumber | db_patent_grant_bibliographic, db_usp... |
| 16 | GET | `/events/assets/transactions/:rfID` | vT | P:rfID | - |

#### 3.1.6 `externalapi` (5 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/ptab/:asset` | vT | P:asset | - |
| 2 | GET | `/ptab/document/:identifier` | - | P:identifier | responseBody |
| 3 | GET | `/citation/:asset` | vT | P:asset | - |
| 4 | POST | `/citation` | vT | - | db_new_application |
| 5 | GET | `/generate_thumbnail` | - | Q:file | fileSystem |

#### 3.1.7 `family` (9 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/family/list/:grantNumber` | vT | P:grantNumber | - |
| 2 | GET | `/family/epo/grant/:grantDocNumber` | - | P:grantDocNumber | - |
| 3 | GET | `/family/:applicationNumber` | vT | P:applicationNumber | - |
| 4 | GET | `/family/abstract/:applicationNumber` | vT | P:applicationNumber | Documentid |
| 5 | GET | `/family/claims/:applicationNumber` | vT | P:applicationNumber | - |
| 6 | GET | `/family/specifications/:applicationNumber` | vT | P:applicationNumber | Documentid |
| 7 | GET | `/family/images/:applicationNumber` | vT | P:applicationNumber | Documentid |
| 8 | GET | `/family/single/file/` | - | - | - |
| 9 | GET | `/family/single/:applicationNumber` | vT | P:applicationNumber | Documentid, patent_family_member |

#### 3.1.8 `illustration` (3 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/connection/:reelFrame` | vT | P:reelFrame | db_new_application, Assignments |
| 2 | GET | `/connection/asset/:applicationNumber` | vT+cDB | P:applicationNumber | db_new_application |
| 3 | GET | `/collections/:rf_id/illustration` | vT | P:rf_id | - |

#### 3.1.9 `search` (2 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/:search_string` | vT+cDB | P:search_string | assignor, assignor_and_assignee, repr... |
| 2 | GET | `/:search_string/:type` | vT+cDB | P:search_string,type | assignor, assignor_and_assignee, repr... |

#### 3.1.10 `share` (7 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/share` | vT | - | - |
| 2 | GET | `/share/illustration/:asset/:code` | - | P:asset,code | db_new_application, db_business |
| 3 | GET | `/share/:code/:type` | - | P:code,type | db_new_application, db_business |
| 4 | GET | `/share/data/:asset/:code` | - | P:asset,code | documentid |
| 5 | GET | `/share/timeline/list/:code` | - | P:code | documentid |
| 6 | GET | `/share/dashboard/list/:code` | - | P:code Q:flag | - |
| 7 | GET | `/share/illustrate/show/:code` | - | P:code Q:flag | - |

#### 3.1.11 `svg_flag_icon` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/` | vT+cDB | - | - |

#### 3.1.12 `timelines` (7 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/` | vT+cDB | Q:companies,tabs +5 | Timelines |
| 2 | GET | `/item/:rfId` | vT | P:rfId | timeline |
| 3 | GET | `/standalone/:groupId` | cDB | P:groupId | timeline |
| 4 | GET | `/standalone/filter/:groupId/:startDate/:en...` | cDB | P:groupId,startDate +2 | getAssignmentCountData, timeline |
| 5 | GET | `/:groupId` | vT+cDB | P:groupId | timeline |
| 6 | GET | `/:organisation/:name/:depth/:groupId` | vT+cDB | P:organisation,name +2 | timeline, documentid |
| 7 | GET | `/filter/search/:groupId/:startDate/:endDat...` | vT+cDB | P:groupId,startDate +2 | timeline, assignor, assignee |

#### 3.1.13 `transactions` (2 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/transactions` | vT+cDB | Q:companies | Transactions, Assignees |
| 2 | GET | `/transactions/:transactionId` | vT | P:transactionId | Assignors, Documentids, Assignees +1 |

#### 3.1.14 `updates` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/updates/:companyName` | vT+cDB | P:companyName | Updates, representative |

#### 3.1.15 `validity` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/validity_counter` | vT+cDB | Q:companies | Validity |


### 3.2 Business Routes (143 endpoints)

**Purpose:** Authentication, admin panel, customer management

#### 3.2.1 `admin_company_search` (59 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/company/request` | vT+iA | - | ClientAddCompany, db_new_application |
| 2 | PUT | `/company/request` | vT+iA | - | ClientAddCompany, db_uspto |
| 3 | GET | `/company/representative/search/:name` | vT+iA | P:name | db_business, db_uspto |
| 4 | GET | `/company/account/search/:name` | vT+iA | P:name Q:filter | db_business |
| 5 | GET | `/company/search/all/` | vT+iA | Q:filter | - |
| 6 | GET | `/lawfirm/:ID/search/address` | vT+iA | P:ID | - |
| 7 | GET | `/company/:ID/search/address/:type` | vT+iA | P:ID,type | - |
| 8 | GET | `/company/:ID/search/address_with_transacti...` | vT+iA | P:ID,type | - |
| 9 | PUT | `/company/:ID/search/address_with_transacti...` | vT+iA | P:ID,type | - |
| 10 | POST | `/lawfirm/:ID/search/address/all` | vT+iA | P:ID | - |
| 11 | POST | `/company/:ID/search/address/all/:type` | vT+iA | P:ID,type | - |
| 12 | GET | `/company/search/:search` | vT+iA | P:search | - |
| 13 | GET | `/company/search/address/:address` | vT+iA | P:address | AssignorAndAssignee, representative |
| 14 | GET | `/company/search/country/:name` | vT+iA | P:name | representative, assignee, Representat... |
| 15 | PUT | `/company/search/all/` | vT+iA | - | - |
| 16 | GET | `/company/transactions/:id` | vT+iA+cDB | P:id B:text,rf_id +1 | body, Assignments, the +1 |
| 17 | GET | `/company/transactions/:id/:representativeID` | vT+iA+cDB | P:id,representativeID B:text,rf_... | Assignments, the, findAllAssignments +2 |
| 18 | PUT | `/company/transactions/:customerID` | vT+iA | P:customerID B:text,rf_id +1 | Assignments, assignment_conveyance, R... |
| 19 | GET | `/company/lender` | vT+iA | - | representative, assignee, assignor +2 |
| 20 | GET | `/company/lenders/:id/companies` | vT+iA | P:id | representative, assignee, assignor +2 |
| 21 | GET | `/company/:companyID/law_firms` | vT+iA | P:companyID Q:search | db_uspto |
| 22 | GET | `/company/law_firms` | vT+iA | Q:search | LawFirms, db_uspto |
| 23 | GET | `/company/law_firms/:id/normalize_lawfirms` | vT+iA | P:id | db_uspto |
| 24 | GET | `/company/law_firms/:id/companies` | vT+iA | P:id | assignment, representative, assignee +2 |
| 25 | GET | `/company/law_firms/:id` | vT+iA+cDB | P:id Q:portfolios | RepresentativeClient, AssignorAndAssi... |
| 26 | PUT | `/company/law_firms` | vT+iA+cDB | B:law_firm_ids,normalize_name +2 | LawFirms, db_uspto |
| 27 | PUT | `/company/law_firms` | vT+iA | B:law_firm_ids,normalize_name +2 | LawFirms, db_uspto |
| 28 | GET | `/company/lawyers` | vT+iA+cDB | Q:portfolios | Lawyers, helpers |
| 29 | GET | `/company/lawyers/:id` | vT+iA+cDB | P:id Q:portfolios | Assignments, helpers |
| 30 | PUT | `/company/lawyers` | vT+iA+cDB | B:normalize_name,lawyer_ids | Lawyers, RepresentativeLawyers |
| 31 | GET | `/company/raw/assignments/:id` | vT+iA+cDB | P:id Q:portfolios | Correspondence |
| 32 | PUT | `/company/raw/assignments/:id` | vT+iA+cDB | P:id Q:portfolios | Assignments |
| 33 | GET | `/company/assignments` | vT+iA | Q:portfolios | Assignments |
| 34 | GET | `/company/assignments/:id` | vT+iA+cDB | P:id Q:portfolios | Assignments |
| 35 | PUT | `/company/assignments` | vT+iA+cDB | - | Correspondence |
| 36 | PUT | `/company/:id/company_selection/` | vT+iA+cDB | P:id | data, Representative |
| 37 | POST | `/company/report_dashboard:id/` | vT+iA+cDB | P:id Q:retrievedAll | data |
| 38 | GET | `/company/family/:id` | vT+iA+cDB | P:id Q:retrievedAll | - |
| 39 | GET | `/company/family/:id/:representativeID` | vT+iA+cDB | P:id,representativeID Q:retrieve... | Representative |
| 40 | POST | `/company/:id/add_bulk_companies` | vT+iA+cDB | P:id | ClientRepresentative, Representative |
| 41 | POST | `/company/cited/:id/export` | vT+iA+cDB | P:id | RepresentativeClient, assignee_organi... |
| 42 | GET | `/company/owned/cited/:id` | vT+iA+cDB | P:id | RepresentativeClient |
| 43 | GET | `/company/cited/:id` | vT+iA+cDB | P:id | RepresentativeClient |
| 44 | PUT | `/company/cited/:id` | vT+iA | P:id | AssigneeOrganizations |
| 45 | DELETE | `/company/cited/:id` | vT+iA | P:id | AssigneeOrganizations |
| 46 | POST | `/company/cited/:id` | vT+iA | P:id | db_new_application |
| 47 | GET | `/company/saved_logo/parties/all/:id` | vT+iA+cDB | P:id | db_new_application |
| 48 | GET | `/company/parties/all/:id` | vT+iA+cDB | P:id | db_new_application |
| 49 | GET | `/company/parties/:id` | vT+iA+cDB | P:id | db_new_application, assignee_organiza... |
| 50 | PUT | `/company/assignees/query_name` | vT+iA | - | AssigneeOrganizations, assignee |
| 51 | PUT | `/company/assignees/logos` | vT+iA | - | AssigneeOrganizations |
| 52 | GET | `/all/transactions/:conveyanceType` | vT+iA | P:conveyanceType | assignment, assignee, records +3 |
| 53 | GET | `/company/assets/:entityID` | vT+iA | P:entityID | assignment, assignee, records +3 |
| 54 | GET | `/company/recent_transactions` | vT+iA | - | assignment, assignee, admin_represent... |
| 55 | GET | `/company/report` | vT+iA | - | admin_representative_reports, represe... |
| 56 | GET | `/company/:representativeID/event_maintainence` | vT+iA | P:representativeID | representative_ota_event |
| 57 | GET | `/company/:id/companies` | vT+iA | P:id | assignment, representative, assignee +3 |
| 58 | GET | `/company/auth_token` | vT+iA | - | db_new_application |
| 59 | GET | `/company/get_counter_cited_organisations_a...` | vT+iA | - | db_new_application |

#### 3.2.2 `admin_customers` (51 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `socket` | - | - | AdminAccountProcess |
| 2 | PUT | `/customers/:organisation_id/buttons` | vT+iA | P:organisation_id | AdminAccountProcess |
| 3 | GET | `/customers/:organisation_id/buttons` | vT+iA | P:organisation_id | AdminAccountProcess |
| 4 | GET | `/customers/run_query/:representative_name/...` | vT+iA | P:representative_name,query_no | - |
| 5 | GET | `/customers` | vT+iA | B:first_name,username +1 | Users, Organisations |
| 6 | GET | `/users` | vT+iA | B:password,first_name +2 | Users |
| 7 | POST | `/users` | vT+iA | B:password,first_name +2 | admin, Users |
| 8 | PUT | `/users/:user_id` | vT+iA | P:user_id B:first_name,password | Users |
| 9 | DELETE | `/users/:orgId/:user_id` | vT+iA | P:orgId,user_id | dbClientUser, userDetail, Users +1 |
| 10 | GET | `/customers/:id` | vT+iA | P:id | assignor, db_business |
| 11 | GET | `/customers/customers/:id/:type` | vT+iA+cDB | P:id,type | - |
| 12 | GET | `/customers/read_static_file/read_entity_fi...` | vT+iA | P:id,portfolios +1 | - |
| 13 | GET | `/customers/static_file/read_entity_file` | vT+iA | - | assignor |
| 14 | GET | `/customers/customers/:id/:representativeID...` | vT+iA+cDB | P:id,representativeID +1 | - |
| 15 | GET | `/customers/:id/companies` | vT+iA+cDB | P:id Q:companies B:companies | Representative |
| 16 | DELETE | `/customers/:id/companies` | vT+iA+cDB | P:id Q:companies B:companies | Representative |
| 17 | DELETE | `/customers/:id/share` | vT+iA+cDB | P:id | - |
| 18 | GET | `/customers/:id/reports` | vT+iA+cDB | P:id | LogUpdateCompany, db_uspto |
| 19 | GET | `/customers/:id/run_update_log` | vT+iA+cDB | P:id | LogUpdateCompany, db_uspto |
| 20 | DELETE | `/customers/:id/run_update_log` | vT+iA+cDB | P:id | db_new_application, LogUpdateCompany |
| 21 | GET | `/customers/:id/family` | vT+iA | P:id | db_new_application |
| 22 | GET | `/customers/:id/reclassify-log` | vT+iA | P:id | LogMessages, LogFamilyAssetsMessages,... |
| 23 | DELETE | `/customers/:id/reclassify-log` | vT+iA | P:id | LogMessages, LogFamilyAssetsMessages,... |
| 24 | DELETE | `/customers/:id/family-log` | vT+iA | P:id | db_new_application, LogFamilyAssetsMe... |
| 25 | GET | `/customers/:id/reclassify` | vT+iA | P:id | db_new_application |
| 26 | GET | `/customers/:id/users` | vT+iA+cDB | P:id B:email_address,first_name +2 | Users |
| 27 | POST | `/customers/:id/users` | vT+iA+cDB | P:id B:first_name,job_title +8 | Users, dbUser |
| 28 | PUT | `/customers/:id/users/:user_id` | vT+iA+cDB | P:id,user_id B:first_name,job_ti... | Users, dbUser |
| 29 | PUT | `/customers/:id/logo` | vT+iA | P:id B:url_customer_logo | org, URL |
| 30 | GET | `/customers/:id/libraries` | vT+iA | P:id | resources |
| 31 | GET | `/customers/:organisation_id/create_tree` | vT+iA | P:organisation_id | resources |
| 32 | POST | `/customers` | vT+iA | B:company_name,organisation_type | slack, org, Organisations |
| 33 | PUT | `/customers` | vT+iA | B:organisation_id,company_name +2 | org, assets, client +1 |
| 34 | GET | `/customers/:id/patents` | vT+iA | P:id Q:representative_id | assets |
| 35 | GET | `/customers/:organisation_id/flag_automatic` | vT+iA | P:organisation_id Q:representati... | - |
| 36 | GET | `/customers/:organisation_id/transaction_mi...` | vT+iA | P:organisation_id Q:representati... | MissingInventorProcess |
| 37 | GET | `/customers/:organisation_id/:representativ...` | vT+iA | P:organisation_id,representative_id | MissingInventorProcess |
| 38 | GET | `/customers/:organisation_id/:representativ...` | vT+iA | P:organisation_id,representative_id | 2000, MissingInventorProcess |
| 39 | GET | `/customers/:organisation_id/:representativ...` | vT+iA | P:organisation_id,representative_id | Users, resources, 2000 |
| 40 | GET | `/customers/:organisation_id/publish` | vT+iA | P:organisation_id | Users, resources, db_uspto |
| 41 | GET | `/customers/:organisation_id/address/publish` | vT+iA | P:organisation_id B:inventors,flag | helpers |
| 42 | PUT | `/customers/:id/flag_update_manually` | vT+iA+cDB | P:id B:inventors,flag | helpers, Organisations |
| 43 | DELETE | `/customers/:organisation_id` | vT+iA | P:organisation_id | Organisations |
| 44 | GET | `/patents/:asset` | vT+iA | P:asset | Documentids |
| 45 | GET | `/patents/:patentNumber/comments` | vT+iA | P:patentNumber | Documentids |
| 46 | GET | `/patents/:patentNumber/outsource` | vT+iA | P:patentNumber | Documentids, assignment |
| 47 | GET | `/patents/:patentNumber/assignments` | vT+iA | P:patentNumber | Documentids, assignment |
| 48 | GET | `/customers/retrieve_cited_patents/:customerID` | vT+iA | P:customerID | - |
| 49 | GET | `/customers/retrieve_cited_patents_domain/:...` | vT+iA | P:customerID,apiName | - |
| 50 | POST | `/customers/retrieve_cited_patents_logo` | vT+iA | - | teams |
| 51 | GET | `/customers/team/create/:customerID` | vT+iA | P:customerID | teams |

#### 3.2.3 `admin_keywords` (16 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/keywords` | vT+iA | B:keyword | a, Keywords |
| 2 | POST | `/keywords` | vT+iA | B:keyword | findRecord, a, Keywords +1 |
| 3 | PUT | `/keywords/:keywordID` | vT+iA | P:keywordID B:keyword | findRecord, Keywords, record |
| 4 | DELETE | `/keywords/:keywordID` | vT+iA | P:keywordID B:keyword | findRecord, Keywords, SuperKeywords |
| 5 | GET | `/super_keywords` | vT+iA | B:keyword | a, SuperKeywords |
| 6 | POST | `/super_keywords` | vT+iA | B:keyword | record, findRecord, a +1 |
| 7 | PUT | `/super_keywords/:keywordID` | vT+iA | P:keywordID B:keyword | findRecord, record, SuperKeywords |
| 8 | DELETE | `/super_keywords/:keywordID` | vT+iA | P:keywordID B:keyword | findRecord, SuperKeywords, State |
| 9 | GET | `/state` | vT+iA | B:keyword | a, State |
| 10 | POST | `/state` | vT+iA | B:keyword | findRecord, a, record +1 |
| 11 | PUT | `/state/:stateID` | vT+iA | P:stateID B:keyword | findRecord, record, State |
| 12 | DELETE | `/state/:stateID` | vT+iA | P:stateID B:keyword | CompanyKeywords, State |
| 13 | GET | `/company_keywords` | vT+iA | B:keyword | CompanyKeywords, a |
| 14 | POST | `/company_keywords` | vT+iA | B:keyword | findRecord, CompanyKeywords, a +1 |
| 15 | PUT | `/company_keywords/:keywordID` | vT+iA | P:keywordID B:keyword | findRecord, CompanyKeywords, record |
| 16 | DELETE | `/company_keywords/:keywordID` | vT+iA | P:keywordID | findRecord, CompanyKeywords |

#### 3.2.4 `admin_login` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/signin` | - | B:password,username | User |

#### 3.2.5 `admin_tree` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/corporate_tree` | vT+iA | - | - |

#### 3.2.6 `login` (7 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/authenticate/:code/:type` | - | P:code,type | db_business, User, ShareLinkDetails |
| 2 | POST | `/verify` | - | B:username | user, nodemailer, User |
| 3 | GET | `/verify/:code/:email` | - | P:code,email | user, User |
| 4 | POST | `/signin` | - | B:password,username | User |
| 5 | POST | `/forgot_password` | - | B:username | user, nodemailer, User |
| 6 | POST | `/update_password_via_email` | - | B:confirm_password,code +1 | user, User |
| 7 | GET | `/refresh-token` | - | - | User |

#### 3.2.7 `profile` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/profile` | vT | - | User |

#### 3.2.8 `user_activity_selection` (3 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/user_activity_selection` | vT | - | UserActivitySelection |
| 2 | POST | `/user_activity_selection` | vT | - | UserActivitySelection |
| 3 | PUT | `/user_activity_selection` | vT | - | UserActivitySelection |

#### 3.2.9 `user_company_selections` (4 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/user_company_selection` | vT | - | UserCompanySelection |
| 2 | POST | `/user_company_selection` | vT | - | UserCompanySelection |
| 3 | PUT | `/user_company_selection` | vT | - | UserCompanySelection |
| 4 | DELETE | `/user_company_selection` | vT | - | UserCompanySelection |


### 3.3 Client Routes (152 endpoints)

**Purpose:** Activities, documents, integrations (Slack/Microsoft), custom data

#### 3.3.1 `activities` (6 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/activities/` | vT+cDB | Q:count,type | query, Activity |
| 2 | GET | `/activities/:type/:option` | vT+cDB | P:type,option | Activity |
| 3 | GET | `/activities/comments/:subject_type/:subject` | vT+cDB | P:subject_type,subject | Activity |
| 4 | GET | `/activities/:ID` | vT+cDB | P:ID B:subject,professional_id +1 | Activity |
| 5 | POST | `/activities/:type` | vT+cDB | P:type B:subject,professional_id +1 | Professional |
| 6 | PUT | `/activities/:ID` | vT+cDB | P:ID B:complete | Activity |

#### 3.3.2 `address` (5 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/address` | vT+cDB | Q:companies B:street_address,rep... | Addresses, Representative |
| 2 | GET | `/address` | vT+cDB | Q:companies | Representative |
| 3 | GET | `/address/companies` | vT+cDB | Q:companies | Addresses |
| 4 | PUT | `/address/:addressID` | vT+cDB | P:addressID B:street_address,sui... | Addresses, findAddress, body |
| 5 | DELETE | `/address/:addressID` | vT+cDB | P:addressID | Addresses |

#### 3.3.3 `category_products` (5 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/` | vT+cDB | - | Category |
| 2 | GET | `/` | vT+cDB | - | Category, Product |
| 3 | GET | `/:categoryID/products` | vT+cDB | P:categoryID | Category, Product |
| 4 | DELETE | `/:categoryID` | vT+cDB | P:categoryID | Category, Product |
| 5 | DELETE | `/products/:productID` | vT+cDB | P:productID | Product |

#### 3.3.4 `charts` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/:type` | vT+cDB | P:type | assignor, documentid, assignee +1 |

#### 3.3.5 `collections` (4 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/collections` | vT+cDB | B:collection_name | Collection |
| 2 | POST | `/collections` | vT+cDB | B:companies,collection_name | AssignorAndAssignee, Collection |
| 3 | PUT | `/collections/:collection_id` | vT+cDB | P:collection_id B:companies,coll... | AssignorAndAssignee, CollectionCompan... |
| 4 | DELETE | `/collections/:collection_id` | vT+cDB | P:collection_id | CollectionCompany, Collection |

#### 3.3.6 `comments` (5 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/comments/:subjectType` | vT+cDB | P:subjectType | Type |
| 2 | GET | `/comments/:subjectType/:subject` | vT+cDB | P:subjectType,subject | - |
| 3 | POST | `/comments/:subjectType` | vT+cDB | P:subjectType B:subject,professi... | Activity, Type |
| 4 | PUT | `/comments/:ID` | vT+cDB | P:ID B:comment | Comment |
| 5 | DELETE | `/comments/:ID` | vT+cDB | P:ID | Comment |

#### 3.3.7 `company` (17 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/request` | vT | - | ClientAddCompany, if |
| 2 | GET | `/request` | vT | - | ClientAddCompany, Representative |
| 3 | GET | `/` | vT+cDB | - | Representative |
| 4 | PUT | `/:companyID` | vT+cDB | P:companyID | Representative |
| 5 | GET | `/summary` | vT+cDB | - | db_uspto, Representative |
| 6 | GET | `/:companyID/list` | vT+cDB | P:companyID | Representative |
| 7 | GET | `/:companyID/users` | vT+cDB | P:companyID | Representative |
| 8 | GET | `/list` | vT+cDB | - | Representative |
| 9 | GET | `/maintainence_assets` | vT | Q:companies | db_application, dashboard_items, main... |
| 10 | GET | `/lawfirm` | vT+cDB | Q:companies | Representative |
| 11 | POST | `/lawfirm` | vT+cDB | B:companies,lawfirms | - |
| 12 | GET | `/search/:searchName` | vT | P:searchName | Representative |
| 13 | POST | `/group` | vT+cDB | - | Representative |
| 14 | POST | `/` | vT+cDB | B:name,parent_company | ClientAddCompany, db_uspto |
| 15 | DELETE | `/` | vT+cDB | - | Representative |
| 16 | DELETE | `/subcompanies` | vT+cDB | Q:companies | RepresentativeTransactions, Represent... |
| 17 | DELETE | `/lawfirm/companyLawfirmID` | vT+cDB | - | RepresentativeLawfirm |

#### 3.3.8 `customers` (30 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/events/` | vT+cDB | Q:tab_id,portfolio | dashboard_items |
| 2 | GET | `/timeline` | vT | - | assets, db_uspto, activity_parties_tr... |
| 3 | GET | `/timeline/filling_assets` | vT+cDB | - | l, db_patent_grant_bibliographic, db_... |
| 4 | GET | `/timeline/security` | vT | - | db_uspto, activity_parties_transactions |
| 5 | GET | `/asset_types` | vT+cDB | - | TreeParties, db_uspto, activity_parti... |
| 6 | GET | `/asset_types/:tab_id/companies` | vT+cDB | P:tab_id | db_uspto, activity_parties_transactions |
| 7 | GET | `/asset_types/companies` | vT+cDB | - | TreeParties |
| 8 | GET | `/asset_types/assignments` | vT+cDB | - | assets, db_uspto, activity_parties_tr... |
| 9 | GET | `/asset_types/assignments/:rfID` | vT+cDB | P:rfID | db_new_application |
| 10 | GET | `/asset_types/assets` | vT+cDB | - | AssignorAndAssignee |
| 11 | POST | `/asset_types/assets/agents` | vT+cDB | - | db_new_application |
| 12 | POST | `/asset_types/assets/family` | vT+cDB | - | db_uspto, cwc, db_patent_application_... |
| 13 | POST | `/asset_types/inventors/location` | vT+cDB | - | db_uspto, cwc |
| 14 | GET | `/:layout/assets` | vT+cDB | P:layout | db_new_application |
| 15 | GET | `/:layout/transactions` | vT+cDB | P:layout | dashboard_items, db_uspto |
| 16 | POST | `/transactions/groupids` | vT | - | db_uspto, trans |
| 17 | GET | `/transactions/address` | vT | - | - |
| 18 | GET | `/transactions/name` | vT | - | - |
| 19 | GET | `/incorrectnames` | vT+cDB | - | Representative |
| 20 | POST | `/transactions/queues/address` | vT+cDB | - | getAddressData, Addresses, db_uspto +1 |
| 21 | POST | `/transactions/queues/name` | vT+cDB | - | db_uspto, Representative |
| 22 | GET | `/lawfirm` | vT+cDB | - | db_new_application, db_uspto |
| 23 | GET | `/lenders` | vT+cDB | - | db_new_application |
| 24 | GET | `/:layout/parties` | vT+cDB | P:layout | db_new_application, db_uspto |
| 25 | GET | `/:layout/activites` | vT+cDB | P:layout | new |
| 26 | GET | `/portfolios/` | vT+cDB | Q:limit,tab_id +2 | TreeParties |
| 27 | GET | `/:type` | vT+cDB | P:type | - |
| 28 | GET | `/:parentCompany/parties/:tabId` | vT+cDB | P:parentCompany,tabId | tree |
| 29 | GET | `/:parentCompany/:name/collections/:tabId` | vT | P:parentCompany,name +1 | assignor, assignee, assignment +1 |
| 30 | GET | `/:rf_id/assets` | vT | P:rf_id | documentid |

#### 3.3.9 `documents` (26 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/auth_token` | vT | - | - |
| 2 | GET | `/profile` | vT | - | Layouts |
| 3 | GET | `/layout` | vT | - | Layouts, Templates |
| 4 | GET | `/layout/:layout_id` | vT | P:layout_id | Layouts, Templates |
| 5 | POST | `/layout` | vT | - | Layouts |
| 6 | DELETE | `/layout` | vT | - | layout, Templates, Repository |
| 7 | GET | `/repo_folder` | vT | - | Repository |
| 8 | PUT | `/repo_folder` | vT | - | Repository |
| 9 | PUT | `/template_folder` | vT | - | Templates, Repository |
| 10 | POST | `/create_template_drive` | vT | - | Templates, Repository |
| 11 | POST | `/downloadXML` | vT | - | Assignees, Assignments, BusinessUsers |
| 12 | POST | `/fixed_transaction_address/downloadXML` | vT+cDB | - | Documentids, Assignments, Assignees +3 |
| 13 | POST | `/fixed_transaction_name/downloadXML` | vT | - | Documentids, Assignments, Assignees +2 |
| 14 | POST | `/create_maintainence_file` | vT | - | files, Repository |
| 15 | GET | `/drive` | vT | - | - |
| 16 | POST | `/product_sheet` | vT | - | - |
| 17 | POST | `/sheet` | vT | - | Repository |
| 18 | POST | `/sheet/:type/url` | vT | P:type | sheet, Repository |
| 19 | PUT | `/sheet/:type` | vT | P:type | Repository |
| 20 | POST | `/sheet/:type` | vT | P:type | Repository |
| 21 | POST | `/sheet/:type/:asset` | vT | P:type,asset | Repository |
| 22 | POST | `/transaction` | vT | - | sheetHelper |
| 23 | GET | `/` | vT+cDB | B:name,file_link | Document, User |
| 24 | POST | `/` | vT+cDB | B:name,description +1 | Document, User |
| 25 | PUT | `/:document_id` | vT+cDB | P:document_id B:file_link | Document, User |
| 26 | DELETE | `/:document_id` | vT+cDB | P:document_id | Document, User |

#### 3.3.10 `lawfirm` (4 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/lawfirm` | vT+cDB | B:name | findData, companyLawfirm |
| 2 | PUT | `/lawfirm/:lawfirmID` | vT+cDB | P:lawfirmID | findData, companyLawfirm |
| 3 | GET | `/lawfirm` | vT+cDB | Q:companies | Lawfirms |
| 4 | DELETE | `/lawfirm/:lawfirmID` | vT+cDB | P:lawfirmID | companyLawyer, companyLawfirm |

#### 3.3.11 `lawfirm_address` (5 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/lawfirm_address` | vT+cDB | B:lawfirm_id | findData, data, companyLawfirmAddresss |
| 2 | PUT | `/lawfirm_address/:lawfirmAddressID` | vT+cDB | P:lawfirmAddressID | findData, data, companyLawfirmAddresss |
| 3 | GET | `/lawfirm_address` | vT+cDB | - | companyLawfirmAddresss |
| 4 | GET | `/lawfirm_address/:lawfirmID` | vT+cDB | P:lawfirmID | companyLawfirmAddresss |
| 5 | DELETE | `/lawfirm_address/:lawfirmAddressID` | vT+cDB | P:lawfirmAddressID | companyLawfirmAddresss |

#### 3.3.12 `microsoft` (10 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/me` | vT | - | PatenTrack, Organisations |
| 2 | GET | `/team` | vT | - | PatenTrack, Organisations |
| 3 | POST | `/team` | vT | - | PatenTrack, Organisations |
| 4 | POST | `/channel/:teamID` | vT | P:teamID | - |
| 5 | GET | `/channel/:teamID/:name` | vT | P:teamID,name | - |
| 6 | GET | `/:teamId/channels/:channelId/filesFolder` | vT | P:teamId,channelId | - |
| 7 | POST | `/:teamId/channels/:channelId/messages` | vT | P:teamId,channelId | - |
| 8 | GET | `/:teamId/channels/:channelId/messages` | vT | P:teamId,channelId | - |
| 9 | GET | `/:teamId/channels` | vT | P:teamId | team |
| 10 | GET | `/:teamId/users` | vT | P:teamId | team |

#### 3.3.13 `professionals` (4 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/` | vT+cDB | B:firm_name | Firm, Professional |
| 2 | POST | `/` | vT+cDB | B:first_name,last_name +6 | Firm, Professional |
| 3 | PUT | `/:professional_id` | vT+cDB | P:professional_id B:first_name,l... | Firm, Professional |
| 4 | DELETE | `/:professional_id` | vT+cDB | P:professional_id | Professional |

#### 3.3.14 `slacks` (15 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/auth/:code` | - | P:code | Users, Organisations |
| 2 | GET | `/conversations/auth/:code` | - | P:code | - |
| 3 | GET | `/user/info/:token/:userId` | - | P:token,userId B:name | conversations, team |
| 4 | POST | `/conversations/create/:token` | - | P:token B:name | Users, conversations, team +1 |
| 5 | PUT | `/team` | vT | - | Users, Organisations |
| 6 | POST | `/conversations/message/:token` | vT+cDB | P:token | - |
| 7 | GET | `/conversations/message/:token/:channelID/:...` | - | P:token,channelID +1 | - |
| 8 | DELETE | `/conversations/message/:token/:channelID/:...` | - | P:token,channelID +1 | - |
| 9 | GET | `/conversations/history/:token/:channelID` | - | P:token,channelID | - |
| 10 | GET | `/conversations/search/assigned/:token` | - | P:token | - |
| 11 | GET | `/conversations/users/:token` | - | P:token | AssetChannel |
| 12 | GET | `/asset/:asset` | vT+cDB | P:asset | AssetChannel |
| 13 | GET | `/channels/:token` | vT+cDB | P:token | AssetChannel |
| 14 | GET | `/channels` | vT+cDB | - | AssetChannel |
| 15 | GET | `/channel/:channelID/files/:token` | - | P:channelID,token | - |

#### 3.3.15 `tabs` (5 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/:tabID` | vT+cDB | P:tabID | tree_parties_collection, TreeParties,... |
| 2 | GET | `/:tabID/companies/:companyID` | vT+cDB | P:tabID,companyID Q:limit,offset | tree_parties_collection, TreeParties,... |
| 3 | GET | `/:tabID/customers` | vT+cDB | P:tabID Q:limit,offset +1 | tree_parties_collection, TreeParties |
| 4 | GET | `/:tabID/companies/:companyID/customers/:cu...` | vT+cDB | P:tabID,companyID +1 Q:limit,offset | AssignorAndAssignee |
| 5 | GET | `/:tabID/companies/:companyID/customers/:cu...` | vT+cDB | P:tabID,companyID +2 Q:limit,offset | DocumentIds |

#### 3.3.16 `telephone` (3 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | POST | `/telephone` | vT+cDB | Q:companies B:telephone_number,r... | Telephones, Representative |
| 2 | GET | `/telephone` | vT+cDB | Q:companies | Telephones, Representative |
| 3 | DELETE | `/telephone/:telephoneID` | vT+cDB | P:telephoneID | Telephones |

#### 3.3.17 `tree` (1 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/` | vT+cDB | Q:portfolio | TreeParties |

#### 3.3.18 `users` (6 endpoints)

| # | Method | Endpoint | Auth | Key Params | Database Access |
|---|--------|----------|------|------------|-----------------|
| 1 | GET | `/` | vT+cDB | B:first_name,last_name +3 | LoginUsers, User |
| 2 | POST | `/` | vT+cDB | B:first_name,last_name +3 | LoginUsers, User |
| 3 | PUT | `/:user_id` | vT+cDB | P:user_id B:first_name,job_title +8 | LoginUsers, User |
| 4 | DELETE | `/` | vT+cDB | Q:list | Activity, client, User +1 |
| 5 | DELETE | `/:user_id` | vT+cDB | P:user_id | business, Activity, client +2 |
| 6 | POST | `/invite` | vT | - | - |



## 4. PHP Script Execution Bridge

### 4.1 Script Execution Method

**Helper:** `helpers/runPhpScript.js`

```javascript
function runPhpScript(scriptPath, args = [], waitForResult = false) {
  const command = `screen -md bash -c '${envVars} php -f ${scriptPath} ${quotedArgs}'`;
  
  if (waitForResult) {
    return execAsync(command);
  } else {
    exec(command, (err, stdout, stderr) => { /* async */ });
  }
}
```

### 4.2 All PHP Scripts with Callers

| Script | Route | HTTP Method | Args | Wait? |
|--------|-------|-------------|------|-------|
| `add_representative_rfids.php` | /companies/ | POST | [orgId, rep_ids] | Yes |
| `create_data_for_company_db_application.php` | /companies/ | POST | [orgId] | No |
| `script_create_customer_db.php` | /admin/customers | POST | [orgId] | No |
| `tree_script.php` | /admin/customers/:id/create_tree | GET | [orgId] | No |
| `update_flag.php` | /admin/customers/:id/flag_automatic | GET | [orgId] | No |
| `assets_family.php` | /admin/company/family/:id | GET | [orgId, type] | No |
| `run_add_companies_script.php` | /admin/company/:id/add_bulk_companies | POST | [orgId, companies] | Yes |
| `split_pdf_files.php` | /assets/external_assets/sheets/assets | POST | [] | Via spawn |
| `s3_upload_files.php` | /assets/external_assets/sheets/assets | POST | [] | Via spawn |
| `get_epo_thumbnail.php` | /family/single/file/ | GET | [link] | Via exec |

**⚠️ Security Risk:** Arguments passed via shell without proper escaping

### 4.3 Node Script Executions

| Script | Execution | Route | Security Note |
|--------|-----------|-------|---------------|
| `assets_family_single.js` | exec() | /family/:applicationNumber | ⚠️ Asset param in exec |
| `normalize_names.js` | exec() | /admin/customers/.../normalize | ⚠️ User params in exec |
| `retrieve_cited_patents_assignees.js` | spawn() | /admin/customers/retrieve_cited_patents/:customerID | ✅ Spawn safer |
| `name_to_domain_api.js` | spawn() | /admin/customers/retrieve_cited_patents_domain/:customerID/:apiName | ✅ Spawn safer |

---

## 5. External Service Integrations

### 5.1 Slack API

**Package:** `@slack/web-api` v6.x  
**Helper:** `helpers/slack.js`

**Authentication:**
```javascript
const web = new WebClient(process.env.SLACK_ADMIN_TOKEN);
```

**Operations Exposed:**
- Create workspace
- Create/list channels
- Send messages (with file uploads)
- User management
- Search conversations

**Routes:** `/slacks/*` (13 endpoints)

### 5.2 Microsoft Graph API

**Package:** `@microsoft/microsoft-graph-client`  
**Middleware:** `helpers/microsoftMiddelware.js`

**Authentication:**
- Custom headers: `x-microsoft-auth-token`, `x-microsoft-refresh-token`
- OAuth2 flow handled client-side

**Operations:**
- Teams management
- Channel CRUD
- Message posting
- File management

**Routes:** `/microsoft/*` (12 endpoints)

### 5.3 Google APIs

**Google Drive:**
- OAuth2 authentication
- File uploads/downloads
- Folder management

**Google Sheets:**
- Read spreadsheets
- Parse asset data
- Import timelines

**Routes:**
- `/documents/auth_token`
- `/documents/layout`
- `/assets/external_assets/sheets`

### 5.4 USPTO APIs

**PTAB API:**
- Endpoint: `GET /ptab/:asset`
- Public API (no auth)
- Returns PTAB proceedings JSON

**PatentsView API:**
- Endpoint: `GET /citation/:asset`
- Public API
- Returns citation data

### 5.5 EPO (European Patent Office)

**Helper:** `helpers/epo.js`

**Operations:**
- Family data retrieval
- Legal status queries
- Image downloads (TIFF)
- Token-based authentication

**Routes:**
- `/family/epo/grant/:grantDocNumber`
- `/family/single/file/`

### 5.6 AWS S3

**Package:** `aws-sdk`  
**Helper:** `helpers/uploadHelper.js`

**Configuration:**
```javascript
AWS.S3({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
  region: process.env.AWS_DEFAULT_REGION
})
```

**Upload Settings:**
- ACL: `public-read`
- ContentDisposition: `inline`

**Fallback:** Local filesystem if `SAVE_TO_LOCAL=true`

**Used By:**
- User avatars
- Document uploads
- Activity files
- Comment attachments

### 5.7 Sentry Error Tracking

**Package:** `@sentry/node` v10.x  
**Config:** `helpers/instrument.js`

```javascript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0
});
```

**Integration:**
- Express error handler (app.js:285)
- Manual capture on unhandled rejections
- Test route: `/debug-sentry`

---

## 6. Database Access Patterns

### 6.1 Multi-Tenant Architecture

**Shared Databases:**
- `db_business`: Users, organizations, roles (authentication)
- `db_new_application`: Patents, transactions, shares (core data)
- `db_uspto`: Raw USPTO data (read-only)
- `db_resources`: Keywords, states (reference data)

**Per-Org Databases:**
- Database name: `<org_name>_db`
- Credentials stored in `db_business.organisation` table
- Dynamic connection via `clientDBConnection` middleware

**Flow:**
```
Request → JWT → req.orgId → getOrgConnection() → Sequelize instance → req.connection_db
```

### 6.2 Key Tables

**db_business:**
- users (authentication)
- organisation (tenant metadata)
- roles (RBAC)
- user_company_selection (filters)

**db_new_application:**
- share (share links)
- share_link_details (IP tracking)
- assets (external assets)
- dashboard_items (cached data)
- errors (data quality issues)
- timelines (transaction timeline)

**db_uspto (read-only):**
- documentid (patent/application master)
- assignment (transactions)
- assignor, assignee (parties)
- assignor_and_assignee (combined view)
- representative (companies)

**Client DB (per-org):**
- tree_parties (portfolio structure)
- tree_parties_collections (asset collections)
- activities (tasks)
- comments (notes)
- documents (files)
- users (org-specific users)

---

## 7. Security Analysis

### 7.1 Authentication Flow

**Standard Login:**
1. POST /signin with username/password
2. bcrypt.compareSync() validates password
3. JWT signed with SECRET (24hr expiry)
4. Token contains: userId, orgId, org_type, subscription
5. Subsequent requests: x-auth-token header validated

**Share Link Login:**
1. GET /authenticate/:code/:type
2. Lookup code in db_new_application.share
3. Find org admin user
4. Create JWT token (bypasses password)
5. Log IP in share_link_details

### 7.2 Authorization Model

**Role-Based Access Control (RBAC):**
- Roles stored in `db_business.roles` table
- User role in `db_business.users.type`
- Admin check: `type = '9'`

**Resource-Level Authorization:**
⚠️ **MISSING** - Most endpoints don't verify resource ownership
- Example: `/assets/:asset` doesn't check if user owns asset
- Horizontal privilege escalation risk

**Middleware Stack:**
```javascript
// Most protected endpoints:
[authJWT.verifyToken, clientDBConnection.connect]

// Admin endpoints:
[authJWT.verifyToken, authJWT.isAdmin]

// Share endpoints:
// No authentication required
```

### 7.3 Critical Security Issues

| Issue | Severity | Location | Exploit |
|-------|----------|----------|---------|
| **Command Injection** | 🔴 CRITICAL | runPhpScript.js:34 | User input in exec() |
| **Code Execution** | 🔴 CRITICAL | family.js:441,1756 | Unsanitized params in exec() |
| **Missing Resource AuthZ** | 🔴 HIGH | Most endpoints | Horizontal privilege escalation |
| **CORS Allow All** | 🟡 MEDIUM | app.js:51 | CSRF attacks |
| **No Rate Limiting** | 🟡 MEDIUM | All routes | DoS, brute force |
| **Share Links Never Expire** | 🟡 MEDIUM | share.js | Permanent access if leaked |
| **Hardcoded Secret Fallback** | 🟡 MEDIUM | verifyJwtToken.js:5 | 'p@nt3nt8@60' |

### 7.4 SQL Injection Risk Assessment

**Generally Safe:**
✅ Sequelize ORM with parameterized queries  
✅ Raw queries use `:replacements` syntax  
✅ No string concatenation in SQL

**Edge Cases:**
⚠️ Dynamic table names in timelines.js (mitigated by enum validation)

**Example Safe Query:**
```javascript
// charts.js
await sequelize.query(`
  SELECT * FROM representative
  WHERE representative_name IN (:names)
`, { replacements: { names: ['A', 'B'] } });
```

### 7.5 File Upload Security

**Validation:**
```javascript
// uploadHelper.js & routes
if (mimeType.includes('.exe')) {
  return res.status(400).send("Invalid file type");
}
```

⚠️ **Insufficient:** Only blocks .exe, doesn't validate MIME type properly

**Upload Flow:**
1. File uploaded via express-fileupload
2. Stored in memory
3. Optional MIME check
4. Upload to S3 with public-read ACL
5. URL returned to client

**Risks:**
- No file size limit per file (only body limit: 100MB)
- No virus scanning
- Public-read ACL on all uploads

---

## 8. WebSocket Interface

**File:** socket.js (38 lines)

**Implementation:**
```javascript
const io = require("socket.io")(server, {
  path: '/patentrack-socket'
});

io.on("connection", (socket) => {
  console.log('Socket connection established.....');
  this.socket = socket;
});
```

**Usage:**
- Singleton pattern
- Server → Client only (emit)
- No client event listeners
- No authentication on connect
- Used for real-time notifications

**Security Issues:**
- ❌ No authentication
- ❌ No authorization
- ❌ Any client can connect
- ❌ No message validation

---

## 9. Logging & Monitoring

### 9.1 Request Logger

**File:** helpers/requestLogger.js

Logs all HTTP requests (method, path, IP, timestamp).

### 9.2 Error Logger

**File:** helpers/logErrors.js

```javascript
function logErrorToFile(error) {
  // Writes to error log file
  // Used in app.js error handlers
}
```

### 9.3 Console.log Override

**File:** app.js:4-22

```javascript
console.log = function(){
  let lines=[''];
  try {
    throw new Error('console.log called from file');
  } catch (e) {
    lines= e.stack.split('\n');
  }
  consoleLog("console.log"+lines[2]);
  consoleLog(...arguments);
}
```

⚠️ **Impact:** All console.log includes stack trace (performance overhead, log spam)

---

## 10. Configuration & Environment

**Required Environment Variables:**
```bash
# Database
HOST=<mysql_host>
USER=<mysql_user>
PASSWORD=<mysql_password>
DATABASE_RAW=db_uspto
DATABASE_APPLICATION_NEW=db_new_application
DATABASE_GRANT_BIBLIO=db_patent_grant_bibliographic
DATABASE_APPLICATION_BIBLIO=db_patent_application_bibliographic
DB_BUSINESS=db_business

# Application
PORT=4200
SECRET=<jwt_secret_minimum_32_chars>
NODE_ENV=production

# AWS
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_KEY=<secret>
AWS_DEFAULT_REGION=us-east-1
SAVE_TO_LOCAL=false  # Set true for local filesystem

# Email
EMAIL=<gmail_address>
EMAIL_APP=<gmail_app_password>

# External Services
SLACK_ADMIN_TOKEN=xoxb-...
SLACK_ADMIN_REFRESH_TOKEN=xoxe-...
SENTRY_DSN=https://...@sentry.io/...

# File Paths
SCRIPT_PATH=/var/www/html/script/
EXTRA_DISK_PATH=/data/patents/
STATIC_FILE_DISC_PATH=/var/www/html/static/
STATIC_FILES_URL=https://static.patentrack.com/
```

---

## 11. Performance Considerations

**Bottlenecks:**
- No caching layer
- Large file uploads (100MB)
- Synchronous PHP script execution
- Complex queries without indexing
- No CDN for static assets

**Connection Pooling:**
- Max 5 connections per org database
- Global shared database connections unlimited
- 2-minute cleanup interval

**Recommendations:**
- Add Redis caching
- Implement query result caching
- Use CDN for S3 assets
- Add database query optimization
- Implement connection limits globally

---

## Summary Statistics

**Total Endpoints:** 388  
**Route Files:** 40  
**Lines of Code:** ~37,000 (routes only)  
**PHP Scripts:** 17  
**Node Scripts:** 5  
**External APIs:** 7 (Slack, Microsoft, Google, AWS, USPTO, EPO, Sentry)  
**Databases:** 6 shared + N per-org  
**Authentication Methods:** 3 (JWT, Share Link, OAuth2)

---

**End of API Surface Analysis**
