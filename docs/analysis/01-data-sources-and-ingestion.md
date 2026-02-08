# PatenTrack Data Sources & Ingestion Analysis

## 1. External Data Sources

### 1.1 USPTO Bulk Data - Patent Grant Bibliographic (Red Book)
- **Data type:** Patent grant bibliographic data (full-text XML)
- **Retrieval method:** Bulk TAR download via wget/curl
- **URL(s):** `https://bulkdata.uspto.gov/data/patent/grant/redbook/{YYYY}/{IYYYYmmdd}.tar`
- **Authentication:** None (public bulk data)
- **Schedule:** Weekly (Tuesdays), date-based incremental downloads
- **Format:** TAR archives containing ZIP files with XML and TIF image files
- **Volume:** ~12GB per weekly TAR file (can be split into 2GB pieces for large weeks like 2014-09-18)
- **Entry scripts:** 
  - `/tmp/script_patent_application_bibliographic/download_files.js`
  - `/tmp/uspto-data-sync/patent_weekly_download.php`

### 1.2 USPTO Bulk Data - Patent Application Bibliographic (Red Book)
- **Data type:** Published patent application bibliographic data (full-text XML)
- **Retrieval method:** Bulk TAR download via wget/curl
- **URL(s):** `https://bulkdata.uspto.gov/data/patent/application/redbook/{YYYY}/{IYYYYmmdd}.tar`
- **Authentication:** None (public bulk data)
- **Schedule:** Weekly (Thursdays), date-based incremental downloads
- **Format:** TAR archives containing ZIP files with XML and TIF files
- **Volume:** Similar to grant data (~10-12GB per week)
- **Entry scripts:**
  - `/tmp/script_patent_application_bibliographic/application_download_files.js`
  - `/tmp/uspto-data-sync/application_weekly_download.php`

### 1.3 USPTO API - Daily Patent Assignment (PASDL)
- **Data type:** Daily patent assignment/transaction data
- **Retrieval method:** REST API with API key authentication
- **URL(s):** `https://api.uspto.gov/api/v1/datasets/products/files/PASDL/ad{Ymd}.zip`
- **Authentication:** API key via `x-api-key` header (env: `USPTO_OPEN_API_KEY`)
- **Schedule:** Daily incremental downloads
- **Format:** ZIP files containing XML assignment records
- **Volume:** Daily files vary (typically MB range)
- **Entry scripts:** `/tmp/uspto-data-sync/daily_download.php`

### 1.4 USPTO API - Patent Grant CPC Classifications (Monthly)
- **Data type:** Cooperative Patent Classification (CPC) data for granted patents
- **Retrieval method:** REST API with API key authentication
- **URL(s):** `https://api.uspto.gov/api/v1/datasets/products/files/CPCMCPT/US_Grant_CPC_MCF_XML_{Y-m-d}.zip`
- **Authentication:** API key via `x-api-key` header
- **Schedule:** Monthly full downloads
- **Format:** ZIP archives containing XML files (WIPO ST.96 standard)
- **Volume:** Monthly full dataset
- **Entry scripts:** `/tmp/uspto-data-sync/monthly_download_patent_cpc.php`

### 1.5 USPTO API - Application CPC Classifications (Monthly)
- **Data type:** CPC data for published patent applications
- **Retrieval method:** REST API with API key authentication
- **URL(s):** `https://api.uspto.gov/api/v1/datasets/products/files/CPCMCAPP/US_PGPub_CPC_MCF_XML_{Y-m-d}.zip`
- **Authentication:** API key via `x-api-key` header
- **Schedule:** Monthly full downloads
- **Format:** ZIP archives containing XML files (WIPO ST.96 standard)
- **Volume:** Monthly full dataset
- **Entry scripts:** `/tmp/uspto-data-sync/monthly_download_applications_cpc.php`

### 1.6 USPTO API - Patent Maintenance Fee Events
- **Data type:** Patent maintenance fee payment event data
- **Retrieval method:** REST API with API key authentication
- **URL(s):** `https://api.uspto.gov/api/v1/datasets/products/files/PTMNFEE2/MaintFeeEvents_{Ymd}.zip`
- **Authentication:** API key via `x-api-key` header
- **Schedule:** Weekly downloads
- **Format:** ZIP files containing tab-delimited text files
- **Volume:** Weekly snapshots
- **Entry scripts:** `/tmp/uspto-data-sync/weekly_download_maintainence_events.php`

### 1.7 USPTO API - Patent File Wrapper Status Data
- **Data type:** Patent prosecution file wrapper status (2021-2025)
- **Retrieval method:** REST API with API key authentication
- **URL(s):** `https://api.uspto.gov/api/v1/datasets/products/files/PTFWPRE/2021-2025-patent-filewrapper-full-json-{Ymd}.zip`
- **Authentication:** API key via `x-api-key` header
- **Schedule:** Periodic downloads
- **Format:** ZIP files containing JSON
- **Volume:** Multi-year dataset
- **Entry scripts:** `/tmp/uspto-data-sync/patent_status_download.php`

### 1.8 USPTO Assignment API (Solr Search)
- **Data type:** Patent assignment/transaction records with detailed metadata
- **Retrieval method:** REST API queries (Solr endpoint)
- **URL(s):** 
  - `https://assignment.uspto.gov/solr/aotw/select?fq=patNum:{patent_number}&q=*:*&rows=500&wt=json`
  - `https://assignment.uspto.gov/solr/aotw/select?fq=applNum:{application_number}&q=*:*&rows=500&wt=json`
  - `https://assignment.uspto.gov/solr/aotw/select?fq=id:{reel_no}-{frame_no}&q=*:*&wt=json`
- **Authentication:** None (public API)
- **Schedule:** On-demand queries by patent/application number
- **Format:** JSON responses
- **Volume:** Up to 500 records per query
- **Entry scripts:**
  - `/tmp/uspto-data-sync/back_uspto_patent_assignment_json_parse.php`
  - `/tmp/uspto-data-sync/back_uspto_patent_assignment_json_parse_742020.php`
  - `/tmp/uspto-data-sync/fix_representative.php`
  - `/tmp/uspto-data-sync/fix_transactions_by_patents.php`

### 1.9 USPTO Legacy Assignment PDFs
- **Data type:** Scanned PDF assignment documents
- **Retrieval method:** Direct HTTP download
- **URL(s):** `http://legacy-assignments.uspto.gov/assignments/assignment-{type}-{reel_no}-{frame_no}.pdf`
- **Authentication:** None (public access)
- **Schedule:** On-demand based on assignment records
- **Format:** PDF files
- **Volume:** Individual PDF per assignment record
- **Entry scripts:**
  - `/tmp/uspto-data-sync/download_all_pdf.php`
  - `/tmp/uspto-data-sync/download_pdf_files_yearly.php`

