# PatenTrack Database Schema Analysis

**Note:** This document analyzes the database architecture supporting the processing pipelines described in [`02-processing-pipelines.md`](./02-processing-pipelines.md). For data sources, see [`01-data-sources-and-ingestion.md`](./01-data-sources-and-ingestion.md).

## Architecture Overview

PatenTrack uses a **database-per-tenant** multi-tenancy architecture:

- **Shared master databases:** USPTO patent/assignment data, cross-tenant lookups
- **Per-customer databases:** Isolated company-specific data, users, activities
- **Credential storage:** `db_business.organisation` table stores per-tenant DB credentials
- **Data partitioning:** Customer data completely isolated, no cross-tenant queries possible

## Master Databases

### 1. `db_uspto` — Core Patent Assignment Data

The central database containing all USPTO patent assignment records and derived data.

#### Core Assignment Tables

**`assignment`** — Assignment document header
```sql
CREATE TABLE assignment (
    rf_id VARCHAR(20) PRIMARY KEY,     -- Reel-Frame ID (unique document identifier)
    reel_no VARCHAR(10),                -- Reel number
    frame_no VARCHAR(10),               -- Frame number
    convey_text TEXT,                   -- Original conveyance description text
    record_dt DATE,                     -- Recording date at USPTO
    cname VARCHAR(255),                 -- Correspondent/attorney name
    caddress_1 VARCHAR(255),            -- Correspondent address line 1
    caddress_2 VARCHAR(255),            -- Correspondent address line 2
    caddress_3 VARCHAR(255),            -- Correspondent address line 3
    page_count INT,                     -- Number of pages in document
    status VARCHAR(50),                 -- Processing status
    INDEX idx_reel_frame (reel_no, frame_no),
    INDEX idx_record_dt (record_dt)
);
```

**`assignor`** — Assignment grantors (sellers/transferors)
```sql
CREATE TABLE assignor (
    rf_id VARCHAR(20),                  -- Links to assignment.rf_id
    assignor_and_assignee_id INT,       -- Links to assignor_and_assignee table
    exec_dt DATE,                       -- Execution date
    or_name VARCHAR(255),               -- Original assignor name (raw)
    INDEX idx_rf_id (rf_id),
    INDEX idx_assignor_and_assignee_id (assignor_and_assignee_id),
    FOREIGN KEY (rf_id) REFERENCES assignment(rf_id)
);
```

**`assignee`** — Assignment grantees (buyers/receivers)
```sql
CREATE TABLE assignee (
    rf_id VARCHAR(20),                  -- Links to assignment.rf_id
    assignor_and_assignee_id INT,       -- Links to assignor_and_assignee table
    ee_name VARCHAR(255),               -- Assignee name
    ee_address_1 VARCHAR(255),          -- Assignee address line 1
    ee_address_2 VARCHAR(255),          -- Assignee address line 2
    ee_city VARCHAR(100),               -- City
    ee_state VARCHAR(50),               -- State/province
    ee_postcode VARCHAR(20),            -- Postal code
    ee_country VARCHAR(100),            -- Country
    INDEX idx_rf_id (rf_id),
    INDEX idx_assignor_and_assignee_id (assignor_and_assignee_id),
    FOREIGN KEY (rf_id) REFERENCES assignment(rf_id)
);
```

#### Name Normalization Tables

**`assignor_and_assignee`** — Unified entity table with normalization
```sql
CREATE TABLE assignor_and_assignee (
    assignor_and_assignee_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),                  -- Normalized entity name
    instances INT DEFAULT 0,            -- Occurrence count
    representative_id INT,              -- Links to representative (canonical name)
    INDEX idx_name (name),
    INDEX idx_representative_id (representative_id)
);
```

**`representative`** — Canonical entity names
```sql
CREATE TABLE representative (
    representative_id INT PRIMARY KEY AUTO_INCREMENT,
    representative_name VARCHAR(255),   -- Canonical/standardized name
    INDEX idx_representative_name (representative_name)
);
```

**`company_temp`** — Temporary company name storage during normalization
```sql
CREATE TABLE company_temp (
    name VARCHAR(255),
    instances INT,
    INDEX idx_name (name)
);
```

#### Transaction Classification Tables

**`assignment_conveyance`** — Transaction type classification (primary)
```sql
CREATE TABLE assignment_conveyance (
    rf_id VARCHAR(20) PRIMARY KEY,
    convey_ty VARCHAR(50),              -- Transaction type: 'assignment', 'security', etc.
    employer_assign TINYINT DEFAULT 0,  -- 1 = inventor-to-employer assignment
    INDEX idx_convey_ty (convey_ty),
    FOREIGN KEY (rf_id) REFERENCES assignment(rf_id)
);
```

**`representative_assignment_conveyance`** — Transaction classification linked to representatives
```sql
CREATE TABLE representative_assignment_conveyance (
    rf_id VARCHAR(20),
    convey_ty VARCHAR(50),
    employer_assign TINYINT DEFAULT 0,
    INDEX idx_rf_id (rf_id),
    INDEX idx_convey_ty (convey_ty)
);
```

