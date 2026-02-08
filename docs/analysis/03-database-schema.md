# PatenTrack Database Schema Analysis

> **Note**: This document analyzes database schemas and multi-tenancy architecture. For data sources and ingestion, see `01-data-sources-and-ingestion.md`. For processing pipelines, see `02-processing-pipelines.md`.

## 1. Database Inventory

### 1.1 Overview

The PatenTrack system implements a **multi-tenant database architecture** with shared master databases and isolated per-customer databases.

| Database | Type | Purpose | Size Estimate |
|----------|------|---------|---------------|
| `db_business` | Shared | Central customer/organization registry | Small (~MB) |
| `db_uspto` | Shared | USPTO master patent/assignment data | Very Large (~TB) |
| `db_new_application` | Shared | Application-level tracking, assets, timelines | Large (~GB) |
| `db_patent_grant_bibliographic` | Shared | Patent grant bibliographic data (Red Book) | Very Large (~TB) |
| `db_patent_application_bibliographic` | Shared | Patent application bibliographic data | Very Large (~TB) |
| `db_patent_maintainence_fee` | Shared | Patent maintenance fee events | Medium (~GB) |
| `db_patentrack` | Shared | Main application database | Medium (~GB) |
| `big_data_uspto` | Shared | Large USPTO bulk data | Very Large (~TB) |
| `db_<orgid><uniqid>` | Per-Customer | Isolated customer databases | Small-Medium (~MB-GB each) |

### 1.2 Database Roles

**Master/Shared Databases**: Store all USPTO data, shared across all customers
**Per-Customer Databases**: Isolated workspaces for each customer organization

---

## 2. Master Database Schemas

### 2.1 db_business (Organization Management)

#### 2.1.1 organisation
**Purpose**: Central registry of all customer organizations

**Columns**:
- `organisation_id` (INT, PK, AUTO_INCREMENT)
- `name` (VARCHAR) - Organization name
- `representative_name` (VARCHAR) - Normalized company name
- `org_db` (VARCHAR) - Customer database name
- `org_usr` (VARCHAR) - Database username
- `org_pass` (VARCHAR) - Database password (encrypted in newer versions)
- `org_host` (VARCHAR) - Database host
- `org_key` (VARCHAR) - Encryption key (AES-128-ECB in create_db_on_run.php)
- `status` (TINYINT) - Active/inactive
- `created_at`, `updated_at` (DATETIME)

**Indexes**: 
- Primary key on `organisation_id`
- Index on `name`, `representative_name`

**Note**: Stores credentials for connecting to per-customer databases

---

### 2.2 db_uspto (USPTO Master Data)

#### 2.2.1 assignment
**Purpose**: Patent assignment records from USPTO PASDL

**Columns**:
- `rf_id` (BIGINT, PK) - Registration file ID (reel-frame identifier)
- `reel_no` (VARCHAR) - Reel number
- `frame_no` (VARCHAR) - Frame number
- `record_dt` (DATE) - Recording date
- `page_count` (INT) - PDF page count
- `correspondent` (TEXT) - Correspondent information

**Indexes**:
- Primary key on `rf_id`
- Index on `reel_no`, `frame_no`
- Index on `record_dt`

**Source**: USPTO Assignment API (PASDL daily downloads)

#### 2.2.2 assignor
**Purpose**: Previous owners in patent assignments

**Columns**:
- `assignor_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT, FK → assignment) - Assignment reference
- `or_name` (VARCHAR(245), UTF8MB4) - Original assignor name
- `exec_dt` (DATE) - Execution date
- `assignor_and_assignee_id` (BIGINT, FK → assignor_and_assignee)

**Indexes**:
- Primary key on `assignor_id`
- Foreign key on `rf_id`
- Index on `assignor_and_assignee_id`
- Index on `or_name`
- Index on `exec_dt`

#### 2.2.3 assignee
**Purpose**: New owners in patent assignments

**Columns**:
- `assignee_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT, FK → assignment)
- `ee_name` (VARCHAR(245), UTF8MB4) - Original assignee name
- `assignor_and_assignee_id` (BIGINT, FK → assignor_and_assignee)

**Indexes**:
- Primary key on `assignee_id`
- Foreign key on `rf_id`
- Index on `assignor_and_assignee_id`
- Index on `ee_name`

#### 2.2.4 assignor_and_assignee
**Purpose**: Master entity table (normalized company/person names)

**Columns**:
- `assignor_and_assignee_id` (BIGINT, PK, AUTO_INCREMENT)
- `name` (VARCHAR(200), UTF8MB4) - Normalized name
- `instances` (INT) - Number of times entity appears
- `representative_id` (BIGINT, FK → representative) - Parent company

**Indexes**:
- Primary key on `assignor_and_assignee_id`
- Unique key on `name`
- Foreign key on `representative_id`
- **FULLTEXT index** on `name` (for MATCH...AGAINST queries)

**Note**: Central deduplication table - all assignors/assignees link here after normalization

#### 2.2.5 representative
**Purpose**: Parent companies and normalized representatives

**Columns**:
- `representative_id` (BIGINT, PK, AUTO_INCREMENT)
- `original_name` (VARCHAR(245), UTF8MB4) - Original name
- `representative_name` (VARCHAR(245), UTF8MB4) - Normalized name
- `parent_id` (BIGINT) - Parent company ID (0 = root company)
- `instances` (INT) - Occurrence count
- `company_id` (BIGINT) - External company ID
- `child` (TINYINT) - Is child company (0/1)
- `type` (TINYINT) - Entity type (0=company, 1=group)
- `mode` (TINYINT) - Mode flag (1=bank mode)
- `status` (TINYINT) - Active/inactive

**Indexes**:
- Primary key on `representative_id`
- Index on `parent_id`
- Index on `representative_name`, `original_name`
- Index on `company_id`

**Hierarchy**: `parent_id = 0` indicates root companies; others reference parent via `parent_id`

#### 2.2.6 representative_assignment_conveyance
**Purpose**: Links assignments to conveyance types with flags