### 1.10 EPO Open Patent Services (OPS) - Patent Family Data
- **Data type:** European patent family and legal status information
- **Retrieval method:** REST API with OAuth2 authentication
- **URL(s):**
  - Auth: `https://ops.epo.org/3.2/auth/accesstoken`
  - Family: `http://ops.epo.org/3.2/rest-services/family/publication/{docdb|epodoc}/{patent_number}/legal`
  - Published data: `http://ops.epo.org/3.2/rest-services/published-data/{publication}/{db}/{docNum}/biblio`
  - Images: `http://ops.epo.org/3.2/rest-services/published-data/images/{country}/{docNum}/{kindCode}/thumbnail.pdf`
- **Authentication:** OAuth2 client credentials (Bearer token) - credentials in env: `EPO_KEY`, `EPO_SECRET`
- **Schedule:** On-demand queries per patent
- **Format:** XML responses (ops:world-patent-data format)
- **Volume:** Individual patent family records with rate limiting
- **Entry scripts:**
  - `/tmp/script_patent_application_bibliographic/epo.js`
  - `/tmp/script_patent_application_bibliographic/assets_family.js`
  - `/tmp/script_patent_application_bibliographic/assets_family_legal.js`
  - `/tmp/uspto-data-sync/epo_api_retrieve_patent_data.php`
  - `/tmp/uspto-data-sync/epo_class.php`

### 1.11 EPO Linked Data Service - CPC Hierarchy
- **Data type:** CPC classification hierarchy and parent-child relationships
- **Retrieval method:** SPARQL queries over HTTP
- **URL(s):** `https://data.epo.org/linked-data/query?query={SPARQL_QUERY}&output=json`
- **Authentication:** None (public linked data)
- **Schedule:** On-demand queries
- **Format:** JSON (SPARQL query results)
- **Volume:** Individual CPC code lookups
- **Entry scripts:** `/tmp/uspto-data-sync/cpc_parent_child.php`

### 1.12 PatentsView API - Patent Metadata & Citations
- **Data type:** Patent citations, assignee organizations, inventor data
- **Retrieval method:** REST API queries
- **URL(s):**
  - Citations: `https://api.patentsview.org/patents/query?q={"cited_patent_number":"{number}"}&f=["patent_number","assignee_organization","app_date"]`
  - Assignees: `https://api.patentsview.org/assignees/query?q={"_begins":{"assignee_organization":"{prefix}"}}&f=["assignee_organization"]`
  - Patent details: `https://www.patentsview.org/api/patents/query?q={"patent_number":"{number}"}&f=["inventor_first_name","inventor_last_name"]`
- **Authentication:** None (public API)
- **Schedule:** On-demand queries for citation networks and assignee enrichment
- **Format:** JSON responses
- **Volume:** Up to 10,000 records per query with pagination
- **Entry scripts:**
  - `/tmp/script_patent_application_bibliographic/retrieve_cited_patents_assignees.js`
  - `/tmp/script_patent_application_bibliographic/logo_assignee_organisation.js`
  - `/tmp/uspto-data-sync/api_fetch_application_inventor.php`

### 1.13 Clearbit Name-to-Domain API
- **Data type:** Company domain name from company name
- **Retrieval method:** REST API (Node.js SDK)
- **URL(s):** Clearbit API via SDK (`clearbit` npm package)
- **Authentication:** API key (hardcoded in source - SECURITY RISK)
- **Schedule:** On-demand per assignee organization
- **Format:** JSON responses
- **Volume:** Individual company lookups
- **Entry scripts:** `/tmp/script_patent_application_bibliographic/name_to_domain_api.js`

### 1.14 RapidAPI Google Image Search
- **Data type:** Company logos from Google Image Search
- **Retrieval method:** REST API via RapidAPI
- **URL(s):** `https://google-search72.p.rapidapi.com/imagesearch`
- **Authentication:** RapidAPI key
- **Schedule:** On-demand per company
- **Format:** JSON with image URLs
- **Volume:** Individual image searches
- **Entry scripts:** `/tmp/script_patent_application_bibliographic/name_to_domain_api.js`

### 1.15 UpLead Company Data API
- **Data type:** Company enrichment data
- **Retrieval method:** REST API
- **URL(s):** UpLead API endpoints
- **Authentication:** Client ID `977c4d4eaa39794b7ee53b4d8da026b1`
- **Schedule:** On-demand
- **Format:** JSON
- **Volume:** Individual company lookups
- **Entry scripts:** `/tmp/script_patent_application_bibliographic/name_to_domain_api.js`

### 1.16 RiteKit Logo API
- **Data type:** Company logos
- **Retrieval method:** REST API
- **URL(s):** RiteKit API endpoints
- **Authentication:** Client ID `9e44da1127bae5aee46bb12723f7dada36d3ae76916d`
- **Schedule:** On-demand
- **Format:** JSON/images
- **Volume:** Individual logo lookups
- **Entry scripts:** `/tmp/script_patent_application_bibliographic/name_to_domain_api.js`

### 1.17 USPTO Patent Examination Data Center (PED)
- **Data type:** Patent examination/prosecution history data
- **Retrieval method:** Local file system XML parsing
- **URL(s):** None (pre-downloaded data)
- **Authentication:** N/A
- **Schedule:** Batch processing from `/mnt/volume_sfo2_14/*.xml`
- **Format:** XML (WIPO ST.96 standard with uspat: namespace)
- **Volume:** Large XML files with detailed prosecution data
- **Entry scripts:** `/tmp/script_patent_application_bibliographic/patent_examination_data_centre.js`

---

## 2. Download Scripts Inventory

### 2.1 /tmp/script_patent_application_bibliographic/download_files.js
- **Language:** JavaScript (Node.js)
- **Downloads:** USPTO Patent Grant Red Book TAR archives (weekly)
- **Selection logic:** Date range iteration (weekly intervals on Tuesdays), recursively downloads from startDate to endDate
- **Storage:** 
  - Download: `${EXTRA_DISK_PATH}patent/DOWNLOAD/{filename}.tar`
  - Extracted XML: `${EXTRA_DISK_PATH}patent/XML2/`
  - Images: `${EXTRA_DISK_PATH}patent/IMAGES/`
- **Error handling:** Logs stderr output but continues on error (commented-out reject), promise-based with catch block
- **Dependencies:** wget, tar, unzip, find, mv commands; env vars: `MAIN_FOLDER_PATH`, `EXTRA_DISK_PATH`