#### Document Linkage

**`documentid`** — Links assignments to patent applications/grants
```sql
CREATE TABLE documentid (
    rf_id VARCHAR(20),                  -- Links to assignment.rf_id
    title TEXT,                         -- Patent title
    appno_doc_num VARCHAR(20),          -- Application number (e.g., "12/345,678")
    appno_date DATE,                    -- Application filing date
    grant_doc_num VARCHAR(20),          -- Grant/publication number (e.g., "US1234567")
    grant_date DATE,                    -- Grant/publication date
    pgpub_doc_num VARCHAR(20),          -- Publication number (if different)
    INDEX idx_rf_id (rf_id),
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_grant_doc_num (grant_doc_num),
    FOREIGN KEY (rf_id) REFERENCES assignment(rf_id)
);
```

#### Supporting Tables

**`correspondent`** — Attorney/agent information
```sql
CREATE TABLE correspondent (
    rf_id VARCHAR(20),
    cname VARCHAR(255),                 -- Correspondent/law firm name
    INDEX idx_rf_id (rf_id),
    INDEX idx_cname (cname)
);
```

**`law_firm`** — Law firm master list
```sql
CREATE TABLE law_firm (
    law_firm_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),
    INDEX idx_name (name)
);
```

**`assignment_arrows`** — Visualization connection counts
```sql
CREATE TABLE assignment_arrows (
    rf_id VARCHAR(20),
    arrows INT,                         -- Number of visual connections for this transaction
    INDEX idx_rf_id (rf_id)
);
```

#### CPC Classification Tables

**`patent_cpc`** — CPC codes for granted patents
```sql
CREATE TABLE patent_cpc (
    grant_doc_num VARCHAR(20),
    cpc_code VARCHAR(50),               -- CPC classification code
    cpc_level VARCHAR(10),              -- Classification level (section, class, subclass, etc.)
    INDEX idx_grant_doc_num (grant_doc_num),
    INDEX idx_cpc_code (cpc_code)
);
```

**`application_cpc`** — CPC codes for applications
```sql
CREATE TABLE application_cpc (
    appno_doc_num VARCHAR(20),
    cpc_code VARCHAR(50),
    cpc_level VARCHAR(10),
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_cpc_code (cpc_code)
);
```

#### Bank/Security Interest Tables

**`bank_security_transactions`** — Security interests with bank entities
```sql
CREATE TABLE bank_security_transactions (
    rf_id VARCHAR(20),
    appno_doc_num VARCHAR(20),
    grant_doc_num VARCHAR(20),
    assignor_id INT,
    assignee_id INT,                    -- Bank entity ID
    record_dt DATE,
    INDEX idx_rf_id (rf_id),
    INDEX idx_assignee_id (assignee_id)
);
```

**`bank_release_transactions`** — Releases of security interests
```sql
CREATE TABLE bank_release_transactions (
    rf_id VARCHAR(20),                  -- Release transaction rf_id
    release_rf_id VARCHAR(20),          -- Original security rf_id being released
    appno_doc_num VARCHAR(20),
    grant_doc_num VARCHAR(20),
    record_dt DATE,
    INDEX idx_rf_id (rf_id),
    INDEX idx_release_rf_id (release_rf_id)
);
```

#### Status Tracking

**`application_status`** — Patent prosecution status data
```sql
CREATE TABLE application_status (
    appno_doc_num VARCHAR(20),
    status_code VARCHAR(50),
    status_date DATE,
    INDEX idx_appno_doc_num (appno_doc_num)
);
```

**`download_tracking`** — Data ingestion tracking
```sql
CREATE TABLE download_tracking (
    download_id INT PRIMARY KEY AUTO_INCREMENT,
    data_source VARCHAR(100),           -- 'PASDL', 'RedBook', etc.
    download_date DATE,
    file_name VARCHAR(255),
    status VARCHAR(50),
    INDEX idx_data_source (data_source),
    INDEX idx_download_date (download_date)
);
```

### 2. `db_business` — Organization/Customer Management

**`organisation`** — Customer account master table
```sql
CREATE TABLE organisation (
    organisation_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),                  -- Organization name
    representative_name VARCHAR(255),    -- Default representative name
    
    -- Per-tenant database credentials
    org_host VARCHAR(100),              -- Database host (e.g., 'localhost', '167.172.195.92')
    org_usr VARCHAR(100),               -- Database username (unique per org)
    org_pass VARCHAR(255),              -- Database password
    org_db VARCHAR(100),                -- Database name (e.g., 'db_123abc456')
    org_key VARCHAR(255),               -- API key (currently unused)
    
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_name (name),
    INDEX idx_org_db (org_db)
);
```

**Credential Generation Pattern:**
```php
// From script_create_customer_db.php
$org_db = 'db_' . $organisationID . uniqid();     // e.g., 'db_1234abc567def'
$org_usr = uniqid();                              // e.g., 'abc123def456'
$org_pass = strtoupper(chr(rand(65,90))) . '!' . uniqid();  // e.g., 'M!abc123def'
```