**Columns**:
- `rac_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT, FK → assignment)
- `convey_ty` (VARCHAR) - Transaction type ('assignment', 'employee', 'security', 'release', 'merger', 'namechg', 'addresschg', 'license', 'correct', 'govern', 'other', 'missing')
- `employer_assign` (TINYINT) - Employee assignment flag (0/1)
- `exec_dt` (DATE) - Execution date
- `flag` (TINYINT) - Processing flag (customer-data-migrator only)

**Indexes**:
- Primary key on `rac_id`
- Foreign key on `rf_id`
- Index on `convey_ty`
- Index on `employer_assign`
- Index on `exec_dt`

**Critical Table**: Modified by transaction classification and flag update pipelines

#### 2.2.7 conveyance
**Purpose**: Conveyance type definitions

**Columns**:
- `convey_id` (INT, PK, AUTO_INCREMENT)
- `convey_name` (VARCHAR) - Conveyance type name
- `is_ota` (TINYINT) - Is Ownership Transfer Activity (0/1)
- `description` (TEXT)

**Reference Data**:
```
'assignment'    - is_ota = 1
'employee'      - is_ota = 1 (when employer_assign = 1)
'security'      - is_ota = 0 (collateral)
'release'       - is_ota = 0
'merger'        - is_ota = 1
'namechg'       - is_ota = 0
'license'       - is_ota = 0
'correct'       - is_ota = 1 (when employer_assign = 1)
```

#### 2.2.8 documentid
**Purpose**: Maps patent documents to assignments

**Columns**:
- `doc_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT, FK → assignment)
- `appno_doc_num` (VARCHAR(20)) - Application number
- `grant_doc_num` (VARCHAR(20)) - Grant number
- `appno_date` (DATE) - Application filing date
- `grant_date` (DATE) - Grant date

**Indexes**:
- Primary key on `doc_id`
- Foreign key on `rf_id`
- Index on `appno_doc_num`
- Index on `grant_doc_num`
- Composite index on `appno_doc_num`, `grant_doc_num`

**Note**: Junction table linking patents to assignments

#### 2.2.9 inventors
**Purpose**: Inventor master list

**Columns**:
- `inventor_id` (BIGINT, PK, AUTO_INCREMENT)
- `assignor_and_assignee_id` (BIGINT, FK → assignor_and_assignee)
- `name` (VARCHAR)
- `family_name` (VARCHAR)
- `given_name` (VARCHAR)

**Indexes**:
- Primary key on `inventor_id`
- Foreign key on `assignor_and_assignee_id`
- Index on `name`

#### 2.2.10 tree
**Purpose**: Ownership tree records

**Columns**:
- `tree_id` (BIGINT, PK, AUTO_INCREMENT)
- `assignor_and_assignee_id` (BIGINT, FK)
- `name` (VARCHAR)
- `parent` (VARCHAR) - Parent node ID (initially "0")
- `type` (VARCHAR) - Transaction type
- `tab_id` (INT) - Grouping ID
- `organisation_id` (INT, FK → db_business.organisation)
- `representative_id` (BIGINT, FK → representative)

**Indexes**:
- Primary key on `tree_id`
- Index on `organisation_id`, `representative_id`

**Note**: Flat relational tree (not hierarchical)

#### 2.2.11 tree_parties
**Purpose**: Alternate tree structure (similar to tree)

**Note**: Similar schema to `tree` table

#### 2.2.12 assignment_arrows
**Purpose**: Stores arrow count for visual diagrams

**Columns**:
- `rf_id` (BIGINT, PK, FK → assignment)
- `arrows` (INT) - Number of visual connections

#### 2.2.13 application_status
**Purpose**: Patent status tracking

**Columns**:
- `status_id` (BIGINT, PK, AUTO_INCREMENT)
- `appno_doc_num` (VARCHAR)
- `patent_status` (VARCHAR) - 'expired', 'abandoned', 'active'
- `status_date` (DATE)

#### 2.2.14 temp_assignor_and_assignee_name
**Purpose**: Temporary normalization staging

**Columns**:
- `temp_id` (BIGINT, PK, AUTO_INCREMENT)
- `assignor_and_assignee_id` (BIGINT)
- `original_name` (VARCHAR)
- `name` (VARCHAR) - Normalized name
- `type` (VARCHAR)

**Note**: Used by fix_representative.php for non-ASCII name handling

#### 2.2.15 temp_assets_bank_broken
**Purpose**: Temporary broken title detection staging

**Columns**:
- `appno_doc_num` (VARCHAR)
- `assignor_id` (BIGINT)
- `company_id` (INT)
- `organisation_id` (INT)

**Note**: Deleted after processing by assets_bank_broken_title.php

#### 2.2.16 temp_transaction_bank_parties_count
**Purpose**: Temporary transaction counting for broken title detection

**Columns**:
- `appno_doc_num` (VARCHAR)
- `transaction_count` (INT)
- `rf_ids` (TEXT) - Comma-separated rf_id list
- `parties_count` (INT)
- `assignor_id`, `company_id`, `organisation_id` (INT)

---

### 2.3 db_new_application (Application Layer)

#### 2.3.1 assets
**Purpose**: Patent assets owned by organizations

**Columns**:
- `asset_id` (BIGINT, PK, AUTO_INCREMENT)
- `appno_doc_num` (VARCHAR) - Application number
- `appno_date` (DATE) - Application date
- `grant_doc_num` (VARCHAR) - Grant number
- `grant_date` (DATE) - Grant date
- `layout_id` (INT) - Layout type (15=normal, 1=broken chain)
- `company_id` (INT, FK)
- `organisation_id` (INT, FK → db_business.organisation)

**Indexes**:
- Primary key on `asset_id`
- Composite index on `organisation_id`, `company_id`, `layout_id`
- Index on `appno_doc_num`

#### 2.3.2 assets_with_bank
**Purpose**: Assets with banking/security information