### 2.2 /tmp/script_patent_application_bibliographic/application_download_files.js
- **Language:** JavaScript (Node.js)
- **Downloads:** USPTO Patent Application Red Book TAR archives (weekly)
- **Selection logic:** Date range iteration (weekly intervals on Thursdays), recursively downloads from startDate to endDate
- **Storage:**
  - Download: `${EXTRA_DISK_PATH}applications/DOWNLOAD/{filename}.tar`
  - Extracted XML: `${EXTRA_DISK_PATH}application/XML2/`
  - Images: `${EXTRA_DISK_PATH}application/IMAGES/`
- **Error handling:** Logs stderr but continues, promise-based error handling
- **Dependencies:** Same as download_files.js; env vars: `MAIN_FOLDER_PATH`, `EXTRA_DISK_PATH`

### 2.3 /tmp/uspto-data-sync/daily_download.php
- **Language:** PHP
- **Downloads:** Daily USPTO patent assignment data (PASDL product)
- **Selection logic:** 
  - Queries `download_tracking` table to get last successful download date
  - Downloads all files from last date to today (inclusive)
  - Retries failed downloads from same date on subsequent runs
- **Storage:**
  - Downloaded files: `/var/www/html/trash/dds/ad{Ymd}.zip`
  - Extracted XML: Same directory (unzipped in place)
- **Error handling:**
  - Retry logic for HTTP 429 (rate limiting) - sleeps 1 second and retries up to 5 times
  - Updates `download_tracking` table with status (in_progress/success/failed)
  - Logs errors to daily log files in `./log/{Y-m-d}.log`
  - Stores error messages in database
- **Dependencies:** 
  - `connection.php`, `download_tracking_helper.php`
  - Calls `update_record_daily_xml.php` after extraction
  - Uses cURL with USPTO API key

### 2.4 /tmp/uspto-data-sync/patent_weekly_download.php
- **Language:** PHP
- **Downloads:** Weekly patent grant bibliographic TAR files
- **Selection logic:** Manual execution for specific date (not automated scheduling in code)
- **Storage:**
  - Download: `/mnt/volume_sfo2_12/patent/DOWNLOAD/{filename}.tar`
  - Extracted XML: `/mnt/volume_sfo2_12/patent/XML2/`
  - Images: `/mnt/volume_sfo2_12/patent/IMAGES/`
  - Final XML storage: `/mnt/volume_sfo2_12/patent/XML/`
- **Error handling:** Basic exec() calls with output/return tracking
- **Dependencies:**
  - sudo, wget, tar, find, unzip, mv
  - Triggers Node.js parsing scripts: `patent_xml_file_read.js`, `grant_read_lawyer_from_xml.js`, `grant_read_applicant_assignee_from_xml.js`, `grant_extension_xml.js`
  - Runs scripts in parallel using shell `&` and `wait`

### 2.5 /tmp/uspto-data-sync/application_weekly_download.php
- **Language:** PHP
- **Downloads:** Weekly patent application bibliographic TAR files
- **Selection logic:** Manual execution
- **Storage:**
  - Download: `/mnt/volume_sfo2_12/applications/DOWNLOAD/{filename}.tar`
  - Extracted XML: `/mnt/volume_sfo2_12/applications/XML2/`
  - Images: `/mnt/volume_sfo2_12/applications/IMAGES/`
- **Error handling:** Basic exec() calls
- **Dependencies:**
  - sudo, wget, tar, find, unzip, mv
  - Triggers Node.js parsing: `application_read_applicant_assignee_from_xml.js`, `read_inventor_from_xml.js`

### 2.6 /tmp/uspto-data-sync/weekly_download_maintainence_events.php
- **Language:** PHP
- **Downloads:** Patent maintenance fee event ZIP files
- **Selection logic:** Single date-based download
- **Storage:** `/mnt/volume_sfo2_12/EVENTS/MaintFeeEvents_{Ymd}.zip`
- **Error handling:** Basic error checking
- **Dependencies:** 
  - unzip
  - Calls `maintainaince_file.php` for processing

### 2.7 /tmp/uspto-data-sync/monthly_download_patent_cpc.php
- **Language:** PHP
- **Downloads:** Monthly patent grant CPC classification data
- **Selection logic:** Single monthly file download
- **Storage:** `/mnt/volume_sfo2_12/DOWNLOAD/US_Grant_CPC_MCF_XML_{date}.zip`
- **Error handling:** Basic
- **Dependencies:**
  - unzip
  - Calls `patent_cpc_read_from_xml.php` for XML parsing

### 2.8 /tmp/uspto-data-sync/monthly_download_applications_cpc.php
- **Language:** PHP
- **Downloads:** Monthly application CPC classification data
- **Selection logic:** Single monthly file download
- **Storage:** `/mnt/volume_sfo2_12/DOWNLOAD/US_PGPub_CPC_MCF_XML_{date}.zip`
- **Error handling:** Basic
- **Dependencies:**
  - unzip
  - Calls `application_cpc_read_from_xml.php` for XML parsing

### 2.9 /tmp/uspto-data-sync/download_all_pdf.php
- **Language:** PHP
- **Downloads:** Patent assignment PDF documents
- **Selection logic:** Queries database for missing PDFs, downloads from USPTO legacy system
- **Storage:** Local temp storage, then uploaded to S3 bucket `static.patentrack.com`
- **Error handling:** Basic file existence checks
- **Dependencies:** S3 upload functionality

### 2.10 /tmp/uspto-data-sync/download_pdf_files_yearly.php
- **Language:** PHP
- **Downloads:** Yearly batches of assignment PDFs
- **Selection logic:** Year-based bulk download
- **Storage:** S3 bucket with prefix `assignments/`
- **Error handling:** Basic
- **Dependencies:** AWS SDK for PHP

### 2.11 /tmp/script_patent_application_bibliographic/download_assignees_logos.js
- **Language:** JavaScript (Node.js)
- **Downloads:** Company logos from various sources
- **Selection logic:** Database query for assignees missing logo data
- **Storage:** Database fields (`logo_url`, `domain`, etc. in `assignee_organizations` table)
- **Error handling:** Error array tracking, continues on individual failures
- **Dependencies:** Multiple external APIs (Clearbit, RiteKit, UpLead, RapidAPI)

---

## 3. Parsing Scripts Inventory

### 3.1 /tmp/script_patent_application_bibliographic/patent_xml_file_read.js
- **Input:** Patent grant XML files from `${EXTRA_DISK_PATH}patent/XML2/*.XML`
- **Output:** Database tables in `db_patent_grant_bibliographic` database
- **Fields extracted:**
  - **Inventors:** `given_name`, `family_name`, `middle_name`, `name` (concatenated full name)
  - **Patent metadata:** `appno_doc_num`, `appno_date`, `grant_doc_num`, `grant_date`, `title` (invention-title)
  - **File tracking:** `file_name`, `full_path`
