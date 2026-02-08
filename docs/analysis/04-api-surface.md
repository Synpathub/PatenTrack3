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
4. [Middleware Stack](#middleware-stack)
5. [WebSocket Interface](#websocket-interface)
6. [PHP Script Execution Bridge](#php-script-execution-bridge)
7. [External Service Integrations](#external-service-integrations)
8. [Database Access Patterns](#database-access-patterns)
9. [Security Observations](#security-observations)

---

## 1. Executive Summary

The PT-API is a Node.js/Express application providing REST APIs for patent management, with **390+ endpoints** across three main domains:

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

## 3. PHP Script Execution Bridge

### 3.1 Script Execution Method

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

### 3.2 All PHP Scripts with Callers

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

### 3.3 Node Script Executions

| Script | Execution | Route | Security Note |
|--------|-----------|-------|---------------|
| `assets_family_single.js` | exec() | /family/:applicationNumber | ⚠️ Asset param in exec |
| `normalize_names.js` | exec() | /admin/customers/.../normalize | ⚠️ User params in exec |
| `retrieve_cited_patents_assignees.js` | spawn() | /admin/customers/retrieve_cited_patents/:customerID | ✅ Spawn safer |
| `name_to_domain_api.js` | spawn() | /admin/customers/retrieve_cited_patents_domain/:customerID/:apiName | ✅ Spawn safer |

---

## 4. External Service Integrations

### 4.1 Slack API

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

### 4.2 Microsoft Graph API

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

### 4.3 Google APIs

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

### 4.4 USPTO APIs

**PTAB API:**
- Endpoint: `GET /ptab/:asset`
- Public API (no auth)
- Returns PTAB proceedings JSON

**PatentsView API:**
- Endpoint: `GET /citation/:asset`
- Public API
- Returns citation data

### 4.5 EPO (European Patent Office)

**Helper:** `helpers/epo.js`

**Operations:**
- Family data retrieval
- Legal status queries
- Image downloads (TIFF)
- Token-based authentication

**Routes:**
- `/family/epo/grant/:grantDocNumber`
- `/family/single/file/`

### 4.6 AWS S3

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

### 4.7 Sentry Error Tracking

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

## 5. Database Access Patterns

### 5.1 Multi-Tenant Architecture

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

### 5.2 Key Tables

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

## 6. Security Analysis

### 6.1 Authentication Flow

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

### 6.2 Authorization Model

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

### 6.3 Critical Security Issues

| Issue | Severity | Location | Exploit |
|-------|----------|----------|---------|
| **Command Injection** | 🔴 CRITICAL | runPhpScript.js:34 | User input in exec() |
| **Code Execution** | 🔴 CRITICAL | family.js:441,1756 | Unsanitized params in exec() |
| **Missing Resource AuthZ** | 🔴 HIGH | Most endpoints | Horizontal privilege escalation |
| **CORS Allow All** | 🟡 MEDIUM | app.js:51 | CSRF attacks |
| **No Rate Limiting** | 🟡 MEDIUM | All routes | DoS, brute force |
| **Share Links Never Expire** | 🟡 MEDIUM | share.js | Permanent access if leaked |
| **Hardcoded Secret Fallback** | 🟡 MEDIUM | verifyJwtToken.js:5 | 'p@nt3nt8@60' |

### 6.4 SQL Injection Risk Assessment

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

### 6.5 File Upload Security

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

## 7. WebSocket Interface

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

## 8. Logging & Monitoring

### 8.1 Request Logger

**File:** helpers/requestLogger.js

Logs all HTTP requests (method, path, IP, timestamp).

### 8.2 Error Logger

**File:** helpers/logErrors.js

```javascript
function logErrorToFile(error) {
  // Writes to error log file
  // Used in app.js error handlers
}
```

### 8.3 Console.log Override

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

## 9. Configuration & Environment

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

## 10. Performance Considerations

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

**Total Endpoints:** 390+  
**Route Files:** 40  
**Lines of Code:** ~37,000 (routes only)  
**PHP Scripts:** 17  
**Node Scripts:** 5  
**External APIs:** 7 (Slack, Microsoft, Google, AWS, USPTO, EPO, Sentry)  
**Databases:** 6 shared + N per-org  
**Authentication Methods:** 3 (JWT, Share Link, OAuth2)

---

**End of API Surface Analysis**