### 3. `db_new_application` — Application-Level Data

Customer-shared application and asset tracking database.

**`assets`** — Patent assets assigned to customers
```sql
CREATE TABLE assets (
    appno_doc_num VARCHAR(20),          -- Application number
    appno_date DATE,                    -- Application filing date
    grant_doc_num VARCHAR(20),          -- Grant number
    grant_date DATE,                    -- Grant date
    layout_id INT,                      -- Layout type (15 = standard)
    company_id INT,                     -- Customer company ID (links to per-customer DB)
    organisation_id INT,                -- Organization ID
    
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_grant_doc_num (grant_doc_num),
    INDEX idx_company_id (company_id),
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_layout_id (layout_id)
);
```

**`assets_with_bank`** — Assets with bank security interests
```sql
CREATE TABLE assets_with_bank (
    appno_doc_num VARCHAR(20),
    grant_doc_num VARCHAR(20),
    company_id INT,
    organisation_id INT,
    bank_rf_id VARCHAR(20),             -- Security interest rf_id
    
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_company_id (company_id),
    INDEX idx_bank_rf_id (bank_rf_id)
);
```

**`dashboard_items`** — Dashboard data elements
```sql
CREATE TABLE dashboard_items (
    organisation_id INT,
    representative_id INT,
    assignor_id INT,
    type INT,                           -- Item type (0=complete chain, 1=broken, 18=encumbrance, etc.)
    patent VARCHAR(20),                 -- Grant number
    application VARCHAR(20),            -- Application number
    rf_id VARCHAR(20),                  -- Transaction rf_id
    total INT,
    lawfirm VARCHAR(255),
    lawfirm_id INT,
    
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_representative_id (representative_id),
    INDEX idx_type (type)
);
```

**Dashboard item types:**
- 0 = Chain of Title (complete)
- 1 = Broken Chain of Title
- 18 = Encumbrances
- 20 = Law Firms
- 28+ = Various asset categorizations
- 30, 33, 35, 36 = Bank-related asset types
- 31 = Unassigned assets
- 34 = Additional counts
- 37 = Special counts

**`dashboard_items_count`** — Aggregated dashboard counts
```sql
CREATE TABLE dashboard_items_count (
    number INT,
    other_number INT,
    total INT,
    organisation_id INT,
    representative_id INT,
    assignor_id INT,
    type INT,                           -- Matches dashboard_items.type
    other VARCHAR(255),
    
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_type (type)
);
```

**`activity_parties_transactions`** — Third-party activity tracking
```sql
CREATE TABLE activity_parties_transactions (
    rf_id VARCHAR(20),
    organisation_id INT,
    company_id INT,
    activity_id INT,                    -- Activity type (5=security, 6=release, etc.)
    recorded_assignor_and_assignee_id INT,  -- Entity ID
    release_rf_id VARCHAR(20),          -- For releases, the original security rf_id
    
    INDEX idx_rf_id (rf_id),
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_company_id (company_id),
    INDEX idx_activity_id (activity_id)
);
```

**`tree`** — Ownership tree nodes
```sql
CREATE TABLE tree (
    assignor_and_assignee_id INT,
    name VARCHAR(255),
    parent INT,                         -- Parent node ID (0 = root)
    type INT,                           -- Tree node type (see processing pipelines doc)
    tab INT,                            -- UI tab grouping
    organisation_id INT,
    representative_id INT,
    
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_representative_id (representative_id),
    INDEX idx_parent (parent),
    INDEX idx_type (type)
);
```

**`tree_parties`** — Third-party tree relationships
```sql
CREATE TABLE tree_parties (
    tree_id INT,
    assignor_and_assignee_id INT,
    rf_id VARCHAR(20),
    organisation_id INT,
    
    INDEX idx_tree_id (tree_id),
    INDEX idx_organisation_id (organisation_id)
);
```

**`tree_parties_collection`** — Party groupings
```sql
CREATE TABLE tree_parties_collection (
    collection_id INT,
    tree_id INT,
    assignor_and_assignee_id INT,
    organisation_id INT,
    
    INDEX idx_collection_id (collection_id),
    INDEX idx_tree_id (tree_id)
);
```

**`timeline`** — Chronological transaction timeline
```sql
CREATE TABLE timeline (
    rf_id VARCHAR(20),
    reel_no VARCHAR(10),
    frame_no VARCHAR(10),
    record_dt DATE,
    organisation_id INT,
    representative_id INT,
    type ENUM('Assignor', 'Assignee'),  -- Entity's role in transaction
    original_name VARCHAR(255),
    assignor_and_assignee_id INT,
    exec_dt DATE,                       -- Execution date
    convey_ty VARCHAR(50),              -- Transaction type
    employer_assign TINYINT,
    
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_representative_id (representative_id),
    INDEX idx_record_dt (record_dt)
);
```

**`lost_assets`** — Assets with unclear ownership
```sql
CREATE TABLE lost_assets (
    appno_doc_num VARCHAR(20),
    grant_doc_num VARCHAR(20),
    company_id INT,
    organisation_id INT,
    reason TEXT,
    
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_organisation_id (organisation_id)
);
```