- **Business logic:**
  - Date conversion: YYYYMMDD → YYYY-MM-DD format
  - HTML entity decoding on all text fields
  - Handles two XML structures: `parties > applicants > applicant[@type="applicant-inventor"]` and `us-parties > inventors > inventor`
  - Uses bulk insert with `ignoreDuplicates: true`
- **Tables written:**
  - `inventor` (fields: `appno_doc_num`, `name`, `given_name`, `family_name`, `middle_name`, `file_name`, `full_path`)
  - `grant_application` (fields: `appno_doc_num`, `appno_date`, `grant_doc_num`, `grant_date`, `file_name`, `title`)

### 3.2 /tmp/script_patent_application_bibliographic/grant_read_applicant_assignee_from_xml.js
- **Input:** Patent grant XML files from `${EXTRA_DISK_PATH}patent/XML2/*.XML`
- **Output:** Database tables in `db_patent_grant_bibliographic` database
- **Fields extracted:**
  - **Organization data:** `orgname` (as `original_name`)
  - **Address:** `address-1`, `address-2`, `city`, `state`, `postalcode`, `country`
  - **Individual names:** `first-name`, `last-name`, `middle-name` → `given_name`, `family_name`, `middle_name`
  - **Reference numbers:** `appno_doc_num`, `publication_number`
  - **Type:** Distinguishes applicants vs assignees by XML element path
- **Business logic:**
  - HTML entity decoding on all text fields
  - Handles both single object and array structures
  - Separates applicants (type="applicant") from assignees (different XML path)
  - Applicant type coded as integer in `type` field
  - Uses bulk insert with `ignoreDuplicates: true`
- **Tables written:**
  - `assignee_grant` (fields: `appno_doc_num`, `publication_number`, `original_name`, `address_1`, `address_2`, `city`, `state`, `postalcode`, `country`)
  - `applicant_grant` (fields: same as assignee_grant plus `family_name`, `given_name`, `middle_name`, `type`, `file_name`)

### 3.3 /tmp/script_patent_application_bibliographic/application_read_applicant_assignee_from_xml.js
- **Input:** Patent application XML files from `${EXTRA_DISK_PATH}applications/XML2/*.XML`
- **Output:** Database tables in `db_patent_application_bibliographic` database
- **Fields extracted:** Same as grant_read_applicant_assignee_from_xml.js
- **Business logic:**
  - Filters applicants by `@_app-type` attribute
  - Differentiates applicants vs assignees via `@_applicant-authority-category` attribute
  - HTML entity decoding
  - Handles multiple XML structure variations
- **Tables written:**
  - `assignee` (application assignees)
  - `applicant` (application applicants)

### 3.4 /tmp/script_patent_application_bibliographic/grant_read_lawyer_from_xml.js
- **Input:** Patent grant XML files from `${EXTRA_DISK_PATH}patent/XML2/*.XML`
- **Output:** Database table in `db_patent_grant_bibliographic`
- **Fields extracted:**
  - **Agent/firm name:** `orgname` OR concatenated `first-name` + `last-name`
  - **Reference:** `appno_doc_num`
  - **File tracking:** `file_name`
- **Business logic:**
  - Prioritizes organization name over individual agent name
  - Falls back to person name if orgname not present
  - Parses from `parties/us-parties > agents > agent > addressbook`
- **Tables written:**
  - `lawfirm_grant` (fields: `appno_doc_num`, `name`, `file_name`)

### 3.5 /tmp/script_patent_application_bibliographic/application_read_lawyer_from_xml.js
- **Input:** Patent application XML files from `${EXTRA_DISK_PATH}applications/XML/*-YEAR*.XML` (year-filtered)
- **Output:** Database table in `db_patent_application_bibliographic`
- **Fields extracted:** Same as grant_read_lawyer_from_xml.js
- **Business logic:** Identical to grant version but for applications
- **Tables written:**
  - `lawfirm_application` (fields: `appno_doc_num`, `name`, `file_name`)

### 3.6 /tmp/script_patent_application_bibliographic/grant_extension_xml.js
- **Input:** Patent grant XML files from `${EXTRA_DISK_PATH}patent/XML2/*.XML`
- **Output:** Multiple database tables
- **Fields extracted:**
  - **Extension metadata:** Various patent metadata fields
  - **Claims:** Patent claims text and structure
  - **Figures:** Figure descriptions and references
  - **Specifications:** Detailed description text
- **Business logic:** Parses extended patent document content beyond basic bibliographic data
- **Tables written:**
  - `grant_extension`
  - `application_details`
  - `application_claims`
  - `application_figures`
  - `application_specifications`
  - `inventors`

### 3.7 /tmp/uspto-data-sync/update_record_daily_xml.php
- **Input:** Daily assignment XML files from `./dds/*.xml`
- **Output:** Multiple USPTO database tables
- **Fields extracted:**
  - **Assignment data:** Patent/application numbers, reel/frame numbers, conveyance text
  - **Parties:** Assignor names, assignee names, addresses
  - **Dates:** Execution dates, record dates
- **Business logic:**
  - Parses `<patent-assignment>` elements using XMLReader
  - Updates instance counts for assignor/assignee names
  - Links to representative entities
  - Handles both patent and application numbers
- **Tables written:**
  - `db_uspto.assignor_and_assignee` (fields: `name`, `instances`, `representative_id`)
  - `db_uspto.company_temp`
  - `db_uspto.assignor`
  - `db_uspto.assignee`
  - `big_data.company_temp` (secondary database)

### 3.8 /tmp/uspto-data-sync/back_uspto_patent_assignment_json_parse.php
- **Input:** JSON responses from USPTO Assignment API (Solr)
- **Output:** Client-specific database tables
- **Fields extracted:**
  - **Assignment metadata:** `reel_no`, `frame_no`, `displayId`, `conveyanceText`
  - **Parties:** `patAssigneeName`, `patAssignorName`, `inventors`
  - **Dates:** `patAssignorEarliestExDate`, `recordedDate`
  - **Document info:** `pageCount`, `assignmentRecordHasImages`
  - **Addresses:** `corrAddress1-4`, `patAssigneeAddress1`, `patAssigneeCity`, `patAssigneeState`, `patAssigneePostcode`, `patAssigneeCountryName`
- **Business logic:**
  - Queries USPTO Solr API by patent number
  - Parses highlighted conveyance text from response
  - Links assignees/assignors to representative entities
  - Downloads associated PDFs from legacy assignment system