**Columns**:
- `asset_id` (BIGINT, PK, AUTO_INCREMENT)
- `appno_doc_num` (VARCHAR)
- `appno_date` (DATE)
- `grant_doc_num` (VARCHAR)
- `grant_date` (DATE)
- `rf_id` (BIGINT) - Latest relevant assignment
- `exec_dt` (DATE) - Execution date of latest assignment
- `company_id` (INT)
- `assignor_id` (BIGINT) - Current owner
- `organisation_id` (INT)

**Indexes**:
- Primary key on `asset_id`
- Index on `company_id`, `assignor_id`, `organisation_id`

#### 2.3.3 assets_bank_broken
**Purpose**: Assets with broken title chains (bank mode)

**Columns**:
- `asset_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT)
- `appno_doc_num` (VARCHAR)
- `appno_date` (DATE)
- `grant_doc_num` (VARCHAR)
- `grant_date` (DATE)
- `layout_id` (INT)
- `company_id` (INT)
- `assignor_id` (BIGINT)
- `organisation_id` (INT)

#### 2.3.4 lost_assets
**Purpose**: Assets where normalized name ≠ representative name

**Columns**:
- `asset_id` (BIGINT, PK, AUTO_INCREMENT)
- `assignor_and_assignee_id` (BIGINT)
- `assignor_id` (BIGINT)
- `appno_doc_num` (VARCHAR)
- `appno_date` (DATE)
- `grant_doc_num` (VARCHAR)
- `grant_date` (DATE)
- `rf_id` (BIGINT)
- `original_name` (VARCHAR)
- `representative_name` (VARCHAR)
- `company_id` (INT)
- `organisation_id` (INT)

#### 2.3.5 timeline
**Purpose**: Transaction timeline for organizations

**Columns**:
- `timeline_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT)
- `reel_no` (VARCHAR)
- `frame_no` (VARCHAR)
- `record_dt` (DATE)
- `organisation_id` (INT)
- `representative_id` (BIGINT)
- `type` (VARCHAR) - "Assignor" or "Assignee"
- `original_name` (VARCHAR)
- `assignor_and_assignee_id` (BIGINT)
- `exec_dt` (DATE)
- `convey_ty` (VARCHAR)
- `employer_assign` (TINYINT)

**Indexes**:
- Primary key on `timeline_id`
- Index on `organisation_id`, `representative_id`
- Index on `exec_dt`

#### 2.3.6 activity_parties_transactions
**Purpose**: Tracks company transaction activity

**Columns**:
- `activity_id` (BIGINT, PK, AUTO_INCREMENT)
- `organisation_id` (INT)
- `company_id` (INT)
- `assignor_and_assignee_id` (BIGINT)
- `recorded_assignor_and_assignee_id` (BIGINT)
- `rf_id` (BIGINT)
- `activity_id` (INT) - Activity type

**Indexes**:
- Primary key on `activity_id`
- Composite index on `organisation_id`, `company_id`, `activity_id`

#### 2.3.7 summary
**Purpose**: Pre-computed statistics per organization/company

**Columns**:
- `summary_id` (BIGINT, PK, AUTO_INCREMENT)
- `organisation_id` (INT)
- `company_id` (INT) - 0 = org-level aggregate
- `companies` (INT) - Company count
- `activities` (INT) - Activity count
- `entities` (INT) - 3rd party entity count
- `parties` (INT) - Party count
- `employees` (INT) - Employee count
- `transactions` (INT) - Transaction count
- `assets` (INT) - Asset count
- `arrows` (INT) - Arrow count for diagrams

**Indexes**:
- Primary key on `summary_id`
- Unique composite on `organisation_id`, `company_id`

#### 2.3.8 dashboard_items
**Purpose**: Dashboard data items

**Columns**:
- `item_id` (BIGINT, PK, AUTO_INCREMENT)
- `representative_id` (BIGINT)
- `assignor_id` (BIGINT)
- `type` (INT) - Item type (1=broken chain, etc.)
- `patent` (VARCHAR) - Grant number
- `application` (VARCHAR) - Application number
- `rf_id` (BIGINT)
- `total` (INT) - Count

#### 2.3.9 log_messages
**Purpose**: Processing log/audit trail

**Columns**:
- `log_id` (BIGINT, PK, AUTO_INCREMENT)
- `organisation_id` (INT)
- `company_id` (INT)
- `message` (TEXT)
- `created_at` (DATETIME)

#### 2.3.10 table_c, table_d
**Purpose**: Temporary processing tables for broken title detection

**Note**: Used by stored procedures, schema inferred from usage

---

### 2.4 db_patent_grant_bibliographic (Red Book - Grants)

#### 2.4.1 inventor
**Purpose**: Inventor records from patent grants

**Columns**:
- `inventor_id` (BIGINT, PK, AUTO_INCREMENT)
- `appno_doc_num` (VARCHAR) - Application number
- `name` (VARCHAR) - Full name
- `family_name` (VARCHAR) - Last name
- `given_name` (VARCHAR) - First name
- `city` (VARCHAR)
- `state` (VARCHAR)
- `country` (VARCHAR)

**Indexes**:
- Primary key on `inventor_id`
- Index on `appno_doc_num`
- Index on `name`

**Source**: USPTO Patent Grant Red Book XML

#### 2.4.2 application_publication
**Purpose**: Patent publication metadata

**Columns**:
- `pub_id` (BIGINT, PK, AUTO_INCREMENT)
- `appno_doc_num` (VARCHAR)
- `pub_number` (VARCHAR)
- `pub_date` (DATE)
- `title` (TEXT)

---

### 2.5 db_patent_application_bibliographic (Red Book - Applications)

#### 2.5.1 inventor
**Purpose**: Inventor records from published applications

**Columns**: (Same schema as grant bibliographic inventor)

**Source**: USPTO Patent Application Red Book XML

---

### 2.6 db_patent_maintainence_fee

#### 2.6.1 event_maintainence_fees
**Purpose**: Patent maintenance fee payment events

**Columns**:
- `event_id` (BIGINT, PK, AUTO_INCREMENT)
- `patent_number` (VARCHAR)
- `maintenance_event` (VARCHAR) - Fee type
- `event_date` (DATE)
- `amount` (DECIMAL)