**`summary`** — Portfolio statistics
```sql
CREATE TABLE summary (
    organisation_id INT,
    company_id INT,                     -- 0 = org-level summary
    companies INT,                      -- Count of companies
    activities INT,                     -- Count of activity types
    entities INT,                       -- Count of 3rd party entities
    parties INT,                        -- Count of recorded parties
    employees INT,                      -- Count of employee transactions/inventors
    transactions INT,                   -- Count of transactions
    assets INT,                         -- Count of assets
    arrows INT,                         -- Count of visualization arrows
    
    PRIMARY KEY (organisation_id, company_id),
    INDEX idx_organisation_id (organisation_id)
);
```

**`conveyance`** — Conveyance type master list with OTA flag
```sql
CREATE TABLE conveyance (
    convey_name VARCHAR(50) PRIMARY KEY,
    is_ota TINYINT DEFAULT 0,           -- 1 = Ownership Transfer Assignment
    description TEXT
);
```

**`log_update_company`** — Update audit log
```sql
CREATE TABLE log_update_company (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    organisation_id INT,
    company_id INT,
    update_type VARCHAR(100),
    update_timestamp DATETIME,
    
    INDEX idx_organisation_id (organisation_id),
    INDEX idx_update_timestamp (update_timestamp)
);
```

**`log_messages`** — General message log
```sql
CREATE TABLE log_messages (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    message TEXT,
    severity VARCHAR(20),
    timestamp DATETIME,
    
    INDEX idx_timestamp (timestamp)
);
```

### 4. `db_patent_grant_bibliographic` — Grant Data

**`grant_application`** — Grant-to-application mapping
```sql
CREATE TABLE grant_application (
    grant_doc_num VARCHAR(20),
    appno_doc_num VARCHAR(20),
    appno_date DATE,
    grant_date DATE,
    
    INDEX idx_grant_doc_num (grant_doc_num),
    INDEX idx_appno_doc_num (appno_doc_num)
);
```

**`inventor`** — Inventor names from grants
```sql
CREATE TABLE inventor (
    grant_doc_num VARCHAR(20),
    appno_doc_num VARCHAR(20),          -- Also stores application number
    name VARCHAR(255),                  -- Inventor name (raw)
    sequence INT,                       -- Inventor order
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(100),
    
    INDEX idx_grant_doc_num (grant_doc_num),
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_name (name)
);
```

**`assignee_grant`** — Original assignees from grant documents
```sql
CREATE TABLE assignee_grant (
    grant_doc_num VARCHAR(20),
    name VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(100),
    
    INDEX idx_grant_doc_num (grant_doc_num),
    INDEX idx_name (name)
);
```

**Additional biblio tables:** `examiner`, `claims`, `classifications`, `citations`, etc.

### 5. `db_patent_application_bibliographic` — Application Data

**`inventor`** — Inventor names from applications
```sql
CREATE TABLE inventor (
    appno_doc_num VARCHAR(20),
    name VARCHAR(255),
    sequence INT,
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(100),
    
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_name (name)
);
```

**`assignee`** — Original assignees from applications
```sql
CREATE TABLE assignee (
    appno_doc_num VARCHAR(20),
    name VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(100),
    
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_name (name)
);
```

**`applicant`** — Applicants (AIA post-2012)
```sql
CREATE TABLE applicant (
    appno_doc_num VARCHAR(20),
    name VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    country VARCHAR(100),
    applicant_type VARCHAR(50),         -- 'inventor', 'assignee', etc.
    
    INDEX idx_appno_doc_num (appno_doc_num),
    INDEX idx_name (name)
);
```

### 6. `db_patent_maintainence_fee` — Maintenance Fee Events

**`event_maintainence_fees`** — Fee payment events
```sql
CREATE TABLE event_maintainence_fees (
    grant_doc_num VARCHAR(20),
    event_code VARCHAR(10),             -- Fee event code
    event_date DATE,
    fee_amount DECIMAL(10,2),
    
    INDEX idx_grant_doc_num (grant_doc_num),
    INDEX idx_event_code (event_code),
    INDEX idx_event_date (event_date)
);
```

### 7. `db_inventor` — Inventor Database

Separate inventor master database (different host in some deployments).

**`inventors`** — Canonical inventor records
```sql
CREATE TABLE inventors (
    inventor_id INT PRIMARY KEY AUTO_INCREMENT,
    assignor_and_assignee_id INT,       -- Links to db_uspto.assignor_and_assignee
    name VARCHAR(255),
    canonical_name VARCHAR(255),
    
    INDEX idx_assignor_and_assignee_id (assignor_and_assignee_id),
    INDEX idx_name (name)
);
```

### 8. `big_data` — Secondary/Archive Database

Used for archival storage and secondary data. Schema varies by deployment.

## Per-Customer Database Schema

Each customer organization receives a dedicated MySQL database with isolated tables.

### Database Provisioning Process

**From `script_create_customer_db.php`:**