- **Tables written:**
  - `lead_patent_assignment` (fields: `patent_number`, `name`, `description`, `execution_date`, `recorded`, `type`, `reel_no`, `frame_no`, `document_file`, `box_type`, `assignment_no`)
  - `lead_patent_assigment_relation` (fields: `patent_number`, `parent_id`, `child_id`, `connection_type`, `frame`, `reel`, `description`, `date`, `assignment_no`, `line_type`, `creator_id`, `start_creator_id`)
  - `lead_assignment_names` (fields: `patent_number`, `original`, `modified`)
  - `lead_assignment_headings` (fields: `patent_number`, `original`, `modified`, `assignment_no`, `original_text`, `order_no`)

### 3.9 /tmp/uspto-data-sync/patent_cpc_read_from_xml.php
- **Input:** CPC XML files from `/mnt/volume_sfo2_12/DOWNLOAD/US_Grant_CPC_MCF_XML_*/*.xml`
- **Output:** `db_uspto.patent_cpc` table
- **Fields extracted:**
  - **Document IDs:** `application_number`, `grant_doc_num`, `country`, `kind_code`, `grant_date`
  - **CPC codes:** `section`, `class`, `sub_class`, `main_group`, `sub_group`
  - **Classification metadata:** `classification_version_date`, `symbol_position_code`, `classification_value_code`, `type`
- **Business logic:**
  - Parses WIPO ST.96 XML format
  - Handles namespace prefixes
  - Maps classification symbols to structured fields
  - Batch inserts with duplicate handling
- **Tables written:**
  - `patent_cpc` (fields: `application_number`, `grant_doc_num`, `country`, `kind_code`, `grant_date`, `classification_version_date`, `section`, `class`, `sub_class`, `main_group`, `sub_group`, `symbol_position_code`, `classification_value_code`, `type`)

### 3.10 /tmp/uspto-data-sync/application_cpc_read_from_xml.php
- **Input:** CPC XML files from `/mnt/volume_sfo2_12/DOWNLOAD/US_PGPub_CPC_MCF_XML_*/*.xml`
- **Output:** `db_uspto.application_cpc` table
- **Fields extracted:** Same CPC fields as patent_cpc but for applications
- **Business logic:** Identical to patent_cpc parsing
- **Tables written:**
  - `application_cpc` (fields: `application_number`, `classification_version_date`, `section`, `class`, `sub_class`, `main_group`, `sub_group`, `symbol_position_code`, `classification_value_code`, `type`)

### 3.11 /tmp/uspto-data-sync/maintainaince_file.php
- **Input:** Tab-delimited text files from `/mnt/volume_sfo2_12/EVENTS/MaintFeeEvents_*.txt`
- **Output:** `db_patent_maintainence_fee` database
- **Fields extracted:**
  - **Patent identifiers:** `grant_doc_num`, `appno_doc_num`
  - **Metadata:** `entity_status`, `filling_date`, `grant_date`
  - **Event data:** `event_date`, `event_code`, `event_icon`
- **Business logic:**
  - Parses tab-delimited format
  - Maps event codes to descriptions
  - Date formatting and validation
- **Tables written:**
  - `event_maintainence_fees` (fields: `grant_doc_num`, `appno_doc_num`, `entity_status`, `filling_date`, `grant_date`, `event_date`, `event_code`, `event_icon`)
  - `event_maintainence_code` (fields: `event_code`, `event_description`)

### 3.12 /tmp/script_patent_application_bibliographic/patent_examination_data_centre.js
- **Input:** PED XML files from `/mnt/volume_sfo2_14/*.xml`
- **Output:** Database tables in `DATABASE_PATENT_EXAMINER_DATA`
- **Fields extracted:**
  - **Application metadata:** `applicationNumber` (uscom:ApplicationNumberText), `applicationDate` (pat:FilingDate)
  - **Publication info:** `publicationNumber`, `publicationDate`
  - **Grant info:** `grantNumber` (pat:PatentNumber), `grantDate` (pat:GrantDate)
  - **Parties:** Inventors, applicants (from uspat:PartyBag)
  - **Correspondence:** Correspondence addresses
  - **Extensions/Status:** Application extensions, status updates
- **Business logic:**
  - Streams large XML files using xml-stream
  - Parses WIPO ST.96 format with uspat: namespace
  - Validates XML before parsing
  - Batch processing with promise-based flow
- **Tables written:**
  - `application_publication_grant` (PED tables)
  - `application_extension`
  - `application_status`
  - `application_applicants`
  - `application_inventors`
  - `application_correspondence`

### 3.13 /tmp/script_patent_application_bibliographic/normalize_names.js
- **Input:** Database queries from multiple tables
- **Output:** Updated representative records and inventor linkages
- **Fields extracted:** Assignor/assignee names from `db_uspto.assignor`, inventor names from biblio DBs
- **Business logic:**
  - Sorts names by word length (descending)
  - Groups similar names using Levenshtein distance (threshold < 3-5)
  - Identifies canonical/representative name (highest occurrence count)
  - Cross-references inventors across application and grant databases
  - Outputs JSON file with grouped name suggestions
- **Tables written:**
  - `assignor_and_assignee` (updates `representative_id`)
  - `applicant_assignor_and_assignee` (updates `representative_id`)
  - `representative` (inserts standardized names)
  - `db_patent_application_bibliographic.inventor` (INSERT IGNORE)
  - `db_patent_grant_bibliographic.inventor` (INSERT IGNORE)

### 3.14 /tmp/script_patent_application_bibliographic/inventor_levenshtein.js
- **Input:** 
  - JSON file of assignor names (command-line argument)
  - Database tables: `db_uspto.assignee`, `db_uspto.assignment_conveyance`, inventor tables
- **Output:** Updated assignment conveyance records
- **Fields extracted:** Names from assignee and inventor tables
- **Business logic:**
  - Builds 6 name variations per inventor (family-given, given-family, with middle names, etc.)
  - Calculates Levenshtein distance for each variation against assignors
  - Matches if distance < 5 for any variation
  - Marks matched records as 'employee' conveyance type
  - Sets `employer_assign` flag
- **Tables written:**
  - `representative_assignment_conveyance` (fields: `employer_assign`, `convey_ty`)
  - `db_patent_application_bibliographic.inventor` (INSERT IGNORE)
  - `db_patent_grant_bibliographic.inventor` (INSERT IGNORE)

### 3.15 /tmp/script_patent_application_bibliographic/retrieve_cited_patents_assignees.js
- **Input:** Database query for organization's patent portfolio
- **Output:** Citation network data
- **Fields extracted:**
  - **Citations:** `patent_number` (citing patent), `assignee_organization`, `app_date`
  - **From PatentsView API:** Patents citing the organization's patents