**Source**: USPTO Maintenance Fee Events API

---

## 3. Per-Customer Database Schema

### 3.1 Customer DB Creation Process

**Source File**: `customer-data-migrator/script_create_customer_db.php`

**Trigger**: New customer onboarding

**Process**:
```
1. Lookup organization from db_business.organisation
2. Generate database name: db_<org_id><uniqid()>
3. Generate username: random 16-char string
4. Generate password: 32-char alphanumeric
5. CREATE DATABASE db_<org_id><uniqid>
6. CREATE USER '<username>'@'%' IDENTIFIED BY '<password>'
7. GRANT ALL PRIVILEGES ON db_<org_id><uniqid>.* TO '<username>'@'%'
8. Create 18 tables (see schema below)
9. Seed reference data (type, subject_type)
10. UPDATE db_business.organisation SET:
    - org_db = '<database_name>'
    - org_usr = '<username>'
    - org_pass = '<encrypted_password>'
    - org_host = '<host>'
    - org_key = '<encryption_key>'
```

**Encryption** (create_db_on_run.php):
```php
// AES-128-ECB encryption
$encrypted_password = openssl_encrypt($password, 'AES-128-ECB', $encryption_key, 0);
```

**Older Version** (script_create_customer_db.php):
- Stores plaintext passwords (security risk)

### 3.2 Customer DB Tables

Each customer database contains 18 tables:

#### 3.2.1 subject_type
**Purpose**: Activity subject type classifications

**Columns**:
- `subject_type_id` (INT, PK, AUTO_INCREMENT)
- `subject_name` (VARCHAR(45))

**Seed Data**:
```
1: 'General'
2: 'Prosecution'
3: 'Maintenance Fee'
```

#### 3.2.2 type
**Purpose**: Activity type classifications

**Columns**:
- `type_id` (INT, PK, AUTO_INCREMENT)
- `name` (VARCHAR(30))

**Seed Data**:
```
1: 'General'
2: 'Action'
3: 'Activity'
```

#### 3.2.3 firm
**Purpose**: Law firms

**Columns**:
- `firm_id` (INT, PK, AUTO_INCREMENT)
- `firm_name` (VARCHAR(250))
- `firm_logo` (VARCHAR(500))
- `firm_linkedin_url` (VARCHAR(500))

#### 3.2.4 professional
**Purpose**: Legal professionals (attorneys, agents)

**Columns**:
- `professional_id` (INT, PK, AUTO_INCREMENT)
- `first_name` (VARCHAR(75))
- `last_name` (VARCHAR(75))
- `email_address` (VARCHAR(255))
- `telephone` (VARCHAR(15))
- `telephone1` (VARCHAR(15))
- `linkedin_url` (VARCHAR(500))
- `profile_logo` (VARCHAR(500))
- `firm_id` (INT, FK → firm)
- `type` (TINYINT)
- `created_at`, `updated_at` (DATETIME)

**Foreign Keys**: firm_id → firm(firm_id)

#### 3.2.5 user
**Purpose**: Customer organization users

**Columns**:
- `user_id` (INT, PK, AUTO_INCREMENT)
- `first_name` (VARCHAR(255))
- `last_name` (VARCHAR(255))
- `username` (VARCHAR(255), UNIQUE)
- `email_address` (VARCHAR(255))
- `linkedin_url` (VARCHAR(255))
- `job_title` (VARCHAR(300))
- `telephone` (VARCHAR(15))
- `telephone1` (VARCHAR(15))
- `logo` (VARCHAR(255))
- `status` (TINYINT)
- `role_id` (INT)
- `created_at`, `updated_at` (DATETIME)

**Indexes**: Unique on `username`

#### 3.2.6 document
**Purpose**: Customer document storage

**Columns**:
- `document_id` (INT, PK, AUTO_INCREMENT)
- `title` (VARCHAR(300))
- `file` (VARCHAR(500)) - File path/URL
- `type` (TINYINT)
- `description` (TEXT)
- `user_id` (BIGINT, FK → user)
- `created_at`, `updated_at` (DATETIME)
- `status` (TINYINT)

**Foreign Keys**: user_id → user(user_id)

#### 3.2.7 activity
**Purpose**: Customer activities (notes, actions, tasks)

**Columns**:
- `activity_id` (BIGINT, PK, AUTO_INCREMENT)
- `user_id` (INT, FK → user)
- `professional_id` (INT, FK → professional)
- `subject` (VARCHAR(150))
- `comment` (MEDIUMTEXT)
- `type` (INT, FK → type)
- `subject_type` (INT, FK → subject_type)
- `document_id` (INT, FK → document)
- `upload_file` (VARCHAR(500))
- `complete` (TINYINT)
- `share_url` (VARCHAR(250))
- `created_at`, `updated_at` (DATETIME)

**Foreign Keys**: 
- user_id → user(user_id)
- professional_id → professional(professional_id)
- type → type(type_id)
- subject_type → subject_type(subject_type_id)
- document_id → document(document_id)

#### 3.2.8 representative
**Purpose**: Customer companies/entities

**Columns**:
- `representative_id` (INT, PK, AUTO_INCREMENT)
- `original_name` (VARCHAR(245), UTF8MB4)
- `representative_name` (VARCHAR(245), UTF8MB4)
- `instances` (INT) - Occurrence count
- `parent_id` (INT) - Parent company (0 = root)
- `company_id` (BIGINT) - Links to shared db_uspto representative
- `child` (TINYINT) - Is child company (0/1)
- `type` (TINYINT) - 0=company, 1=group
- `mode` (TINYINT) - Mode flag (1=bank mode)
- `status` (TINYINT) - Active/inactive

**Indexes**:
- Primary key on `representative_id`
- Index on `company_id`
- Index on `representative_name`, `original_name`

**Critical**: Links customer-specific companies to global db_uspto.representative via `company_id`

#### 3.2.9 telephone
**Purpose**: Company phone numbers

**Columns**:
- `telephone_id` (INT, PK, AUTO_INCREMENT)
- `representative_id` (BIGINT, FK → representative)
- `telephone_number` (VARCHAR(50))
- `created_at`, `updated_at` (DATETIME)