```php
// 1. Generate unique identifiers
$org_db = 'db_' . $organisationID . uniqid();
$org_usr = uniqid();
$org_pass = strtoupper(chr(rand(65,90))) . '!' . uniqid();
$org_host = getenv('DB_HOST');  // Typically 'localhost' or specific DB server

// 2. Create database and user
$con->query("CREATE DATABASE " . $org_db);
$con->query("CREATE USER '" . $org_usr . "'@'%' IDENTIFIED BY '" . $org_pass . "'");
$con->query("GRANT ALL PRIVILEGES ON " . $org_db . ".* TO '" . $org_usr . "'@'%'");
$con->query("FLUSH PRIVILEGES");

// 3. Store credentials in db_business.organisation
$queryUpdate = "UPDATE db_business.organisation 
                SET org_key='', org_pass='{$org_pass}', 
                    org_host='{$org_host}', org_db='{$org_db}', org_usr='{$org_usr}'
                WHERE organisation_id = {$organisationID}";

// 4. Create customer-specific tables (see below)

// 5. Seed lookup tables
$con->query("INSERT INTO type (type_id, name) VALUES
    (1, 'fix'), (2, 'record'), (3, 'asset'), (4, 'transaction'),
    (5, 'customer'), (6, 'company'), (7, 'error')");

$con->query("INSERT INTO subject_type (subject_type_id, subject_name) VALUES
    (1, 'Fix'), (2, 'Record'), (3, 'Asset'), (4, 'Transaction'),
    (5, 'Customer'), (6, 'Company'), (7, 'Error')");
```

### Customer-Specific Tables

#### Reference Data

**`subject_type`** — Activity subject types
```sql
CREATE TABLE subject_type (
    subject_type_id INT PRIMARY KEY AUTO_INCREMENT,
    subject_name VARCHAR(45),
    
    INDEX idx_subject_name (subject_name)
);
```

**`type`** — Activity types
```sql
CREATE TABLE type (
    type_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(30),
    
    INDEX idx_name (name)
);
```

#### Professional Network

**`firm`** — Law firms and professional services firms
```sql
CREATE TABLE firm (
    firm_id INT PRIMARY KEY AUTO_INCREMENT,
    firm_name VARCHAR(250),
    firm_logo VARCHAR(500),             -- Logo file path
    firm_linkedin_url VARCHAR(500),
    
    INDEX idx_firm_name (firm_name)
);
```

**`professional`** — Individual professionals
```sql
CREATE TABLE professional (
    professional_id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(75),
    last_name VARCHAR(75),
    email_address VARCHAR(255),
    telephone VARCHAR(15),
    telephone1 VARCHAR(15),             -- Alternate phone
    linkedin_url VARCHAR(500),
    profile_logo VARCHAR(500),
    firm_id INT,
    type TINYINT DEFAULT 0,             -- Professional type
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_firm_id (firm_id),
    INDEX idx_email_address (email_address),
    FOREIGN KEY (firm_id) REFERENCES firm(firm_id)
);
```

#### User Management

**`user`** — Customer users
```sql
CREATE TABLE user (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    username VARCHAR(255) NOT NULL,
    email_address VARCHAR(255),
    linkedin_url VARCHAR(255),
    job_title VARCHAR(300),
    telephone VARCHAR(15),
    telephone1 VARCHAR(15),
    logo VARCHAR(255),                  -- Profile picture
    status TINYINT DEFAULT 0,           -- 0=inactive, 1=active
    created_at DATETIME,
    updated_at DATETIME,
    role_id INT DEFAULT 0,
    
    UNIQUE INDEX idx_username (username),
    INDEX idx_email_address (email_address),
    INDEX idx_status (status)
);
```

#### Document Management

**`document`** — Uploaded documents
```sql
CREATE TABLE document (
    document_id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(300),
    file VARCHAR(500),                  -- File path
    type TINYINT DEFAULT 0,             -- Document type
    description TEXT,
    user_id BIGINT,
    created_at DATETIME,
    updated_at DATETIME,
    status TINYINT DEFAULT 0,
    
    INDEX idx_user_id (user_id),
    INDEX idx_type (type)
);
```

#### Activity Tracking

**`activity`** — User activities and notes
```sql
CREATE TABLE activity (
    activity_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    professional_id INT,
    subject VARCHAR(150),
    comment MEDIUMTEXT,
    type INT,                           -- Activity type
    subject_type INT,                   -- Subject type
    document_id INT,
    upload_file VARCHAR(500),
    complete TINYINT DEFAULT 0,         -- 0=incomplete, 1=complete
    share_url VARCHAR(250),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_user_id (user_id),
    INDEX idx_professional_id (professional_id),
    INDEX idx_type (type),
    INDEX idx_subject_type (subject_type),
    INDEX idx_document_id (document_id),
    
    FOREIGN KEY (user_id) REFERENCES user(user_id),
    FOREIGN KEY (professional_id) REFERENCES professional(professional_id),
    FOREIGN KEY (type) REFERENCES type(type_id),
    FOREIGN KEY (subject_type) REFERENCES subject_type(subject_type_id),
    FOREIGN KEY (document_id) REFERENCES document(document_id)
);
```