- **Business logic:**
  - Queries PatentsView API for each patent in portfolio
  - Filters citations by application date (> 1999)
  - Links citing patents to assignee organizations
  - Updates assignee_id from existing organization records
  - Creates new organization records if needed
- **Tables written:**
  - `assignee_organizations` (fields: `assignee_id`, `assignee_organization`)
  - `citing_patent_with_assignee` (fields: `patent_number`, `citing_patent_number`, `assignee_organization`, `app_date`, `assignee_id`)

### 3.16 /tmp/script_patent_application_bibliographic/assets_family.js
- **Input:** EPO API XML responses for patent family data
- **Output:** Patent family relationships
- **Fields extracted:**
  - **Family ID:** `family_id` (from XML attribute)
  - **Patent numbers:** `patent_number`, `doc-number`
  - **Application data:** `application_number`, `application_country`, `application_kind`
  - **Publication data:** `publication_country`, `publication_kind`
- **Business logic:**
  - Retrieves family data from EPO OPS API
  - Caches XML responses to local file system (`/mnt/volume_sfo2_12/FAMILY/{patent_number}.XML`)
  - Parses ops:world-patent-data XML structure
  - Filters family members by family_id
  - Handles both docdb and epodoc document-id types
- **Tables written:**
  - `assets_family` (fields: `family_id`, `grant_doc_num`, `patent_number`, `application_number`, `application_country`, `publication_country`, `publication_kind`, `application_kind`)

### 3.17 /tmp/uspto-data-sync/generate_json.php
- **Input:** Database queries for assignment transactions
- **Output:** JSON files for visualization (transaction tree/timeline)
- **Fields extracted:**
  - **Assignment data:** Conveyance types, dates, assignor/assignee names
  - **Visual elements:** Box types (Inventor, Ownership, Security, Licenses, 3rdParties), line types/colors
- **Business logic:**
  - Maps conveyance types to visual elements (colors, shapes, segments)
  - Builds transaction hierarchy and relationships
  - Generates timeline data for frontend visualization
  - Tracks name changes, security interests, licenses, releases
- **Tables written:** None (generates JSON output files)

---

## 4. Configuration & Infrastructure

### 4.1 Database Connections

#### Node.js (Sequelize) - /tmp/script_patent_application_bibliographic/config/index.js
**Environment Variables:**
- `HOST` - Database host
- `USER` - Database username
- `PASSWORD` - Database password
- `DATABASE_BUSINESS` - Business/organization data
- `DATABASE_RAW` - Raw resources data
- `DATABASE_APPLICATION_BIBLIO_NEW` - Application bibliographic (new schema)
- `DATABASE_APPLICATION_NEW` - Application data (new schema)
- `DATABASE_APPLICATION_BIBLIO` - Application bibliographic
- `DATABASE_GRANT_BIBLIO` - Grant bibliographic
- `DATABASE_PATENT_EXAMINER_DATA` - Patent Examination Data Center (PED)

**Hardcoded:**
- `db_inventor` database on host `165.232.146.68`

**Connection Pooling:** 
- Most connections use defaults (commented-out pools)
- PED database uses large pool: `max: 300000, acquire: 600000000ms, idle: 50000000ms`

#### PHP (mysqli) - /tmp/uspto-data-sync/connection.php
**Environment Variables (.env file):**
- `DB_HOST` - Database host
- `DB_USER` - Database username
- `DB_PASS` - Database password
- `DB_NAME` - Main database (db_uspto)
- `DB_BUSINESS` - Business database
- `DB_APPLICATION_DB` - Application database (db_new_application)

**Connection Management:**
- Includes `ensureConnection()` function to handle disconnections
- Sets charset to UTF-8
- Implements reconnection logic with ping checks
- Daily logging to `./log/{Y-m-d}.log`