**Foreign Keys**: representative_id → representative(representative_id)

#### 3.2.10 address
**Purpose**: Company addresses

**Columns**:
- `address_id` (INT, PK, AUTO_INCREMENT)
- `representative_id` (BIGINT, FK → representative)
- `street_address` (LONGTEXT)
- `suite` (TEXT)
- `city` (CHAR(50))
- `state` (CHAR(50))
- `zip_code` (VARCHAR(20))
- `country` (VARCHAR(20))
- `telephone` (VARCHAR(20))
- `telephone_2` (VARCHAR(20))
- `telephone_3` (VARCHAR(20))
- `created_at`, `updated_at` (DATETIME)

**Foreign Keys**: representative_id → representative(representative_id)

#### 3.2.11 comment
**Purpose**: Comments on activities

**Columns**:
- `comment_id` (INT, PK, AUTO_INCREMENT)
- `activity_id` (INT, FK → activity)
- `user_id` (INT, FK → user)
- `comment` (MEDIUMTEXT)
- `created_at`, `updated_at` (DATETIME)

**Foreign Keys**: 
- activity_id → activity(activity_id)
- user_id → user(user_id)

#### 3.2.12 collection
**Purpose**: Patent collections/portfolios

**Columns**:
- `collection_id` (INT, PK, AUTO_INCREMENT)
- `user_id` (INT, FK → user)
- `name` (VARCHAR(150))
- `created_at`, `updated_at` (DATETIME)

#### 3.2.13 collection_company
**Purpose**: Companies in collections

**Columns**:
- `collection_company_id` (INT, PK, AUTO_INCREMENT)
- `collection_id` (INT, FK → collection)
- `name` (VARCHAR(300))
- `instances` (INT)
- `created_at`, `updated_at` (DATETIME)

#### 3.2.14 collection_patent
**Purpose**: Patents in collections

**Columns**:
- `collection_patent_id` (INT, PK, AUTO_INCREMENT)
- `collection_id` (INT, FK → collection)
- `appno_doc_num` (VARCHAR(300))
- `grant_doc_num` (VARCHAR(300))
- `created_at`, `updated_at` (DATETIME)

#### 3.2.15 lawfirm
**Purpose**: Law firms

**Columns**:
- `lawfirm_id` (INT, PK, AUTO_INCREMENT)
- `name` (VARCHAR(300))
- `created_at`, `updated_at` (DATETIME)

#### 3.2.16 lawfirm_address
**Purpose**: Law firm addresses

**Columns**:
- `address_id` (INT, PK, AUTO_INCREMENT)
- `lawfirm_id` (INT, FK → lawfirm)
- `street_address` (LONGTEXT)
- `suite`, `city`, `state`, `country`, `zip_code` (VARCHAR)
- `telephone`, `telephone_2`, `telephone_3` (VARCHAR(20))
- `created_at`, `updated_at` (DATETIME)

#### 3.2.17 company_lawfirm
**Purpose**: Company-law firm relationships

**Columns**:
- `company_lawfirm_id` (INT, PK, AUTO_INCREMENT)
- `representative_id` (BIGINT, FK → representative)
- `lawfirm_id` (INT, FK → lawfirm)

#### 3.2.18 assets_channel
**Purpose**: Asset sharing/channel tracking

**Columns**:
- `id` (INT, PK, AUTO_INCREMENT)
- `asset` (VARCHAR(50))
- `channel_id` (VARCHAR(30))

---

### 3.3 Additional Customer DB Tables (create_db_on_run.php - Newer Version)

The newer customer provisioning script creates additional tables:

#### 3.3.19 assignees
**Purpose**: Customer-specific assignee cache

**Columns**:
- `assignee_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT)
- `assignor_and_assignee_id` (BIGINT)
- `name` (VARCHAR(245))

#### 3.3.20 assignments
**Purpose**: Customer-specific assignment cache

**Columns**:
- `assignment_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT, UNIQUE)
- `reel_no`, `frame_no` (VARCHAR)
- `record_dt` (DATE)

#### 3.3.21 assignment_conveyances
**Purpose**: Customer-specific conveyance cache

**Columns**:
- `conveyance_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT)
- `convey_ty` (VARCHAR)
- `employer_assign` (TINYINT)
- `exec_dt` (DATE)

#### 3.3.22 assignors
**Purpose**: Customer-specific assignor cache

**Columns**:
- `assignor_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT)
- `assignor_and_assignee_id` (BIGINT)
- `name` (VARCHAR(245))
- `exec_dt` (DATE)

#### 3.3.23 documentids
**Purpose**: Customer-specific document ID cache

**Columns**:
- `doc_id` (BIGINT, PK, AUTO_INCREMENT)
- `rf_id` (BIGINT)
- `appno_doc_num`, `grant_doc_num` (VARCHAR(20))
- `appno_date`, `grant_date` (DATE)

#### 3.3.24 folders
**Purpose**: Patent folder/project organization

**Columns**:
- `folder_id` (INT, PK, AUTO_INCREMENT)
- `name` (VARCHAR(150))
- `user_id` (INT, FK → user)
- `created_at`, `updated_at` (DATETIME)

#### 3.3.25 projects
**Purpose**: Patent projects

**Columns**:
- `project_id` (INT, PK, AUTO_INCREMENT)
- `name` (VARCHAR(150))
- `folder_id` (INT, FK → folders)
- `created_at`, `updated_at` (DATETIME)

#### 3.3.26 patents
**Purpose**: Patents in projects

**Columns**:
- `patent_id` (INT, PK, AUTO_INCREMENT)
- `project_id` (INT, FK → projects)
- `appno_doc_num`, `grant_doc_num` (VARCHAR(20))
- `created_at`, `updated_at` (DATETIME)

#### 3.3.27 comments
**Purpose**: Comments (alternate schema)

**Note**: Similar to `comment` table

#### 3.3.28 share_links
**Purpose**: Sharing links for patents/folders