**`comment`** — Activity comments
```sql
CREATE TABLE comment (
    comment_id INT PRIMARY KEY AUTO_INCREMENT,
    activity_id INT,
    user_id INT,
    comment MEDIUMTEXT,
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_activity_id (activity_id),
    INDEX idx_user_id (user_id)
);
```

#### Company/Representative Management

**`representative`** — Customer's company portfolio
```sql
CREATE TABLE representative (
    representative_id INT PRIMARY KEY AUTO_INCREMENT,
    original_name VARCHAR(245) CHARACTER SET utf8mb4,    -- Original USPTO name
    representative_name VARCHAR(245) CHARACTER SET utf8mb4,  -- Normalized/canonical name
    instances INT,                      -- Occurrence count
    parent_id INT DEFAULT 0,            -- Parent group ID (0 = root)
    company_id BIGINT DEFAULT 0,
    child TINYINT DEFAULT 0,            -- 1 = is a child company
    type TINYINT DEFAULT 0,             -- 0 = company, 1 = group
    mode TINYINT DEFAULT 0,
    status TINYINT DEFAULT 1,           -- 1 = active, 0 = inactive
    
    INDEX idx_company_id (company_id),
    INDEX idx_representative_name (representative_name),
    INDEX idx_original_name (original_name),
    INDEX idx_parent_id (parent_id),
    INDEX idx_type (type)
);
```

**Company hierarchy:**
- `type = 0`, `parent_id = 0`: Root company
- `type = 1`, `parent_id = 0`: Company group
- `type = 0`, `parent_id > 0`: Child company in group

**`telephone`** — Company phone numbers
```sql
CREATE TABLE telephone (
    telephone_id INT PRIMARY KEY AUTO_INCREMENT,
    representative_id BIGINT,
    telephone_number VARCHAR(50),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_representative_id (representative_id)
);
```

**`address`** — Company addresses
```sql
CREATE TABLE address (
    address_id INT PRIMARY KEY AUTO_INCREMENT,
    representative_id BIGINT,
    street_address LONGTEXT,
    suite TEXT,
    city CHAR(50),
    state CHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(20),
    telephone VARCHAR(20),
    telephone_2 VARCHAR(20),
    telephone_3 VARCHAR(20),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_representative_id (representative_id)
);
```

#### Law Firm Management

**`lawfirm`** — Customer-tracked law firms
```sql
CREATE TABLE lawfirm (
    lawfirm_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(300),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_name (name)
);
```

**`lawfirm_address`** — Law firm addresses
```sql
CREATE TABLE lawfirm_address (
    address_id INT PRIMARY KEY AUTO_INCREMENT,
    lawfirm_id INT,
    street_address LONGTEXT,
    suite TEXT,
    city CHAR(50),
    state CHAR(50),
    country CHAR(50),
    zip_code VARCHAR(20),
    telephone VARCHAR(20),
    telephone_2 VARCHAR(20),
    telephone_3 VARCHAR(20),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_lawfirm_id (lawfirm_id)
);
```

**`company_lawfirm`** — Company-law firm relationships
```sql
CREATE TABLE company_lawfirm (
    company_lawfirm_id INT PRIMARY KEY AUTO_INCREMENT,
    representative_id BIGINT,
    lawfirm_id INT,
    
    INDEX idx_representative_id (representative_id),
    INDEX idx_lawfirm_id (lawfirm_id)
);
```

#### Collections

**`collection`** — User-defined collections/portfolios
```sql
CREATE TABLE collection (
    collection_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    name VARCHAR(150),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_user_id (user_id)
);
```

**`collection_company`** — Companies in collections
```sql
CREATE TABLE collection_company (
    collection_company_id INT PRIMARY KEY AUTO_INCREMENT,
    collection_id INT,
    name VARCHAR(300),
    instances INT,
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_collection_id (collection_id)
);
```

**`collection_patent`** — Patents in collections
```sql
CREATE TABLE collection_patent (
    collection_company_id INT PRIMARY KEY AUTO_INCREMENT,
    collection_id INT,
    appno_doc_num VARCHAR(300),
    grant_doc_num VARCHAR(300),
    created_at DATETIME,
    updated_at DATETIME,
    
    INDEX idx_collection_id (collection_id)
);
```

#### Integration

**`assets_channel`** — Asset-to-channel mapping (for notifications)
```sql
CREATE TABLE assets_channel (
    id INT PRIMARY KEY AUTO_INCREMENT,
    asset VARCHAR(50),                  -- Application/grant number
    channel_id VARCHAR(30),             -- Notification channel ID
    
    INDEX idx_asset (asset),
    INDEX idx_channel_id (channel_id)
);
```

## Multi-Tenancy Architecture

### Data Isolation Pattern