#### PHP Alternative - /tmp/uspto-data-sync/config/db_central.php
**Environment Variables:**
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`
- `DB_USPTO_DB` - USPTO database
- `DB_BUSINESS` - Business database

**Global Connection:**
- Stores connection in `$GLOBALS['mainConnection']`

### 4.2 File Storage Paths

#### Primary Storage Locations

**Patent Grant Data:**
- Downloads: `/mnt/volume_sfo2_12/patent/DOWNLOAD/`
- Extracted TAR: `/mnt/volume_sfo2_12/patent/DOWNLOAD/` (in-place)
- XML files (processing): `/mnt/volume_sfo2_12/patent/XML2/`
- XML files (processed): `/mnt/volume_sfo2_12/patent/XML/`
- TIFF images: `/mnt/volume_sfo2_12/patent/IMAGES/`
- PNG images: `/mnt/volume_sfo2_12/patent/PNG/`

**Patent Application Data:**
- Downloads: `/mnt/volume_sfo2_12/applications/DOWNLOAD/`
- XML files (processing): `/mnt/volume_sfo2_12/applications/XML2/`
- XML files (processed): `/mnt/volume_sfo2_12/applications/XML/`
- TIFF images: `/mnt/volume_sfo2_12/applications/IMAGES/`
- PNG images: `/mnt/volume_sfo2_12/applications/PNG/`

**Assignment Data:**
- Daily downloads: `/var/www/html/trash/dds/` (ZIP and XML)
- Large assignment XML: `${EXTRA_DISK_PATH1}/assignment/bigXML/`
- Parsed assignment XML: `${EXTRA_DISK_PATH}/assignment/XML/{folder}/`

**Other Data:**
- EPO family data: `/mnt/volume_sfo2_12/FAMILY/{patent_number}.XML`
- Maintenance events: `/mnt/volume_sfo2_12/EVENTS/MaintFeeEvents_*.txt`
- CPC data: `/mnt/volume_sfo2_12/DOWNLOAD/US_Grant_CPC_MCF_XML_*/` and `US_PGPub_CPC_MCF_XML_*/`
- Patent status: `/mnt/volume_sfo2_12/STATUS/`
- PED data: `/mnt/volume_sfo2_14/*.xml`

**Environment Variables for Paths:**
- `MAIN_FOLDER_PATH` - Main working folder for extraction
- `EXTRA_DISK_PATH` - Extra disk mount point
- `EXTRA_DISK_PATH1` - Alternative extra disk path

**Temporary/Processing:**
- Extraction temp: `${MAIN_FOLDER_PATH}EXTRACT_FILES/`
- S3 staging: `/mnt/data/s3/`
- Logs: `/var/www/html/trash/` (various .log files)
- EPO tokens: `/var/www/html/trash/tmp/HedCET_node.dat`

### 4.3 Scheduling

**Download Tracking Table Structure:**
```sql
download_tracking (
    id INT PRIMARY KEY AUTO_INCREMENT,
    download_type VARCHAR - 'daily_download', 'weekly_patent_grant', etc.
    last_download_datetime DATETIME,
    next_scheduled_date DATE,
    schedule_frequency VARCHAR - 'daily', 'weekly', 'monthly', 'on_demand'
    schedule_day VARCHAR - Day of week or day of month
    status VARCHAR - 'in_progress', 'success', 'failed'
    files_downloaded INT,
    error_message TEXT
)
```

**Scheduling Mechanisms:**

1. **Daily Downloads:**
   - `daily_download.php` - Tracks last successful run, downloads all missing dates
   - Uses `download_tracking` table to resume from failures
   - Intended to run via cron daily

2. **Weekly Downloads:**
   - Patent grants: Run Tuesdays (hardcoded in `download_files.js`)
   - Applications: Run Thursdays (hardcoded in `application_download_files.js`)
   - Weekly PHP scripts appear to be manually triggered

3. **Monthly Downloads:**
   - CPC data downloads run monthly (manual trigger observed)
   - No automatic scheduling detected in code

4. **On-Demand:**
   - EPO family data: Triggered per patent via `assets_family.js` (called by `auto_assets_family.php`)
   - Logo downloads: Triggered via `auto_request_for_citied_assignees_and_logos.php`
   - Citation data: On-demand per organization

**Automation Scripts:**
- `auto_assets_family.php` - Loops through all organizations, calls `assets_family.js` for each
- `auto_request_for_citied_assignees_and_logos.php` - Batch processes cited patents and logo retrieval

**No explicit cron configuration found in repositories** - likely configured externally on server

### 4.4 Script Dependencies & Execution Order

#### Patent Grant Weekly Workflow
1. **Download:** `patent_weekly_download.php` OR `download_files.js`
   - Downloads TAR from USPTO
   - Extracts to XML2 directory
2. **Parse (Parallel):**
   - `patent_xml_file_read.js` - Inventors & basic metadata
   - `grant_read_lawyer_from_xml.js` - Law firms
   - `grant_read_applicant_assignee_from_xml.js` - Applicants/assignees
   - `grant_extension_xml.js` - Extended content (claims, specs, figures)
3. **Post-process:**
   - Move XML from XML2 → XML directory
   - Clean up temporary files

#### Patent Application Weekly Workflow
1. **Download:** `application_weekly_download.php` OR `application_download_files.js`
   - Downloads TAR from USPTO
   - Extracts to XML2 directory
2. **Parse (Parallel):**
   - `application_read_applicant_assignee_from_xml.js` - Applicants/assignees
   - `read_inventor_from_xml.js` - Inventors
3. **Post-process:**
   - Move XML files
   - Clean up

#### Daily Assignment Workflow
1. **Download:** `daily_download.php`
   - Downloads ZIP files for date range
   - Extracts to `./dds/` directory
2. **Parse:** `update_record_daily_xml.php` (called by daily_download.php)
   - Parses assignment XML
   - Updates assignor/assignee records
3. **Cleanup:** Deletes ZIP files after processing

#### CPC Classification Workflow
1. **Download:** `monthly_download_patent_cpc.php` OR `monthly_download_applications_cpc.php`
   - Downloads ZIP from USPTO API
   - Extracts XML files
2. **Parse:** `patent_cpc_read_from_xml.php` OR `application_cpc_read_from_xml.php`
   - Parses CPC XML
   - Inserts into database

#### Name Normalization Workflow
1. **Extract:** Query database for all assignor/assignee/inventor names
2. **Process:** `normalize_names.js`
   - Groups similar names using Levenshtein distance
   - Identifies representative names
   - Outputs JSON with suggestions
3. **Link Inventors:** `inventor_levenshtein.js`
   - Matches inventors to assignors
   - Marks employee relationships

#### Client Database Sync Workflow (tree_script.php)
1. **Find Representatives:** Query organization's representative names
2. **Get RF IDs:** Find all rf_id records for representatives
3. **Flush Client DB:** Delete existing data for these rf_ids
4. **Copy from Central:** INSERT IGNORE from db_uspto to client db_application
   - Representative → Assignor/Assignee → Assignment → Conveyance → Document
5. **Rebuild Relationships:** Link assignors to assignees via representative_id

#### EPO Family Data Workflow
1. **Trigger:** `auto_assets_family.php` loops through organizations
2. **Execute:** Calls `assets_family.js {patent_number}` for each patent
3. **Retrieve:** Queries EPO OPS API for family data
4. **Cache:** Saves XML to `/mnt/volume_sfo2_12/FAMILY/`
5. **Parse:** Extracts family members and inserts to `assets_family` table

### 4.5 Environment Configuration

#### Node.js Environment Variables (via env-cmd)
**File:** `.env` (referenced in scripts)

**Required Variables:**
- `HOST` - Database host
- `USER` - Database username
- `PASSWORD` - Database password
- `DATABASE_BUSINESS`
- `DATABASE_RAW`
- `DATABASE_APPLICATION_BIBLIO_NEW`
- `DATABASE_APPLICATION_NEW`
- `DATABASE_APPLICATION_BIBLIO`
- `DATABASE_GRANT_BIBLIO`
- `DATABASE_PATENT_EXAMINER_DATA`
- `MAIN_FOLDER_PATH` - Working directory for extractions
- `EXTRA_DISK_PATH` - Primary external storage mount
- `EXTRA_DISK_PATH1` - Secondary storage mount
- `EPO_KEY` - EPO API consumer key
- `EPO_SECRET` - EPO API consumer secret
- `BUCKET_NAME` - AWS S3 bucket name
- `BUCKET_PHOTO_DIR` - S3 photos directory
- `BUCKET_REGION` - AWS region (e.g., us-west-1)
- `BUCKET_ACCESS_KEY` - AWS access key ID
- `BUCKET_SECRET_KEY` - AWS secret access key
- `BUCKET_URL` - S3 bucket URL
- `BUCKET_DOCUMENT_DIR` - S3 documents directory
- `BUCKET_FIGURES_DIR` - S3 figures directory

#### PHP Environment Variables (.env)
**File:** `.env` in PHP script directory

**Required Variables:**
- `DB_HOST` - Database host
- `DB_USER` - Database username
- `DB_PASS` - Database password
- `DB_NAME` - Main USPTO database
- `DB_BUSINESS` - Business database
- `DB_APPLICATION_DB` - Application database
- `USPTO_OPEN_API_KEY` - USPTO API key for authenticated endpoints

#### Hardcoded Configuration

**Pusher (Real-time Notifications):**
```php
APPID: 938985
KEY: 3252bb******************db3c (REDACTED)
SECRET: 2a3dd823************5c71 (REDACTED)
CLUSTER: us3
CHANNEL: patentrack-channel
EVENT: patentrack-event
```
Source: `/tmp/uspto-data-sync/noti_config.php` and multiple JS files (hardcoded - SECURITY RISK)

**API Keys (Hardcoded - SECURITY RISK):**
- Clearbit: `sk_****************************` (found in source)
- RiteKit: `9e44da11***************************916d` (found in source)
- UpLead: `977c4d4e***********************026b1` (found in source)

**AWS Credentials (Hardcoded in old scripts - SECURITY RISK):**
```bash
AWS_ACCESS_KEY_ID: AKIA****************** (REDACTED)
AWS_SECRET_ACCESS_KEY: ********************************** (REDACTED)
```
Source: `patent_weekly_download.php` (commented out but present in source code)

#### Database Naming Conventions

**Central Databases:**
- `db_uspto` - Main USPTO data (assignments, representatives, documents)
- `db_business` - Organizations and user accounts
- `db_new_application` - Application data (new schema)
- `db_patent_application_bibliographic` - Application bibliographic data
- `db_patent_grant_bibliographic` - Grant bibliographic data
- `db_patent_maintainence_fee` - Maintenance fee events
- `db_inventor` - Inventor data (separate host)
- `big_data` - Secondary/archive database

**Client Databases:**
- `db_application` - Client-specific application database (per organization)
- Connection details stored in `db_business.organisation` table (fields: `org_host`, `org_usr`, `org_pass`, `org_db`)

---

## 5. Key Observations & Risks

### 5.1 Data Source Observations

**Redundancy:**
- Patent grant and application downloads exist in BOTH repositories
- `download_files.js` (Node.js) and `patent_weekly_download.php` (PHP) download the same data
- Unclear which scripts are actively used vs legacy

**Data Freshness:**
- Daily downloads tracked in `download_tracking` table with resume capability
- Weekly downloads appear manual (no automatic scheduling in code)
- Monthly CPC downloads not automated

**Rate Limiting:**
- USPTO API downloads implement 429 retry logic (1 second sleep, 5 retries max)
- EPO API uses OAuth2 tokens cached to file system
- PatentsView API has no rate limiting observed (may hit limits)

### 5.2 Architecture Risks

**Mixed Technology Stack:**
- Node.js and PHP scripts both access same databases
- Inconsistent error handling between languages
- No centralized orchestration or workflow management

**Database Connection Issues:**
- Multiple hardcoded database credentials
- No connection pooling in PHP scripts
- `ensureConnection()` suggests frequent connection drops

**File System Complexity:**
- Multiple mount points (`/mnt/volume_sfo2_12`, `/mnt/volume_sfo2_14`)
- Temporary files scattered across `/var/www/html/trash/`, `MAIN_FOLDER_PATH`, etc.
- No clear cleanup strategy for old files

**Processing Bottlenecks:**
- XML parsing is sequential (one file at a time)
- No parallel processing framework
- Large XML files (12GB TAR archives) require significant disk I/O

### 5.3 Security Risks

**CRITICAL - Hardcoded Credentials:**
- AWS credentials in source code (even if commented out)
- API keys hardcoded in multiple files
- Pusher credentials in cleartext
- Database credentials in environment files (better but still risky)

**API Key Exposure:**
- Clearbit, RiteKit, UpLead keys in source
- No key rotation mechanism observed
- Keys committed to version control

**Database Access:**
- Root/privileged database users appear to be used
- No role-based access control
- Client databases accessible from central scripts

### 5.4 Data Quality Risks

**Name Normalization Issues:**
- Levenshtein distance thresholds (3-5) may cause false matches
- No manual review process for automated name grouping
- Representative name selection by "highest occurrence" may pick wrong canonical name

**Duplicate Handling:**
- Heavy reliance on `INSERT IGNORE` and `ignoreDuplicates: true`
- Silently skips conflicts without logging
- No deduplication strategy for data updates

**Missing Data:**
- EPO API failures not retried
- Failed PDF downloads not tracked
- No validation of parsed XML completeness

**Date Handling:**
- Multiple date format conversions (YYYYMMDD ↔ YYYY-MM-DD)
- No timezone handling observed
- `ALLOW_INVALID_DATES` set in some scripts

### 5.5 Operational Risks

**No Monitoring:**
- Pusher notifications for progress tracking (limited)
- Log files scattered (no centralized logging)
- No alerting for failed downloads/parsing

**Manual Intervention Required:**
- Weekly downloads not automated
- Script selection unclear (Node.js vs PHP)
- No documented runbook

**Data Loss Potential:**
- Cleanup scripts (`rm -R`) run immediately after processing
- No backup strategy observed
- Failed extractions may lose downloaded TAR files

**Scalability Issues:**
- Single-threaded XML parsing
- No distributed processing
- Database connection exhaustion possible (300k pool for PED)

### 5.6 Maintenance Risks

**Code Duplication:**
- Same logic in JS and PHP (grant/application parsers)
- No shared libraries or common utilities
- Inconsistent error handling patterns

**Legacy Code:**
- Multiple "old_", "back_", "bk_" files suggest abandoned rewrites
- Commented-out code blocks (entire processing sections)
- Unclear which scripts are production vs experimental

**Documentation Gaps:**
- No inline documentation for complex parsing logic
- Environment variable requirements scattered
- Execution order must be inferred from code

**Testing:**
- No unit tests observed
- No integration tests
- No validation of parsed data against source

### 5.7 Compliance Risks

**Data Retention:**
- No clear retention policy
- Old XML files accumulate on disk
- Assignment PDFs uploaded to public S3 bucket (`public-read-write`)

**License Compliance:**
- Uses multiple third-party APIs (PatentsView, EPO, Clearbit, etc.)
- No license terms checked in code
- Usage limits not enforced

### 5.8 Recommended Immediate Actions

1. **Security:**
   - Remove all hardcoded credentials from source code
   - Migrate to secret management system (AWS Secrets Manager, HashiCorp Vault)
   - Implement API key rotation

2. **Monitoring:**
   - Centralize logging (ELK stack, CloudWatch, etc.)
   - Add alerting for failed downloads/parsing
   - Track data freshness metrics

3. **Consolidation:**
   - Choose single technology stack (Node.js OR PHP)
   - Eliminate redundant download scripts
   - Archive/delete legacy code

4. **Automation:**
   - Implement proper scheduling (cron + monitoring)
   - Add workflow orchestration (Apache Airflow, AWS Step Functions)
   - Automate weekly/monthly downloads

5. **Data Quality:**
   - Add validation after parsing (row counts, required fields)
   - Implement data quality checks
   - Log skipped/failed records

6. **Documentation:**
   - Create architectural diagram
   - Document execution order and dependencies
   - Maintain runbook for manual interventions
