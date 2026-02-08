# PatenTrack Database Schema Analysis

This document provides detailed analysis of the database architecture in the PatenTrack system. It builds upon [Session 1: Data Sources & Ingestion](./01-data-sources-and-ingestion.md) and [Session 2: Processing Pipelines](./02-processing-pipelines.md).

---

## 1. Database Inventory

The PatenTrack system uses a **multi-database architecture** with centralized master data and isolated per-customer databases.

| Database | Purpose | Host |
|----------|---------|------|
| `db_uspto` | Master USPTO assignment data | Primary |
| `db_business` | Organisation/user management | Primary |
| `db_new_application` | Shared application-level data | Primary |
| `db_patent_application_bibliographic` | Application bibliographic data | Primary |
| `db_patent_grant_bibliographic` | Grant bibliographic data | Primary |
| `db_patent_maintainence_fee` | Maintenance fee events | Primary |
| `db_inventor` | Inventor data | Separate host |
| `big_data` | Secondary/archive data | Primary |
| Per-customer DBs | `db_{orgID}{uniqid}` | Primary (customer-specific) |

**Note:** `db_inventor` resides on a separate database host, requiring cross-host queries.

---

## 2. Master Database (`db_uspto`) Tables

The master database stores all raw USPTO data shared across all customers.

### `assignor_and_assignee`

**Purpose:** Links raw entity names to canonical representatives; serves as bridge table for name normalization.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `assignor_and_assignee_id` | INT | PK | Unique identifier |
| `name` | VARCHAR | | Raw entity name as it appears in records |
| `instances` | INT | | Count of occurrences |
| `representative_id` | INT | FK | Foreign key to `representative` table |

**Usage:** Name resolution queries join through this table to get canonical names.

### `representative`

**Purpose:** Canonical entity registry; stores normalized, deduplicated entity names.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `representative_id` | INT | PK | Unique identifier for entity |
| `representative_name` | VARCHAR | | Canonical normalized name |
| `type` | INT | | Entity type classification |
| `parent_id` | INT | FK | Self-referential parent for hierarchies |

**Note:** `parent_id` enables hierarchical entity relationships (e.g., subsidiaries to parent companies).

### `assignment`

**Purpose:** Core assignment/transaction records from USPTO.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | PK | Reel/Frame ID (transaction identifier) |
| `cname` | VARCHAR | | Correspondent name |
| `caddress_1` | VARCHAR | | Correspondent address line 1 |
| `caddress_2` | VARCHAR | | Correspondent address line 2 |
| `caddress_3` | VARCHAR | | Correspondent address line 3 |
| `reel_no` | VARCHAR | | Reel number |
| `frame_no` | VARCHAR | | Frame number |
| `convey_text` | TEXT | | Raw conveyance text (transaction type description) |
| `record_dt` | DATE | | Recording date at USPTO |
| `last_update_dt` | DATE | | Last update timestamp |
| `page_count` | INT | | Number of pages in assignment document |
| `purge_in` | INT | | Purge indicator flag |