```
┌─────────────────────────────────────────┐
│        db_business.organisation         │
│  ┌───────────────────────────────────┐  │
│  │ org_id=1, org_db='db_1abc123'    │  │
│  │ org_usr='xyz789', org_pass='M!...'│  │
│  └───────────────────────────────────┘  │
└────────────┬────────────────────────────┘
             │ credentials
             ▼
┌─────────────────────────────────────────┐
│         Per-Customer Database           │
│           db_1abc123                    │
│  ┌───────────────────────────────────┐  │
│  │ user, representative, activity,   │  │
│  │ document, professional, etc.      │  │
│  └───────────────────────────────────┘  │
│                                          │
│  References (read-only):                │
│  - db_uspto.* (shared patent data)     │
│  - db_new_application.* (shared assets)│
└─────────────────────────────────────────┘
```

### Connection Pattern

**From application code:**

```php
// 1. Get customer org record
$query = "SELECT * FROM db_business.organisation 
          WHERE organisation_id = {$org_id}";
$orgRow = $result->fetch_object();

// 2. Connect to customer database using stored credentials
$customerConn = new mysqli(
    $orgRow->org_host,
    $orgRow->org_usr,
    $orgRow->org_pass,
    $orgRow->org_db
);

// 3. Query customer-specific data
$result = $customerConn->query("SELECT * FROM representative WHERE parent_id = 0");

// 4. Cross-reference with shared data (new connection or qualified names)
$sharedConn = new mysqli($host, $user, $password, 'db_uspto');
$result = $sharedConn->query("SELECT * FROM assignment WHERE rf_id = '{$rf_id}'");
```

### Data Transfer Between Accounts

**From `transferred_data_from_one_account_to_another_accounts.php`:**

```php
// Connect to source org
$sourceConn = new mysqli($sourceOrg->org_host, $sourceOrg->org_usr, 
                         $sourceOrg->org_pass, $sourceOrg->org_db);

// Get representative data
$query = "SELECT * FROM representative WHERE representative_id = {$source_rep_id}";
$sourceData = $sourceConn->query($query)->fetch_object();

// Connect to target org
$targetConn = new mysqli($targetOrg->org_host, $targetOrg->org_usr,
                         $targetOrg->org_pass, $targetOrg->org_db);

// Insert as child under new parent group
$query = "INSERT INTO representative 
          (original_name, representative_name, parent_id, type, child)
          VALUES (
              '{$sourceData->original_name}',
              '{$sourceData->representative_name}',
              {$target_parent_id},
              0,
              1
          )";
$targetConn->query($query);
```

**Data that transfers:**
- Representative/company records
- Associated addresses, phone numbers
- User-defined collections
- Activity records (optional)

**Data that does NOT transfer:**
- Users (account-specific)
- Professional network (account-specific)
- Patent assets (re-linked via db_new_application.assets)

### Security Characteristics

**Strengths:**
- Complete data isolation between customers
- Unique credentials per customer
- No cross-tenant query capability
- Database-level access control

**Weaknesses:**
- Credentials stored in plaintext in `db_business.organisation`
- No credential rotation mechanism
- No audit trail for cross-database access
- No encryption at rest
- Password generation is weak (single uppercase + `!` + uniqid)

## Database Relationships Map

```
┌──────────────────────────────────────────────────────────────────┐
│                        db_business                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                      organisation                           │  │
│  │  (org_id, name, org_host, org_usr, org_pass, org_db)      │  │
│  └────────────┬───────────────────────────────────────────────┘  │
└───────────────┼──────────────────────────────────────────────────┘
                │ stores credentials for
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Per-Customer Databases                          │
│                    db_{id}{uniqid}                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  representative, user, firm, professional, activity,       │  │
│  │  document, address, telephone, collection, etc.            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  READ-ONLY references to:                                        │
│  ├─ db_uspto.* (via application joins)                          │
│  └─ db_new_application.* (via organisation_id/company_id)       │
└──────────────────────────────────────────────────────────────────┘
                │
                │ company_id/representative_id link
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    db_new_application                             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  assets (appno_doc_num, company_id, organisation_id)       │  │
│  │  dashboard_items (organisation_id, representative_id)      │  │
│  │  activity_parties_transactions                             │  │
│  │  summary (organisation_id, company_id)                     │  │
│  │  timeline (organisation_id, representative_id)             │  │
│  │  tree (organisation_id, representative_id)                 │  │
│  │  lost_assets                                               │  │
│  └───────────┬────────────────────────────────────────────────┘  │
└──────────────┼──────────────────────────────────────────────────┘
               │ rf_id, appno_doc_num link
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         db_uspto                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  assignment (rf_id, convey_text, record_dt)                │  │
│  │  assignor (rf_id, assignor_and_assignee_id)                │  │
│  │  assignee (rf_id, assignor_and_assignee_id)                │  │
│  │  assignor_and_assignee (id, name, representative_id)       │  │
│  │  representative (representative_id, representative_name)   │  │
│  │  assignment_conveyance (rf_id, convey_ty, employer_assign) │  │
│  │  representative_assignment_conveyance                      │  │
│  │  documentid (rf_id, appno_doc_num, grant_doc_num)          │  │
│  │  correspondent (rf_id, cname)                              │  │
│  │  law_firm                                                  │  │
│  │  patent_cpc, application_cpc                               │  │
│  │  bank_security_transactions, bank_release_transactions     │  │
│  │  application_status, download_tracking                     │  │
│  └───────────┬────────────────────────────────────────────────┘  │
└──────────────┼──────────────────────────────────────────────────┘
               │ appno_doc_num/grant_doc_num link
               ▼
┌──────────────────────────────────────────────────────────────────┐
│           db_patent_grant_bibliographic                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  grant_application, inventor, assignee_grant, examiner,    │  │
│  │  claims, classifications, citations, etc.                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│        db_patent_application_bibliographic                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  inventor, assignee, applicant, etc.                       │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│          db_patent_maintainence_fee                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  event_maintainence_fees                                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│               db_inventor (separate host)                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  inventors (assignor_and_assignee_id, canonical_name)      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Key Patterns and Conventions

### Naming Conventions

- **Database prefix:** `db_` for all databases
- **Customer DBs:** `db_{org_id}{uniqid()}` (e.g., `db_123abc456def`)
- **Usernames:** `uniqid()` (e.g., `abc123def456`)
- **Field suffixes:**
  - `_id`: Integer primary/foreign keys
  - `_dt`: DATE fields
  - `_at`: DATETIME fields
  - `_num`: Document numbers

### Common Patterns

**Entity normalization:**
```
Raw name (or_name, ee_name)
    ↓