**Columns**:
- `link_id` (INT, PK, AUTO_INCREMENT)
- `share_url` (VARCHAR(255), UNIQUE)
- `entity_type` (VARCHAR(50)) - 'folder', 'project', 'patent'
- `entity_id` (INT)
- `created_by` (INT, FK → user)
- `created_at`, `expires_at` (DATETIME)

#### 3.3.29 categories
**Purpose**: Product/service categories (newer feature)

**Columns**:
- `category_id` (INT, PK, AUTO_INCREMENT)
- `name` (VARCHAR(100))
- `created_at`, `updated_at` (DATETIME)

#### 3.3.30 products
**Purpose**: Products/services (newer feature)

**Columns**:
- `product_id` (INT, PK, AUTO_INCREMENT)
- `category_id` (INT, FK → categories)
- `name` (VARCHAR(150))
- `description` (TEXT)
- `created_at`, `updated_at` (DATETIME)

---

### 3.4 Data Population Process

**Source File**: `customer-data-migrator/create_data_for_company_db_application.php`

**Triggered**: After customer database creation or when adding new companies

**Process**:
```
1. Connect to db_business.organisation to get customer credentials
2. Connect to customer database using org_host, org_usr, org_pass, org_db
3. Query USPTO data for customer's companies:
   - Pull representative records matching customer companies
   - Get security transactions (security interests, releases)
   - Filter to patents with mode = 1 (bank mode)
4. Populate customer database:
   - DELETE existing company records from db_new_application
   - INSERT fresh representative data into db_new_application
   - UPDATE representative table with company_id linkage
5. Execute stored procedures (in db_uspto database):
   - routine_list1_new(company_id, org_id) - Generate company asset list
   - routine_list2_new(company_id, org_id) - Generate patent list
   - routine_tableA_new(company_id, org_id) - Calculate assets by category
   - routine_tableB_new(company_id, org_id) - Calculate transactions
   - routine_tableC_new(company_id, org_id) - Calculate ownership
   - routine_activities_parties_transactions_new(company_id, org_id) - Process transactions
6. Calculate dashboard items:
   - Owned assets (layout_id = 2)
   - Divested assets (layout_id = 3)
   - Abandoned assets (layout_id = 4)
   - Maintenance fee expired (layout_id = 11-14)
   - Broken chain assets (layout_id = 1)
7. INSERT into db_new_application.dashboard_items
```

**Key Queries**:

```sql
-- Get customer companies
SELECT representative_id, original_name, representative_name 
FROM representative 
WHERE mode = 1 
  AND company_id > 0

-- Pull USPTO security transactions
SELECT rf_id, reel_no, frame_no, exec_dt
FROM db_uspto.representative_assignment_conveyance
WHERE convey_ty IN ('security', 'release')
  AND representative_id IN ([company_ids])
```

---

## 4. Multi-Tenancy Architecture

### 4.1 Customer-to-Company Mapping

**Mapping Table**: `db_business.organisation`

**Links**:
```
db_business.organisation.organisation_id 
  → Customer database: db_<orgid><uniqid>
    → Customer representative table
      → representative.company_id 
        → db_uspto.representative.representative_id
          → Global USPTO data
```

**Flow**:
1. Customer signs up → row in `db_business.organisation`
2. System creates isolated database `db_<orgid><uniqid>`
3. Customer adds companies they want to track
4. System links customer companies to global USPTO entities via `company_id`
5. Data pipeline populates customer DB with filtered USPTO data

### 4.2 Data Isolation Mechanism

**Database-Level Isolation**:
- Each customer has completely separate database
- MySQL user permissions scoped to specific database
- No cross-customer queries possible

**Shared Data Access**:
- All customers query same `db_uspto` (read-only reference)
- All customers query same bibliographic databases
- Central `db_new_application` stores per-org filtered data

**Isolation Benefits**:
- Data security (customer A cannot see customer B data)
- Custom schema extensions per customer
- Independent backup/restore
- Simplified data export (entire database = customer data)

**Isolation Drawbacks**:
- Cannot efficiently query across all customers
- Database sprawl (100 customers = 100 databases)
- Harder to perform global analytics
- Migration complexity

### 4.3 Cross-Account Data Transfer

**Source File**: `customer-data-migrator/transferred_data_from_one_account_to_another_accounts.php`

**Purpose**: Transfer companies from one customer account to another

**Process**:
```
1. INPUT: Primary organization ID, comma-separated list of source organization IDs
2. FOR EACH source organization:
   a. Connect to source customer database
   b. Query all companies: SELECT * FROM representative WHERE company_id > 0
   c. Connect to primary customer database
   d. Create parent group record (type = 1) for source organization
   e. FOR EACH company in source:
      - INSERT into primary database representative table
      - Set parent_id = [group_id]
      - Set child = 1
      - Track company_id in array
   f. After all companies transferred:
      - Run add_representative_rfids.php to link patents
      - Run create_data_for_company_db_application.php to populate data
```

**Example**:
```
Organization 100 (primary) wants to track companies from:
- Organization 101 (subsidiary 1)
- Organization 102 (subsidiary 2)

Result:
db_<100>:
  representative (group, type=1, parent_id=0) "Subsidiary 1"
    ↓
    representative (company, type=0, parent_id=[group1], child=1) "Company A"
    representative (company, type=0, parent_id=[group1], child=1) "Company B"
  
  representative (group, type=1, parent_id=0) "Subsidiary 2"
    ↓
    representative (company, type=0, parent_id=[group2], child=1) "Company C"
```

**Use Case**: 
- Mergers/acquisitions (combine IP portfolios)
- Law firms managing multiple clients
- Corporate restructuring

### 4.4 Shared vs. Isolated Data

**Shared Data** (Read-Only Reference):
| Database | Type | Access |
|----------|------|--------|
| db_uspto | Shared | All customers query same data |
| db_patent_grant_bibliographic | Shared | All customers |
| db_patent_application_bibliographic | Shared | All customers |
| db_patent_maintainence_fee | Shared | All customers |