**Key field:** `convey_text` — Input to transaction classification pipeline (see [Session 2, Section 1](./02-processing-pipelines.md#1-transaction-type-classification)).

### `assignor`

**Purpose:** Assignor (seller/grantor) party details for each transaction.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | FK | Foreign key to `assignment` table |
| `assignor_and_assignee_id` | INT | FK | Foreign key to `assignor_and_assignee` table |
| `or_name` | VARCHAR | | Original assignor name (raw) |
| `exec_dt` | DATE | | Execution date of assignment |

**Composite key:** `(rf_id, assignor_and_assignee_id)` — A transaction can have multiple assignors.

### `assignee`

**Purpose:** Assignee (buyer/grantee) party details for each transaction.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | FK | Foreign key to `assignment` table |
| `assignor_and_assignee_id` | INT | FK | Foreign key to `assignor_and_assignee` table |
| `ee_name` | VARCHAR | | Assignee name (raw) |
| `ee_address_1` | VARCHAR | | Assignee address line 1 |
| `ee_address_2` | VARCHAR | | Assignee address line 2 |
| `ee_city` | VARCHAR | | Assignee city |
| `ee_state` | VARCHAR | | Assignee state/province |
| `ee_postcode` | VARCHAR | | Assignee postal code |
| `ee_country` | VARCHAR | | Assignee country |

**Composite key:** `(rf_id, assignor_and_assignee_id)` — A transaction can have multiple assignees.

### `assignment_conveyance`

**Purpose:** Stores initial conveyance type classification (Tier 1).

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | PK/FK | Foreign key to `assignment` table |
| `convey_ty` | VARCHAR | | Conveyance type (transaction type) |
| `employer_assign` | TINYINT | | Flag: 1 = employee assignment, 0 = other |

**Note:** This table stores the initial classification. See also `representative_assignment_conveyance` for refined classifications.

### `representative_assignment_conveyance`

**Purpose:** Stores refined conveyance type classification (Tier 2) after reclassification pipeline.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | PK/FK | Foreign key to `assignment` table |
| `convey_ty` | VARCHAR | | Refined conveyance type |
| `employer_assign` | TINYINT | | Flag: 1 = employee assignment, 0 = other |

**Updated by:** `update_missing_type.php`, `update_flag.php` (see [Session 2, Sections 1 & 8](./02-processing-pipelines.md)).

### `documentid`

**Purpose:** Links assignments to specific patents and applications.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | FK | Foreign key to `assignment` table |
| `title` | VARCHAR | | Patent/application title |
| `appno_doc_num` | VARCHAR | | Application number |
| `appno_date` | DATE | | Application filing date |
| `appno_country` | VARCHAR | | Application country |
| `pgpub_doc_num` | VARCHAR | | Publication number |
| `pgpub_date` | DATE | | Publication date |
| `grant_doc_num` | VARCHAR | | Grant/patent number |
| `grant_date` | DATE | | Grant date |
| `grant_country` | VARCHAR | | Grant country |

**Cardinality:** One `rf_id` can link to multiple patents/applications (e.g., bulk assignments).

### `correspondent`

**Purpose:** Law firm or agent information for assignments.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `rf_id` | VARCHAR | FK | Foreign key to `assignment` table |
| `cname` | VARCHAR | | Correspondent name (law firm/agent) |

**Usage:** Powers "Law Firms" dashboard item (type 37).

### Classification Tables

#### `patent_cpc`

**Purpose:** Cooperative Patent Classification (CPC) data for granted patents.

**Note:** Populated from monthly CPC bulk downloads (see [Session 1, Section 1.4](./01-data-sources-and-ingestion.md#14-uspto-api---patent-grant-cpc-classifications-monthly)).

#### `application_cpc`

**Purpose:** CPC data for published patent applications.

**Note:** Populated from monthly application CPC downloads (see [Session 1, Section 1.5](./01-data-sources-and-ingestion.md#15-uspto-api---application-cpc-classifications-monthly)).

### Supporting Tables

**`company_temp`**
- **Purpose:** Temporary company data staging

**`list2`**
- **Purpose:** Working list (purpose unclear from code)

**`conveyance`**
- **Purpose:** Additional conveyance metadata
- **Key field:** `is_ota` (Office of Technology Assessment flag, used in broken title detection)

**`assignment_group`**
- **Purpose:** Groups related assignments together
- **Populated by:** `update_assignment_group.php`

**`application_status`**
- **Purpose:** Patent/application prosecution status
- **Source:** File wrapper status data (see [Session 1, Section 1.7](./01-data-sources-and-ingestion.md#17-uspto-api---patent-file-wrapper-status-data))

**`download_tracking`**
- **Purpose:** Tracks download status and progress for data ingestion pipelines

---

## 3. Business Database (`db_business`) Tables

### `organisation`

**Purpose:** Central registry of customer organizations with database connection credentials.

| Column | Type | Key | Description |
|--------|------|-----|-------------|
| `organisation_id` | INT | PK | Unique organization identifier |
| `name` | VARCHAR | | Organization name |
| `representative_name` | VARCHAR | | Primary representative entity name |
| `org_host` | VARCHAR | | Database host for organization's DB |
| `org_usr` | VARCHAR | | Database username |
| `org_pass` | VARCHAR | | **⚠️ PLAINTEXT database password** |
| `org_db` | VARCHAR | | Database name (`db_{orgID}{uniqid}`) |
| `org_key` | VARCHAR | | Organization access key |

**⚠️ Security Risk:** Database credentials stored in plaintext in this table.

**Usage:**
- Scripts query this table to get connection details for per-customer databases
- Example pattern:
  ```php
  $org = getOrganisation($org_id);
  $con = new mysqli($org->org_host, $org->org_usr, $org->org_pass, $org->org_db);
  ```

---

## 4. Application Database (`db_new_application`) Tables

This database stores shared, processed data that spans multiple customers but is organization-scoped.

### `activity_parties_transactions`

**Purpose:** Consolidated view of activities, parties, and transactions per organization.

**Key columns:**
- `organisation_id` (FK to `db_business.organisation`)
- Transaction references
- Party references
- Activity metadata

**Usage:** Central data source for dashboards and reports.

### `assets`

**Purpose:** Tracks current assets (patents/applications) owned by organizations.

**Key fields:**
- Patent/application numbers
- Current owner
- Status

**Related table:** `lost_assets` (tracks assets no longer owned).

### `lost_assets`

**Purpose:** Historical record of assets transferred out or no longer owned.

**Usage:** Powers "Assets Acquired" and sale tracking in dashboards.

### `dashboard_items`

**Purpose:** Stores dashboard line items for all dashboard types.

**Schema:**
```sql
dashboard_items (
    organisation_id,
    representative_id,
    assignor_id,
    type,              -- Dashboard item type (1-37)
    patent,
    application,
    rf_id,
    total,
    lawfirm,
    lawfirm_id,
    event_code,
    mode
)
```

**See:** [Session 2, Section 6](./02-processing-pipelines.md#6-dashboard-json-generation) for complete type listing.

### `dashboard_items_count`

**Purpose:** Aggregated counts for dashboard summary statistics.

**Schema:**
```sql
dashboard_items_count (
    number,
    other_number,
    total,
    organisation_id,
    representative_id,
    assignor_id,
    type
)
```

### `summary`

**Purpose:** High-level statistics per organization and company.

**Schema:**
```sql
summary (
    organisation_id,
    company_id,        -- 0 = org-level, >0 = company-level
    companies,
    activities,
    entities,
    parties,
    employees,
    transactions,
    assets,
    arrows
)
```

**See:** [Session 2, Section 9](./02-processing-pipelines.md#9-summary-generation) for details.

### `log_messages`

**Purpose:** Application logging and audit trail.

**Usage:** Debugging, error tracking, process monitoring.

### `cited_patents`

**Purpose:** Patent citation relationships.

**Source:** Bibliographic data from Red Book XML (see [Session 1, Sections 1.1-1.2](./01-data-sources-and-ingestion.md)).

### `assignment_arrows`

**Purpose:** Visual arrows/edges for assignment visualizations.

**Related:** `generate_json.php` for visual tree generation.

### `borrowers_activity_parties_transactions`

**Purpose:** Bank-specific view of activity for lending customers.

**Usage:** `dashboard_with_bank.php`, `assets_bank_broken_title.php`.

---

## 5. Per-Customer DB Schema

Each customer organization gets a dedicated MySQL database and user.

### Database Provisioning

**Script:** `script_create_customer_db.php`

**Process:**
1. **Database name:** `db_{organisationID}{uniqid()}`
2. **Username:** `{uniqid()}`
3. **Password:** `{UPPERCASE(uniqid())}!{uniqid()}`
4. **Storage:** Credentials saved to `db_business.organisation` table
5. **Privileges:** Full access to own database only

**Example:**
- Organisation ID: `1234`
- Database: `db_12345f7g9a2b`
- User: `5f7g9a2b`
- Password: `5F7G9A2B!5f7g9a2b`

### CRM Tables (Customer-Specific)

**`subject_type`**
- Matter/subject classifications

**`type`**
- General type classifications

**`firm`**
- Law firm registry

**`document`**
- Document management

**`professional`**
- Professional contacts (attorneys, agents)

**`user`**
- Customer users and permissions

**`activity`**
- Customer activities and tasks

**`representative`**
- Customer-specific representative/entity registry
- **Note:** Different from `db_uspto.representative`; customer can have custom entity names

**`telephone`**
- Contact phone numbers

**`comment`**
- Notes and comments

**`address`**
- Contact addresses

**`collection`**
- Patent/application collections (portfolios)

**`collection_company`**
- Links collections to companies

**`collection_patent`**
- Links collections to patents

**`lawfirm`**
- Law firm details

**`lawfirm_address`**
- Law firm addresses

**`company_lawfirm`**
- Company-to-law firm relationships

**`assets_channel`**
- Asset distribution channels

### Synced Tables (Copied from Master)

These tables are **copied** from `db_uspto` or populated by processing pipelines:

**`tree`**
- Ownership tree nodes
- **Populated by:** `tree.php` (see [Session 2, Section 4](./02-processing-pipelines.md#4-ownership-tree-construction))

**`tree_parties`**
- Party details for tree nodes

**`tree_parties_collection`**
- Grouped parties in tree

**`validity`**
- Timeline and expiration data
- **Populated by:** `fix_inventor_timeline_tree_transaction_assests_updates.php` (see [Session 2, Section 7](./02-processing-pipelines.md#7-timeline-generation))

**`assignor_and_assignee`**
- Customer-scoped copy of master table

**`assignor`**
- Customer-scoped assignor records

**`assignee`**
- Customer-scoped assignee records

**`assignment_conveyance`**
- Customer-scoped conveyance types

**`documentid`**
- Customer-scoped document IDs

**`representative`**
- Customer-scoped representative names

**Sync Pattern:** Scripts query `db_uspto` and insert/update into per-customer databases.

---

## 6. Multi-Tenancy Architecture

### Data Isolation Model

**Approach:** Database-per-tenant (strict isolation)

**Benefits:**
- ✅ Strong data isolation (separate MySQL database + user per customer)
- ✅ Independent schema evolution per customer (if needed)
- ✅ Easy backup/restore per customer
- ✅ Resource limits per database

**Drawbacks:**
- ❌ Complex schema updates (must update all customer DBs)
- ❌ No cross-customer queries
- ❌ Higher operational overhead (hundreds of databases)
- ❌ Connection pool exhaustion risk

### Customer-to-Company Mapping

**Registry:** `db_business.organisation` table

**Flow:**
1. User logs in → identified by `organisation_id`
2. Query `db_business.organisation` → get `org_db`, `org_usr`, `org_pass`, `org_host`
3. Establish connection to customer database
4. Execute customer-specific queries

### Cross-Account Data Transfer

**Script:** `transferred_data_from_one_account_to_another_accounts.php`

**Use case:** Migrating data when companies change organizations or merge accounts.

**Process:**
1. Connect to source customer DB
2. Extract relevant data
3. Connect to destination customer DB
4. Insert data with new `organisation_id` and `representative_id` mappings

### Shared Data Access

**Pattern:** All scripts query `db_uspto` directly (no customer isolation).

**Master data:**
- Assignment records
- Document IDs
- Bibliographic data
- CPC classifications

**Implication:** All customers share the same USPTO master data; isolation is achieved through `representative_id` filtering.

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────┐
│  External Data Sources (USPTO)                      │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  db_uspto (Master Database)                         │
│  - Shared by all customers                          │
│  - Assignment, assignor, assignee, documentid       │
└────────────────┬────────────────────────────────────┘
                 │
                 │ Processing Pipelines
                 ▼
┌─────────────────────────────────────────────────────┐
│  db_new_application (Shared Processed Data)         │
│  - Organisation-scoped data                         │
│  - activity_parties_transactions, assets, summaries │
└────────────────┬────────────────────────────────────┘
                 │
                 │ Data Sync
                 ▼
┌─────────────────────────────────────────────────────┐
│  Per-Customer Databases (db_{orgID}{uniqid})        │
│  - Isolated per customer                            │
│  - CRM tables + synced USPTO data                   │
│  - Trees, dashboards, timelines                     │
└─────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  db_business.organisation                           │
│  - Registry of customers                            │
│  - Database credentials (plaintext)                 │
└─────────────────────────────────────────────────────┘
```

---

## 7. Database Relationships Map

### Entity Relationship Diagram (Text Format)

```
db_business.organisation
  ├─ [1:1] → Per-Customer DB (via org_host, org_usr, org_pass, org_db)
  ├─ [1:N] → db_new_application.activity_parties_transactions (via organisation_id)
  ├─ [1:N] → db_new_application.dashboard_items (via organisation_id)
  └─ [1:N] → db_new_application.summary (via organisation_id)

db_uspto (Master Data Relationships)
  └─ assignment (rf_id PK)
      ├── [1:N] → assignor (rf_id FK)
      │   └── [N:1] → assignor_and_assignee (assignor_and_assignee_id FK)
      │       └── [N:1] → representative (representative_id FK)
      │
      ├── [1:N] → assignee (rf_id FK)
      │   └── [N:1] → assignor_and_assignee (assignor_and_assignee_id FK)
      │       └── [N:1] → representative (representative_id FK)
      │
      ├── [1:1] → assignment_conveyance (rf_id FK)
      ├── [1:1] → representative_assignment_conveyance (rf_id FK)
      ├── [1:N] → documentid (rf_id FK)
      └── [1:N] → correspondent (rf_id FK)

representative (representative_id PK)
  └── [N:1] → representative (parent_id FK, self-referential)

documentid
  ├── [N:1] → db_patent_application_bibliographic (via appno_doc_num)
  ├── [N:1] → db_patent_grant_bibliographic (via grant_doc_num)
  └── [N:1] → application_cpc / patent_cpc (via doc numbers)

db_new_application (Shared Application Data)
  ├─ activity_parties_transactions
  │   ├── [N:1] → db_business.organisation (via organisation_id)
  │   └── [N:1] → db_uspto.representative (via representative_id)
  │
  ├─ assets
  │   ├── [N:1] → db_business.organisation (via organisation_id)
  │   └── [N:1] → db_uspto.documentid (via patent/application numbers)
  │
  ├─ dashboard_items / dashboard_items_count
  │   ├── [N:1] → db_business.organisation (via organisation_id)
  │   └── [N:1] → db_uspto.representative (via representative_id)
  │
  └─ summary
      ├── [N:1] → db_business.organisation (via organisation_id)
      └── [N:1] → db_uspto.representative (via representative_id)

Per-Customer DB Tables
  ├─ representative (customer-specific entity registry)
  │   └── Links to db_uspto.representative (via representative_id)
  │
  ├─ tree / tree_parties / tree_parties_collection
  │   ├── [N:1] → representative (via representative_id)
  │   └── [N:1] → assignor_and_assignee (via assignor_and_assignee_id)
  │
  ├─ validity
  │   ├── [N:1] → db_business.organisation (via organisation_id)
  │   └── [N:1] → representative (via representative_id)
  │
  └─ Synced tables (assignor, assignee, documentid, etc.)
      └── Copies of db_uspto tables filtered by organisation/representative
```

### Key Relationships

**Primary Keys:**
- `rf_id` — Reel/Frame ID, unique transaction identifier
- `representative_id` — Canonical entity identifier
- `assignor_and_assignee_id` — Raw name-to-entity link
- `organisation_id` — Customer organization identifier

**Foreign Key Patterns:**
- Most tables **do not enforce FK constraints** in MySQL
- Referential integrity maintained by **application logic**
- Risk: Orphaned records, inconsistent data

**Many-to-Many Relationships:**
- Assignment ↔ Patents: Via `documentid` (one assignment can cover multiple patents)
- Entity ↔ Names: Via `assignor_and_assignee` (one entity can have multiple name variations)

---

## 8. Key Observations & Risks

### Schema Quality Issues

**No Foreign Key Constraints:**
- Database does not enforce referential integrity
- Relies entirely on application logic
- Risk: Orphaned records, dangling references

**No Schema Versioning:**
- No migration scripts
- No version tracking (e.g., Flyway, Liquibase)
- Risk: Cannot track schema evolution, difficult to reproduce environments

**Stored Procedures Not in Source Control:**
- `routine_transaction($companyID, $organisationID)`
- `GetAssetsTableC("$companyID", $organisationID)`
- Risk: Cannot version control, code review, or deploy consistently

**Unclear Purpose:**
- `big_data` database — purpose not documented in code
- `list2` table — usage unclear
- Risk: Dead code, unused resources

### Security Risks

**Plaintext Credentials in Database:**
- `db_business.organisation` stores DB passwords in plaintext
- Risk: Critical security vulnerability; credential exposure

**No Credential Rotation:**
- Passwords generated once during provisioning
- No rotation mechanism
- Risk: Long-lived credentials increase attack surface

**Cross-DB Queries:**
- Scripts connect to multiple databases with different credentials
- No connection pooling or credential management
- Risk: Credential leakage, connection exhaustion

### Data Integrity Risks

**INSERT IGNORE Pattern:**
- Used extensively throughout codebase
- Silently ignores duplicate key violations
- Risk: Data loss masked as success

**No Transaction Wrappers:**
- Multi-step operations lack atomicity
- Example: Delete + Insert in multiple scripts
- Risk: Partial failures leave inconsistent state

**No Audit Trails:**
- Data changes not logged with timestamp/user
- Cannot track who changed what and when
- Risk: Cannot investigate data issues or compliance violations

**Delete + Reinsert Pattern:**
- Trees, dashboards rebuilt by full delete + reinsert
- No incremental updates
- Risk: Data unavailability during regeneration, poor performance

### Operational Risks

**Separate Host for `db_inventor`:**
- Inventor data on different database server
- No failover or high availability documented
- Risk: Single point of failure, cross-host query latency

**No Connection Pooling:**
- Each script creates new connections
- No connection reuse
- Risk: Database connection exhaustion under load

**No Database Backups Documented:**
- No backup/restore procedures in code
- Unknown RPO/RTO
- Risk: Data loss potential

**No Database Monitoring:**
- No metrics collection
- No alerting on failures
- Risk: Silent degradation, undetected outages

### Multi-Tenancy Risks

**Schema Update Complexity:**
- Changes must be applied to **every customer database**
- No documented process for rolling schema updates
- Risk: Schema drift, inconsistent customer experiences

**Credential Management:**
- Hundreds of database users (one per customer)
- All credentials in one table
- Risk: Blast radius of credential compromise is enormous

**Database Proliferation:**
- Each new customer = new database + user
- No limit documented
- Risk: Operational complexity grows linearly with customers

**No Data Migration Tools:**
- `transferred_data_from_one_account_to_another_accounts.php` is ad-hoc
- No standardized migration framework
- Risk: Data loss or corruption during transfers

### Performance Risks

**No Indexing Documentation:**
- No index strategy documented
- Unknown if proper indexes exist
- Risk: Query performance degradation as data grows

**Full Table Scans:**
- Many queries appear to use `GROUP BY` without index hints
- Risk: Slow queries, database lock contention

**No Query Optimization:**
- Queries generated via string concatenation
- No use of query builders or ORMs
- Risk: Inefficient query plans

**No Partitioning:**
- Large tables (assignments, documentid) not partitioned
- Risk: Query performance degrades over time

### Recommendations

#### Immediate (High Priority)

1. **Encrypt credentials** in `db_business.organisation`
   - Use application-level encryption
   - Implement secrets management (e.g., HashiCorp Vault)

2. **Add transaction wrappers** to all multi-step operations
   - Wrap delete + insert in `BEGIN...COMMIT`
   - Add rollback on error

3. **Version control stored procedures**
   - Extract procedures to `.sql` files in repository
   - Document parameters and logic

4. **Implement database backups**
   - Automated daily backups
   - Test restore procedures

#### Medium Priority

5. **Add foreign key constraints**
   - Start with core tables (`assignment`, `documentid`, `assignor`, `assignee`)
   - Validate data consistency first

6. **Implement schema versioning**
   - Use migration tool (Flyway, Liquibase)
   - Version all schema changes

7. **Replace INSERT IGNORE with explicit conflict handling**
   - Use `INSERT...ON DUPLICATE KEY UPDATE` with logging
   - Surface errors instead of silencing them

8. **Add audit logging**
   - Track all data modifications
   - Include user, timestamp, operation

#### Long-Term

9. **Refactor multi-tenancy model**
   - Evaluate schema-per-tenant vs row-level isolation
   - Consider shared schema with `organisation_id` partitioning

10. **Implement connection pooling**
    - Use persistent connections
    - Add connection pool manager

11. **Add database monitoring**
    - Query performance metrics
    - Connection pool metrics
    - Slow query logging

12. **Document `big_data` purpose**
    - Determine if still needed
    - Archive or remove if unused

13. **Consolidate `db_inventor`**
    - Move to primary host or implement proper cross-host query management
    - Add high availability

14. **Create data migration framework**
    - Standardize account transfer process
    - Add validation and rollback capabilities