assignor_and_assignee (name, representative_id)
    ↓
representative (representative_name) — canonical name
```

**Transaction linkage:**
```
assignment (rf_id) ← header
    ↓
assignor (rf_id, assignor_and_assignee_id) — parties
assignee (rf_id, assignor_and_assignee_id)
    ↓
documentid (rf_id, appno_doc_num) — linked patents
    ↓
assets (appno_doc_num, company_id, organisation_id) — customer assignment
```

**Customer data access:**
```
Application queries db_business.organisation
    ↓ (get credentials)
Connect to customer DB using org_host/org_usr/org_pass/org_db
    ↓
Query customer tables (representative, user, activity, etc.)
    ↓
Cross-reference shared data (db_uspto, db_new_application)
```

### Index Strategy

**Primary indexes:**
- All primary keys
- Foreign keys
- Date fields (record_dt, appno_date, etc.)
- Name fields (for search/matching)

**Composite indexes:**
- `(organisation_id, company_id)` — customer data filtering
- `(reel_no, frame_no)` — document lookup
- `(rf_id, convey_ty)` — transaction filtering

**Missing indexes (performance issues):**
- `assignor_and_assignee.name` could benefit from full-text index
- `timeline` lacks composite index on `(organisation_id, record_dt)`
- Many JOIN fields lack proper indexing

## Data Volume Characteristics

**Large tables (millions of rows):**
- `db_uspto.assignment` — ~50M+ records
- `db_uspto.assignor` — ~100M+ records
- `db_uspto.assignee` — ~100M+ records
- `db_uspto.documentid` — ~200M+ records (multiple per assignment)
- `db_patent_grant_bibliographic.inventor` — ~30M+ records
- `db_patent_application_bibliographic.inventor` — ~40M+ records

**Medium tables (hundreds of thousands):**
- `db_uspto.assignor_and_assignee` — ~5M records
- `db_uspto.representative` — ~500K records
- `db_new_application.assets` — ~1M+ records (varies by customer base)

**Small tables (per-customer):**
- `{customer_db}.representative` — 1-1000 records
- `{customer_db}.user` — 1-50 records
- `{customer_db}.activity` — 0-10K records

## Schema Evolution Issues

1. **No versioning:** No schema version tracking or migration framework
2. **Ad-hoc changes:** Schema changes applied directly without documentation
3. **Inconsistent types:** VARCHAR lengths vary arbitrarily (50, 100, 245, 255, 300)
4. **Mixed collations:** utf8mb4_general_ci and latin1 used inconsistently
5. **Nullable inconsistencies:** No clear nullable/not-null conventions
6. **Missing constraints:** Very few CHECK constraints or data validation rules
7. **No cascade rules:** Foreign keys mostly without ON DELETE/UPDATE rules
8. **Temporal data:** No created_by/updated_by audit fields in core tables

## Performance Considerations

**Slow queries:**
- Levenshtein distance calculations (O(n²))
- Inventor matching across biblio DBs (UNION queries)
- Tree construction (multiple large JOINs)
- Summary calculations (multiple aggregations)

**Optimization opportunities:**
- Materialized views for summary data
- Partitioning large tables by date
- Full-text indexes for name matching
- Read replicas for biblio databases
- Caching layer for representative mappings

## Backup and Recovery

**No evidence of:**
- Point-in-time recovery capability
- Automated backup schedules
- Cross-database consistency checks
- Disaster recovery procedures
- Data retention policies

**Risks:**
- Customer database credentials could be lost
- No way to recover if `db_business.organisation` corrupted
- Individual customer DB backups insufficient (need cross-DB consistency)

---

**Document Status:** Based on analysis of source code from `Synpathub/uspto-data-sync` and `Synpathub/customer-data-migrator` repositories as of February 2026.