**Isolated Data** (Customer-Specific):
| Database | Type | Access |
|----------|------|--------|
| db_<orgid><uniqid> | Per-customer | Only that customer |
| db_new_application (partitioned) | Shared with org_id filter | Filtered per customer |

**Hybrid Data** (`db_new_application`):
- Shared database
- Data partitioned by `organisation_id` column
- All queries must include `WHERE organisation_id = [ID]`
- No database-level isolation (relies on application logic)

**Risk**: Application bug could expose cross-customer data in `db_new_application`

---

## 5. Database Relationships Map

### 5.1 Text Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     MASTER DATABASES                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌─────────────────┐              │
│  │ db_business  │         │   db_uspto      │              │
│  │              │         │                 │              │
│  │ organisation │────┐    │  assignment     │              │
│  │  - org_id    │    │    │  assignor       │              │
│  │  - org_db    │    │    │  assignee       │              │
│  │  - org_usr   │    │    │  assignor_and_  │              │
│  │  - org_pass  │    │    │    assignee     │              │
│  └──────────────┘    │    │  representative │              │
│                      │    │  documentid     │              │
│                      │    │  inventors      │              │
│                      │    │  tree           │              │
│                      │    └─────────────────┘              │
│                      │                                      │
│                      │    ┌─────────────────────────────┐  │
│                      │    │  db_new_application         │  │
│                      │    │                             │  │
│                      └───→│  assets (by org_id)         │  │
│                           │  assets_with_bank           │  │
│                           │  timeline (by org_id)       │  │
│                           │  summary (by org_id)        │  │
│                           │  activity_parties_trans     │  │
│                           │  dashboard_items            │  │
│                           └─────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  db_patent_grant_bibliographic                       │  │
│  │    inventor, application_publication                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  db_patent_application_bibliographic                 │  │
│  │    inventor, assignor_and_assignee                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  db_patent_maintainence_fee                          │  │
│  │    event_maintainence_fees                           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

                             │
                             │ credentials stored in organisation
                             │ (org_db, org_usr, org_pass)
                             ↓

┌─────────────────────────────────────────────────────────────┐
│              PER-CUSTOMER DATABASES (ISOLATED)               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  db_<org_id><uniqid>  (Customer Database)         │     │
│  │                                                     │     │
│  │  ┌───────────────┐    ┌───────────────┐           │     │
│  │  │ representative│    │ user          │           │     │
│  │  │  - rep_id     │    │  - user_id    │           │     │
│  │  │  - company_id ├───→│  - username   │           │     │
│  │  │  - parent_id  │    └───────┬───────┘           │     │
│  │  └───────┬───────┘            │                   │     │
│  │          │                    │                   │     │
│  │          ↓                    ↓                   │     │
│  │  ┌───────────────┐    ┌───────────────┐          │     │
│  │  │ address       │    │ activity      │          │     │
│  │  │ telephone     │    │  - subject    │          │     │
│  │  └───────────────┘    │  - comment    │          │     │
│  │                       └───────┬───────┘          │     │
│  │                               │                  │     │
│  │                               ↓                  │     │
│  │  ┌───────────────┐    ┌───────────────┐         │     │
│  │  │ collection    │    │ comment       │         │     │
│  │  │ collection_   │    │ document      │         │     │
│  │  │  company      │    │ professional  │         │     │
│  │  │ collection_   │    │ firm          │         │     │
│  │  │  patent       │    │ lawfirm       │         │     │
│  │  └───────────────┘    └───────────────┘         │     │
│  │                                                  │     │
│  │  [Newer databases also include:]                │     │
│  │  assignees, assignors, assignments,             │     │
│  │  assignment_conveyances, documentids,           │     │
│  │  folders, projects, patents, share_links,       │     │
│  │  categories, products                           │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  company_id ────────────────────────────────────────────┐ │
│                                                          │ │
└──────────────────────────────────────────────────────────┼─┘
                                                           │
                                                           │
                         Links to db_uspto.representative │
                                                           │
                                                           ↓
                                         ┌─────────────────────────┐
                                         │  GLOBAL USPTO DATA      │
                                         │  db_uspto.representative│
                                         │  → all assignments      │
                                         │  → all patents          │
                                         └─────────────────────────┘
```

### 5.2 Data Flow

**Ingestion → Master**:
```
USPTO APIs/Bulk Downloads
  → Parsing scripts (Session 1)
    → db_uspto (assignment, assignor, assignee, documentid)
      → Processing pipelines (Session 2)
        → db_new_application (assets, timeline, summary)
```

**Master → Customer**:
```
db_uspto.representative
  ↓
db_<orgid>.representative (company_id link)
  ↓
create_data_for_company_db_application.php
  ↓
db_new_application.assets (filtered by org_id)
db_new_application.timeline (filtered by org_id)
db_new_application.dashboard_items (filtered by org_id)
```

**Customer Queries**:
```
User logs into customer portal
  ↓
Application connects to db_<orgid> using credentials from db_business.organisation
  ↓
User queries customer-specific data (representative, activity, collection)
  +
User queries shared data (db_uspto via company_id joins)
  ↓
Combined result set returned to user
```

### 5.3 Cross-Database Queries

**Common Pattern**:
```sql
-- Join customer database to global USPTO data
SELECT 
  cust_rep.representative_name,
  COUNT(doc.appno_doc_num) as patent_count
FROM db_<orgid>.representative as cust_rep
INNER JOIN db_uspto.representative as uspto_rep 
  ON cust_rep.company_id = uspto_rep.representative_id
INNER JOIN db_uspto.assignor_and_assignee as aaa 
  ON aaa.representative_id = uspto_rep.representative_id
INNER JOIN db_uspto.assignee as aee 
  ON aee.assignor_and_assignee_id = aaa.assignor_and_assignee_id
INNER JOIN db_uspto.documentid as doc 
  ON doc.rf_id = aee.rf_id
WHERE cust_rep.status = 1
GROUP BY cust_rep.representative_id
```

**Performance Consideration**: Cross-database joins are expensive, especially when customer database is on different host

---

## 6. Key Observations & Risks

### 6.1 Schema Design Observations

**Strengths**:
1. **Clear separation** between master USPTO data and customer data
2. **Normalization** via `assignor_and_assignee` master table reduces duplication
3. **Audit trails** via created_at/updated_at timestamps
4. **Flexible hierarchy** via parent_id in representative table
5. **Multi-tenant isolation** via separate databases per customer

**Weaknesses**:
1. **No foreign key constraints** between databases (referential integrity risk)
2. **Duplicate table structures** across customer databases (schema evolution nightmare)
3. **No versioning** of customer database schemas
4. **Mixed encodings** (UTF8MB4 vs. default charset)
5. **Inconsistent naming** (representative_id vs. rep_id, organisation vs. organization)

### 6.2 Data Integrity Risks

1. **Orphaned Records**: 
   - Customer representative.company_id could reference deleted db_uspto.representative_id
   - No CASCADE DELETE

2. **Data Sync Issues**:
   - Customer database could become out-of-sync with master
   - No automated sync mechanism
   - Manual re-run of create_data_for_company_db_application.php required

3. **Temp Table Cleanup**:
   - temp_* tables not always cleaned up
   - Could grow large over time

4. **Encoding Issues**:
   - UTF8MB4 for some name fields
   - Default charset for others
   - Could cause data corruption on non-ASCII names

### 6.3 Security Observations

**Positive**:
1. Database-level isolation prevents cross-customer data leaks
2. Separate database users per customer
3. Encryption of passwords in newer version (AES-128-ECB)

**Risks**:
1. **Plaintext passwords** in older script_create_customer_db.php
2. **Weak encryption**: AES-128-ECB (no IV, deterministic)
3. **Credentials stored in database**: db_business.organisation contains all customer DB passwords
4. **No rotation**: No evidence of password rotation mechanism
5. **Broad permissions**: GRANT ALL PRIVILEGES (should be restricted)

### 6.4 Scalability Concerns

1. **Database Sprawl**: 
   - 1000 customers = 1000 databases
   - Hard to manage, backup, monitor

2. **Connection Pool Exhaustion**:
   - Each customer query opens new connection
   - No connection pooling evident

3. **Cross-Database Joins**:
   - Expensive, cannot use indexes across databases
   - Performance degrades as customer databases grow

4. **Schema Migration**:
   - Updating 1000 customer databases requires 1000 ALTER TABLE statements
   - No migration framework evident

### 6.5 Maintainability Risks

1. **No ORM**: 
   - Raw SQL embedded in PHP
   - Hard to refactor

2. **No Migration Framework**:
   - Schema changes require manual ALTER TABLE scripts
   - Version tracking unclear

3. **Duplicate Schemas**:
   - 1000 customer databases with same schema
   - Need to keep all in sync

4. **No Documentation**:
   - Table purposes inferred from code
   - No ER diagrams or schema docs

### 6.6 Migration Recommendations for PatenTrack3

1. **Adopt Row-Level Multi-Tenancy**:
   - Single shared database with org_id partition key
   - Use Row-Level Security (PostgreSQL) or Views (MySQL)
   - Easier to manage, better performance

2. **Use ORM/Query Builder**:
   - Prisma, TypeORM, or Sequelize
   - Typed schema, automatic migrations
   - Prevents SQL injection

3. **Implement Proper Foreign Keys**:
   - Enforce referential integrity
   - CASCADE DELETE where appropriate

4. **Encrypt Sensitive Data**:
   - Use AES-256-GCM (authenticated encryption)
   - Store encryption keys in secrets manager (not database)

5. **Add Schema Versioning**:
   - Track schema version per customer
   - Automated migration runner
   - Flyway or similar

6. **Use Connection Pooling**:
   - PgBouncer (PostgreSQL) or ProxySQL (MySQL)
   - Reduce connection overhead

7. **Implement Soft Deletes**:
   - Add `deleted_at` column
   - Preserve audit trail

8. **Add Composite Indexes**:
   - (organisation_id, company_id, created_at) for common queries
   - Analyze slow query log

9. **Consider Time-Series Database**:
   - Timeline/event data could use TimescaleDB
   - Better performance for time-range queries

10. **Document Schema**:
    - Generate ER diagrams automatically
    - Use tools like dbdiagram.io or Prisma Studio
    - Keep documentation in Git

### 6.7 Critical Dependencies

**Stored Procedures** (referenced but not analyzed):
- `routine_transaction(company_id, org_id)`
- `routine_list1_new(company_id, org_id)`
- `routine_list2_new(company_id, org_id)`
- `routine_tableA_new(company_id, org_id)`
- `routine_tableB_new(company_id, org_id)`
- `routine_tableC_new(company_id, org_id)`
- `routine_activities_parties_transactions_new(company_id, org_id)`
- `GetAssetsTableC(company_id, org_id)`

**Note**: These stored procedures are critical to the data population process and require separate analysis.

### 6.8 Positive Observations

1. **Clean tenant isolation** prevents data leaks
2. **Hierarchical company structure** supports complex corporate relationships
3. **Audit timestamps** on most tables
4. **UTF8MB4 support** for international names
5. **Flexible activity system** supports custom workflows
6. **Collection/folder system** for organization
7. **Professional/firm tracking** for law firm integration

---

## 7. Summary

The PatenTrack database architecture implements a **multi-tenant model with isolated per-customer databases** backed by shared USPTO master data. This provides strong data isolation but creates operational complexity at scale.

**Database Count**: 8 shared databases + N customer databases (where N = number of customers)

**Total Table Count**: ~30 tables in shared databases + ~30 tables per customer database

**Critical Tables**:
- `db_business.organisation` - Customer registry
- `db_uspto.assignor_and_assignee` - Entity deduplication
- `db_uspto.representative_assignment_conveyance` - Transaction classification
- `db_new_application.assets` - Customer patent portfolios
- `db_<orgid>.representative` - Customer companies linked to global data

**Key Insight**: The system trades operational complexity (many databases) for data security (strong isolation). PatenTrack3 should consider row-level multi-tenancy for improved scalability while maintaining security.
