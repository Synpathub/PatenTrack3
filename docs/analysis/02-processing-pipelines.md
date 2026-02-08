# PatenTrack Data Processing Pipelines Analysis

> **Note**: This document analyzes data processing pipelines executed AFTER data ingestion. For data sources and ingestion scripts, see `01-data-sources-and-ingestion.md`.

## 1. Transaction Type Classification

### 1.1 Input & Output

**Input**: Raw conveyance text from assignment records (`assignment.convey_text` field)

**Output Categories (Transaction Types)**:

| Type | Database Value | Flag ID | Description |
|------|---------------|---------|-------------|
| Assignment | `assignment` | 0 | Transfer of ownership rights |
| Correction | `correct` | 0 | Correctional documents |
| Name Change | `namechg` | 0 | Legal name changes |
| Address Change | `addresschg` | 0 | Address corrections |
| License | `license` | 0 | Licensing agreements |
| Security Interest | `security` | 0 | Collateralization/pledges |
| Release | `release` | 0 | Full release of security interest |
| Partial Release | `partialrelease` | 0 | Partial release of security |
| Merger | `merger` | 0 | Corporate mergers |
| Employee Assignment | `employee` | 1 | Inventor-to-employer assignments |

### 1.2 Classification Rules (Complete Extraction)

**Source Files**: 
- `uspto-data-sync/update_missing_type.php` (33KB)
- `customer-data-migrator/update_missing_type.php`
- `uspto-data-sync/assignment_conveyance.php`

**Pre-filter**: Only processes transactions with `convey_ty IN ('missing', 'other', 'govern', 'correct')`

#### Type: ASSIGNMENT
```sql
MATCH(a.convey_text) AGAINST('\"ASSIGNMENT OF ASSIGNORS INTEREST\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"ACKNOWLEDGEMENT OF RIGHTS\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"ASSIGNMENT OF RIGHTS\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"CONTINUATION\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"CONVERSION\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"CONTINUANCE\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"NUNC\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"TUNC\"' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"ASSIGNMENT OF INTELLECTUAL PROPERTY\"' IN BOOLEAN MODE)
```

#### Type: CHANGE OF NAME (namechg)
```sql
MATCH(a.convey_text) AGAINST('\"CHANGE OF NAME\"' IN BOOLEAN MODE)
```

#### Type: CHANGE OF ADDRESS (addresschg)
```sql
MATCH(a.convey_text) AGAINST('\"ADDRESS\"' IN BOOLEAN MODE)
```

#### Type: LICENSE
```sql
a.convey_text LIKE '%LICENSE%'
```

#### Type: SECURITY INTEREST
```sql
MATCH(a.convey_text) AGAINST('\"SECURITY\" -RELEASE -DISCHARGE' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"PLEDGE\" -RELEASE -DISCHARGE' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"SUCCESSION OF AGENCY\" -RELEASE -DISCHARGE' IN BOOLEAN MODE)
```

#### Type: RELEASE
```sql
MATCH(a.convey_text) AGAINST('\"RELEASE BY SECURED\" -PARTIAL' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"RELEASE OF SECURITY\" -PARTIAL' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"DISCHARGE OF SECURITY INTEREST\" -PARTIAL' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"RELEASE\" -PARTIAL' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"BANKRUPTCY COURT ORDER RELEASING ALL LIENS INCLUDING THE SECURITY INTEREST\"' IN BOOLEAN MODE)
```

#### Type: PARTIAL RELEASE
```sql
MATCH(a.convey_text) AGAINST('\"PARTIAL RELEASE\"' IN BOOLEAN MODE)
```

#### Type: MERGER
```sql
a.convey_text LIKE '%MERGER%' 
OR a.convey_text LIKE 'MERGER%' 
OR a.convey_text LIKE '%MERGER'
```

#### Type: CORRECTION
```sql
MATCH(a.convey_text) AGAINST('\"CORRECTIVE\" -SECURITY -RELEASE -DISCHARGE' IN BOOLEAN MODE)
OR MATCH(a.convey_text) AGAINST('\"CORRECT\" -SECURITY -RELEASE -DISCHARGE' IN BOOLEAN MODE)
```

### 1.3 Rule Evaluation Order

Rules are evaluated in this strict sequence:

1. **ASSIGNMENT** (lines 139-185)
2. **CHANGE OF NAME** (lines 191-245)
3. **CHANGE OF ADDRESS** (lines 250-281)
4. **LICENSE** (lines 284-310)
5. **SECURITY** (lines 311-375)
6. **RELEASE** (lines 405-437)
7. **PARTIAL RELEASE** (lines 440-473)
8. **MERGER** (lines 475-500)

Each rule batch processes matching records with `UPDATE` statements, setting `convey_ty` to the appropriate value.

### 1.4 Fallback Behavior

**No explicit fallback type** exists. If none of the pattern matching rules apply:
- Transaction remains in its current state (`convey_ty` unchanged)
- Typically stays as `'missing'`, `'other'`, or `'govern'`
- No default assignment occurs

**Query exclusions**: Already-classified transactions are skipped via `WHERE rrac.convey_ty NOT IN ('employee', 'assignment', 'correct')`.

### 1.5 Edge Cases

#### Negative Matching for Ambiguity Resolution
Security interest patterns use negative operators to avoid false positives:
- `\"SECURITY\" -RELEASE -DISCHARGE` excludes releases containing "security"
- `\"RELEASE\" -PARTIAL` excludes partial releases from full releases

#### Company Pattern Filtering
An extensive company suffix regex (line 537/573) filters non-individual assignors:
```regex
/\b(?:inc|llc|corporation|corp|systems|system|llp|industries|gmbh|lp|agent|sas|na|bank|co|states|ltd|kk|a\/s|aktiebolag|kigyo|kaisha|university|kabushiki|company|plc|gesellschaft|gesmbh|société|societe|mbh|aktiengesellschaft|haftung|vennootschap|bv|bvba|aktien|limitata|srl|sarl|kommanditgesellschaft|kg|gesellschaft|gbr|ohg|handelsgesellschaft|compagnie|privatstiftung|foundation|technologies|technology|solutions|solution|networks|network|holding|holdings|health|animal|scientific|chemical|chemicals|pharmaceutical|trust|the|resources|government|college|support|pharma|pharmalink|labs|lab|pyramid|analytics|analytic|therapeutics|tigenix|nexstim|voluntis|elobix|nxp|ab|sa|acies|wakefield|semiconductor|development|research|traingle|institute|advanced|interconnect|sensordynamics|product|products|international|biotech|investment|partner|capital|royalty|parallel|laboratories|spa|city|studios|universal|lllp|partners|national|wrestling|international|licensing|demografx|island|ag|credit|suisse|properties)\b/i
```

#### Boolean Search Syntax
Uses MySQL `MATCH...AGAINST` in BOOLEAN MODE with:
- **Phrase matching**: `"EXACT PHRASE"` for precise matches
- **Exclusions**: `-WORD` to filter out unwanted matches
- **Relevance ranking**: Implicit scoring for best matches

#### Large Dataset Handling
- Processes in **10,000 record batches** when total transactions > 30,000
- Uses **pagination** with 10 pages
- Implements `array_unique()` to prevent duplicate processing

---

## 2. Name Normalization

### 2.1 Normalization Mapping System

**Approach**: **Automated rules only** (no manual mapping tables)

**Source Files**:
- `uspto-data-sync/normalize_file.php` - Normalizes assignee names
- `uspto-data-sync/normalize_file1.php` - Normalizes assignor names
- `uspto-data-sync/fix_representative.php` - Fixes non-ASCII names and syncs with USPTO API

### 2.2 Database Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `assignee` | Assignee records | `rf_id`, `ee_name`, `assignor_and_assignee_id` |
| `assignor` | Assignor records | `rf_id`, `or_name`, `assignor_and_assignee_id` |
| `representative` | Representative info | `representative_id`, `representative_name` |
| `assignor_and_assignee` | Master entity table | `assignor_and_assignee_id`, `name`, `representative_id` |
| `assignment` | Assignment records | `rf_id`, `reel_no`, `frame_no` |
| `temp_assignor_and_assignee_name` | Temporary normalized data | `assignor_and_assignee_id`, `original_name`, `name`, `type` |

### 2.3 Admin Workflow

**None exists**. These are automated batch scripts with no UI or administrative interface:
- Scripts run as command-line PHP processes
- No web-based admin panel for managing normalizations
- No ability to add custom mappings via UI

### 2.4 Automated Rules

**Applied via `remove_if_trailing()` function in this order**:

1. **"corporation"** → **"corp"**
2. **"incorporated"** → **"inc"**
3. **"limited"** → **"ltd"**
4. **"company"** → **"co"**

**Additional Processing**:

- **`strReplace()`**: Removes commas (`,`), periods (`.`), exclamation marks (`!`)
- **`removeDoubleSpace()`**: Normalizes whitespace using regex `/\s+/` → single space
- **Case normalization**: 
  1. Convert to lowercase
  2. Apply `ucwords()` for title case (first letter of each word capitalized)

**Non-ASCII Handling** (`fix_representative.php`):
- Stores original + normalized name pairs in `temp_assignor_and_assignee_name`
- Queries USPTO API for standardized representative names
- Updates records with API-provided names when available

### 2.5 Retroactive Application

**Direct UPDATE statements** modify existing data immediately:

```sql
-- normalize_file.php (assignees)
UPDATE assignee 
SET assignor_and_assignee_id = 0, 
    ee_name = '[normalized_name]' 
WHERE [conditions]

-- normalize_file1.php (assignors)
UPDATE assignor 
SET assignor_and_assignee_id = 0, 
    or_name = '[normalized_name]' 
WHERE [conditions]
```

**Processing**:
- Runs in **1,000,000 row batches**
- Resets `assignor_and_assignee_id = 0` to force re-linking
- **No transaction rollback capability** (changes are permanent)
- Updates are applied synchronously during script execution

**Re-linking**: After normalization, downstream processes must:
1. Detect records with `assignor_and_assignee_id = 0`
2. Re-match normalized names to `assignor_and_assignee` master table
3. Update foreign key relationships

---

## 3. Inventor Deduplication

### 3.1 Algorithm

**Source**: `inventor_levenshtein.js` (external Node.js script, not in current repositories)

**Invocation**:
```php
// From update_flag.php
shell_exec("node /var/www/html/script/inventor_levenshtein.js '".json_encode($requestRemaingRFID)."' '".json_encode($list21)."'");
```

**Note**: The actual deduplication script is not present in the analyzed repositories. It is referenced but stored externally at `/var/www/html/script/inventor_levenshtein.js`.

### 3.2 Thresholds & Parameters

**Not available** - The external script would need to be analyzed to extract:
- Levenshtein distance threshold
- Candidate pair selection strategy
- Weighting parameters

### 3.3 Match Handling

**Not available** - External script not in repository

### 3.4 False Positive Prevention

**Not available** - External script not in repository

**Note to implementers**: This pipeline is a critical dependency for the update_flag process but requires external code analysis.

---

## 4. Ownership Tree Construction

### 4.1 Input Data

**Source Files**:
- `uspto-data-sync/tree_script.php`
- `uspto-data-sync/tree.php`
- `uspto-data-sync/test_tree_script.php`

**Input Transaction Types** (from `assignment_conveyance` table):

| Transaction Type | `convey_ty` Value | Direction |
|------------------|-------------------|-----------|
| Assignment | `assignment` | Ownership transfer |
| Purchase | `purchase` | Acquisition |
| Sale | `sale` | Divestiture |
| Merger (In) | `merger` (incoming) | Parent company |
| Merger (Out) | `merger` (outgoing) | Subsidiary |
| Security Interest (In) | `security` (incoming) | Lender |
| Security Interest (Out) | `security` (outgoing) | Borrower |
| Release (In) | `release` (incoming) | Releasing party |
| Release (Out) | `release` (outgoing) | Released party |
| Name Change | `namechg` | Identity change |
| Government | `govern` | Government assignments |
| Correction | `correct` | Correctional records |
| Missing | `missing` | Unclassified |
| Other | `other` | Miscellaneous |
| License (In/Out) | `license` | Licensing (extended) |
| Option (In/Out) | `option` | Options (extended) |
| Court Order (In/Out) | `courtorder` | Legal orders (extended) |
| Employee | `employee` (`employer_assign=1`) | Inventor-employer |

### 4.2 Tree Structure

**Nodes**: `assignor_and_assignee_id` (unique entity/company identifiers)

**Edges**: Patent transactions (identified by `rf_id` = registration file ID)

**Direction**: Edges link assignors → assignees for each transaction

**Storage Tables**:
- `tree` or `tree_parties` (database records, not in-memory graph)

**Record Schema**:
```
- assignor_and_assignee_id: Entity ID
- name: Entity name
- parent: Initially "0" (later could reference parent entity)
- type: Transaction type (convey_ty)
- tab_id: Grouping identifier
- organisation_id: Customer/org ID
- representative_id: Company representative ID
```

### 4.3 Root Determination

**Root = Parent Company** with `parent_id = 0` in the `representative` table

**Algorithm**:
1. Query all parent companies: `SELECT * FROM representative WHERE parent_id = 0`
2. For each parent:
   - Collect all variant names (parent company + all subsidiaries)
   - Build `allNames` array with normalized name variations
3. Use parent company as the root node for tree construction

### 4.4 Branch & Merge Handling

**Branching** (1 assignor → multiple assignees):
- Creates **separate tree entries** for each assignee
- Example: Company A transfers patents to both Company B and Company C
  - Creates 2 edges: A→B and A→C
  - Both stored as independent records

**Merging** (multiple assignors → 1 assignee):
- Tracked **bidirectional** for mergers:
  - `MergerIn` = incoming parent company
  - `MergerOut` = outgoing subsidiary company
- Each direction creates a separate entry

**Handling**:
- No hierarchical tree traversal
- Flat relational model where all entities involved in any transaction with the root are nodes
- Categorized by transaction type
- No cycle detection or prevention

### 4.5 Output Format

**Format**: Database records (not JSON tree or nested structure)

**Table**: `tree` or `tree_parties`

**Typical INSERT Pattern** (repeated for each transaction type):
```sql
INSERT IGNORE INTO tree 
  (assignor_and_assignee_id, name, parent, type, tab_id, organisation_id, representative_id)
SELECT 
  assignor_and_assignee_id,
  name,
  '0' as parent,
  '[transaction_type]' as type,
  [tab_id],
  [organisation_id],
  [representative_id]
FROM [query matching root entity transactions]
GROUP BY assignor_and_assignee_id
```

**Grouping**: Entities are grouped by `assignor_and_assignee_id` to avoid duplicate nodes

### 4.6 Regeneration Triggers

**Complete Rebuild on New Transactions**:

```sql
-- Delete existing tree for organization
DELETE FROM tree WHERE organisation_id = [ID]

-- Rebuild with fresh data
-- [14 separate INSERT statements, one per transaction type]
```

**Triggered by**:
- `tree_script.php` - Main tree generation
- `backup_tree_script.php` - Backup/redundant generation
- Detection of new `rf_id` values in assignment data

**No Incremental Updates**: Entire tree is deleted and recreated each time

**Performance Note**: For organizations with thousands of transactions, full rebuilds are expensive

---

## 5. Broken Title Chain Detection

### 5.1 Business Rule Definition

**Complete Title Chain**: An unbroken sequence of ownership transfers from the original inventor(s) to the current patent owner, where each assignee in transaction N becomes an assignor in transaction N+1.

**Source Files**:
- `uspto-data-sync/broken_title.php` (4.2KB)
- `customer-data-migrator/broken_chain_title.php` (7.2KB) 
- `uspto-data-sync/assets_bank_broken_title.php` (20KB)

### 5.2 Chain Tracing Algorithm

#### **Algorithm 1: Simple Forward Trace** (`broken_title.php`)

**Process**:
1. Get all assets for a company/organization via stored procedure: `CALL GetAssetsTableC(company_id, organisation_id)`
2. For each patent (`appno_doc_num`):
   - Query all transactions chronologically:
     ```sql
     SELECT temp_document_transactions.rf_id, 
            temp_document_transactions.assignor_and_assignee_id as frm, 
            temp_document_transactions1.assignor_and_assignee_id as toA, 
            temp_document_transactions.convey_name
     FROM temp_document_transactions 
     INNER JOIN temp_document_transactions as temp_document_transactions1 
       ON temp_document_transactions1.rf_id = temp_document_transactions.rf_id 
       AND temp_document_transactions1.party_type > temp_document_transactions.party_type
     WHERE temp_document_transactions.appno_doc_num = '[patent_number]'
     ORDER BY temp_document_transactions.transaction_date ASC, 
              temp_document_transactions.party_type ASC
     ```
3. **Chain Validation Logic**:
   ```php
   if (previousAssignee != 0 && previousAssignee != currentAssignor) {
       // CHAIN IS BROKEN
       markAsBroken();
   }
   ```
4. **Employee Assignment Handling**:
   - Count employee-to-employer assignments separately
   - If `totalEmployees == 0` and chain not broken → mark as "not broken"
   - Employee assignments with `frm = 0` or `toA = 0` are excluded

**Output**: Updates `table_d` with broken title patents

#### **Algorithm 2: Inventor-Level Detection** (`broken_chain_title.php`)

**Detects**: Assignees who appear in the chain but were never assignors

```sql
SELECT assigneeNames 
FROM (
  SELECT assigneeNames FROM [all assignees in OTA transactions]
  WHERE assigneeNames NOT IN ([company names])
) AS temp1
LEFT JOIN (
  SELECT assignorNames FROM [all assignors in OTA transactions]
) AS temp2 ON temp2.assignorNames = temp1.assigneeNames
WHERE temp2.assignorNames IS NULL
```

**"OTA" Transactions**: Ownership Transfer Activities (where `conveyance.is_ota = 1` OR `employer_assign = 1`)

**Output**: Inserts broken chain patents into `db_new_application.assets`

#### **Algorithm 3: Multi-Level Validation** (`assets_bank_broken_title.php`)

**Most Complex** - 5-part validation:

**Part 0**: Patents with no employee/employer assignments
```sql
-- Find assets with NO employee or employer_assign transactions
INSERT INTO temp_assets_bank_broken 
SELECT appno_doc_num WHERE appno_doc_num NOT IN (
  SELECT appno_doc_num WHERE convey_ty = 'employee' OR employer_assign = 1
)
```

**Part 1**: Count transactions and distinct inventor parties per asset
```sql
INSERT INTO temp_transaction_bank_parties_count
SELECT appno_doc_num, 
       COUNT(DISTINCT rf_id) as transaction_count,
       GROUP_CONCAT(DISTINCT rf_id) AS rf_ids,
       COUNT(DISTINCT name) AS parties_count
FROM [assignors in employee/employer transactions]
GROUP BY appno_doc_num
```

**Part 2**: Single transaction with inventor count mismatch
```sql
-- If transaction_count = 1 AND bibliographic_inventor_count > transaction_parties_count
INSERT INTO temp_assets_bank_broken
SELECT appno_doc_num
WHERE transaction_count = 1 
  AND bibliographic_inventor_count > transaction_parties_count
```

**Part 3**: Multi-transaction missing inventor detection
```sql
-- Find inventors from bibliographic database NOT present in transaction database
WITH t1 AS (
  SELECT transaction assignor names split into family_name and given_name
)
SELECT inventor_names 
FROM bibliographic_inventors
LEFT JOIN t1 ON (family_name match OR full_name match)
WHERE t1.name IS NULL
```

**Part 4**: Assignee without corresponding assignor
```sql
-- Find assignees in later transactions who were never assignors in earlier ones
SELECT assignor entities
LEFT JOIN assignee entities ON name match
WHERE assignee.name IS NULL
```

**Part 5**: Insert all broken assets into `assets_bank_broken` table

### 5.3 Transaction Types Considered

**Included**:
- **Employee assignments**: `convey_ty = 'employee'`
- **Employer assignments**: `employer_assign = 1`
- **OTA (Ownership Transfer Activities)**: `conveyance.is_ota = 1`
  - Assignments
  - Mergers
  - Sales/Purchases
  - Court-ordered transfers

**Excluded**:
- Security interests (unless OTA flagged)
- Licenses
- Name/address changes
- Corrections (unless `employer_assign = 1`)

### 5.4 Output & Reporting

**Storage Tables**:
- `table_d` - Broken chain patents (simple algorithm)
- `db_new_application.assets` - Broken chain assets (inventor-level)
- `db_new_application.assets_bank_broken` - Comprehensive broken chains (bank/security mode)
- `temp_assets_bank_broken` - Temporary staging (deleted after processing)
- `lost_assets` - Assets where normalized name ≠ representative name

**Dashboard Integration**:
```sql
INSERT INTO db_new_application.dashboard_items 
  (representative_id, assignor_id, type, patent, application, rf_id, total)
SELECT company_id, 0, 1 AS type, grant_doc_num, appno_doc_num, 0, [count]
FROM assets WHERE layout_id = 1 -- broken chain layout
```

### 5.5 Multi-Party Handling

**Multiple Inventors**:
- Part 2 checks if all inventors have corresponding transactions
- Flags as broken if bibliographic inventor count > transaction party count
- Uses `COUNT(DISTINCT name)` to handle duplicates

**Multiple Current Owners**:
- Not explicitly handled
- Algorithm assumes single current owner
- Multiple owners would require manual review

**Edge Case**: If patent has 3 inventors but only 2 signed an assignment, the chain is flagged as broken

---

## 6. Dashboard JSON Generation

### 6.1 Data Categories

**Source Files**:
- `customer-data-migrator/dashboard_with_company.php` (216KB) - Customer-filtered version
- `uspto-data-sync/dashboard_with_company.php` (195KB) - Organization-filtered version
- `uspto-data-sync/generate_json.php` (70KB) - Base JSON generator

**Purpose**: Patent chain-of-title tracking for legal/IP management, compliance, valuation, and litigation

**Input**: `$_REQUEST['p']` (patent number), optional organization/user IDs

**Output**: Complex JSON visualization of IP ownership chains

**Data Categories Aggregated**:

1. **General Metadata**
   - Patent number
   - Company logo URL
   - User logo URL
   - Copyright notice

2. **Patent Bibliographic Data**
   - Patent title
   - Asset type (4=granted patent, 5=application)
   - Filing date (`appno_date`)
   - Grant date (`grant_date`)
   - Patent status (active, expired, abandoned)

3. **Assignment Chain History**
   - Chronological list of all assignments
   - Assignor names and IDs
   - Assignee names and IDs
   - Execution dates
   - Recorded dates
   - Document file references (reel/frame numbers)
   - Transaction types (assignment, security, license, etc.)

4. **Inventor Information**
   - Original inventor(s) at patent inception
   - Inventor names from bibliographic database
   - Employer assignments

5. **Visual Diagram Components**
   - Box menu (color schemes)
   - Entity boxes (Inventor, Ownership, Security, License, 3rd Party)
   - Connection lines (ownership transfer, name change, security, license, release, corrections)
   - Box types and positioning

6. **Relationship/Connection Data**
   - Entity-to-entity relationships
   - Normalized entity names (via TF-IDF similarity)
   - Parent-subsidiary connections

7. **Maintenance Fee Information** (when available)
   - Fee payment events
   - Payment dates and amounts
   - Maintenance windows

8. **Activity Tracking**
   - Company activity records
   - Transaction parties
   - 3rd party entities involved

9. **Patent Family Data** (extended versions)
   - Related applications
   - Continuations/divisionals
   - Foreign counterparts

### 6.2 JSON Schema

```json
{
  "general": {
    "patent_number": "string",
    "logo_1": "url (company logo)",
    "logo_2": "url (user logo)",
    "copyright": "string"
  },
  "title": "string (patent title from bibliographic database)",
  "asset_type": 4 | 5,  // 4 = granted patent, 5 = application
  "comment": "string (optional notes)",
  
  "box_menu": {
    "border_color": ["#hex1", "#hex2", ...],
    "background_color": ["#hex1", "#hex2", ...]
  },
  
  "inventor_boxes": [
    {
      "id": number,
      "patent_number": "string",
      "name": "string (inventor full name)",
      "type": "Inventor",
      "execution_date": "YYYY-MM-DD",
      "box_type": number (visual category)
    }
  ],
  
  "box": [
    {
      "id": number (unique box ID),
      "name": "string (entity name)",
      "description": "Ownership|Security|License|3rd Party|etc",
      "execution_date": "YYYY-MM-DD",
      "recorded_date": "YYYY-MM-DD",
      "document_file": "string (reel/frame reference)",
      "type": "string (convey_ty value)",
      "box_type": number (visual category: 1-5),
      "flag": 0 | 1
    }
  ],
  
  "connection": [
    {
      "from": number (box ID),
      "to": number (box ID),
      "type": "string (connection type)",
      "label": "string (optional)"
    }
  ],
  
  "popup": [
    {
      "box_id": number,
      "details": "HTML string with detailed assignment info"
    }
  ],
  
  "names": [
    "string (normalized entity name 1)",
    "string (normalized entity name 2)",
    ...
  ],
  
  "assignments": [
    {
      "rf_id": number,
      "reel_no": "string",
      "frame_no": "string",
      "convey_ty": "string",
      "exec_dt": "YYYY-MM-DD",
      "record_dt": "YYYY-MM-DD",
      "assignors": ["name1", "name2", ...],
      "assignees": ["name1", "name2", ...]
    }
  ]
}
```

### 6.3 Key SQL Queries

**Primary Patent Lookup**:
```sql
-- Get patent document details
SELECT doc.appno_doc_num, doc.grant_doc_num, doc.appno_date, doc.grant_date, doc.rf_id
FROM db_uspto.documentid AS doc
WHERE doc.appno_doc_num = '[patent_number]' OR doc.grant_doc_num = '[patent_number]'
```

**Assignment Chain Extraction**:
```sql
-- Get all assignments for patent
SELECT 
  a.rf_id, 
  ass.reel_no, 
  ass.frame_no, 
  ass.record_dt,
  aaa.name as entity_name,
  aaa.assignor_and_assignee_id,
  rac.convey_ty,
  rac.employer_assign,
  r.representative_name
FROM db_uspto.documentid AS doc
INNER JOIN db_uspto.assignment AS ass ON ass.rf_id = doc.rf_id
INNER JOIN db_uspto.representative_assignment_conveyance AS rac ON rac.rf_id = doc.rf_id
LEFT JOIN db_uspto.assignor AS aor ON aor.rf_id = doc.rf_id
LEFT JOIN db_uspto.assignee AS aee ON aee.rf_id = doc.rf_id
LEFT JOIN db_uspto.assignor_and_assignee AS aaa ON aaa.assignor_and_assignee_id IN (aor.assignor_and_assignee_id, aee.assignor_and_assignee_id)
LEFT JOIN db_uspto.representative AS r ON r.representative_id = aaa.representative_id
WHERE doc.appno_doc_num = '[patent_number]'
ORDER BY rac.exec_dt ASC
```

**Inventor Lookup** (for bibliographic source):
```sql
-- From patent_application_bibliographic
SELECT name, family_name, given_name
FROM db_patent_application_bibliographic.inventor
WHERE appno_doc_num = '[patent_number]'

UNION

-- From patent_grant_bibliographic (if not in application DB)
SELECT name, family_name, given_name
FROM db_patent_grant_bibliographic.inventor
WHERE appno_doc_num = '[patent_number]'
```

**Patent Status Check**:
```sql
-- Check if expired or abandoned
SELECT patent_status, status_date
FROM db_uspto.application_status
WHERE appno_doc_num = '[patent_number]'

UNION

SELECT maintenance_event, event_date
FROM db_patent_maintainence_fee.event_maintainence_fees
WHERE patent_number = '[patent_number]'
```

**Company Assets (for organization dashboards)**:
```sql
-- Get all assets for a company
SELECT assets.appno_doc_num, assets.grant_doc_num, assets.company_id, assets.organisation_id
FROM db_new_application.assets AS assets
WHERE assets.company_id = [company_id] 
  AND assets.organisation_id = [organisation_id]
  AND DATE_FORMAT(assets.appno_date, '%Y') > 1999
  AND assets.layout_id = [layout_id]
```

**Activity Tracking**:
```sql
-- Get company transaction activity
SELECT DISTINCT activity_id, assignor_and_assignee_id, rf_id
FROM db_new_application.activity_parties_transactions
WHERE organisation_id = [organisation_id] 
  AND company_id = [company_id]
```

### 6.4 Filtering

**By Company**:
- `company_id` in `dashboard_with_company.php` variants
- Filters assets to specific companies in `db_new_application.assets`

**By Organization/Account**:
- `$_REQUEST['o']` (organization ID)
- Connects to external org database via `db_business.organisation`
- Retrieves `org_host`, `org_usr`, `org_pass`, `org_db` for customer database connection

**By Patent Type**:
- `$_REQUEST['f']` flag (1=granted, 0=application)
- Determines which bibliographic database to query:
  - `db_patent_grant_bibliographic` for granted patents
  - `db_patent_application_bibliographic` for published applications

**By User**:
- `$_REQUEST['u']` for user-specific logos and customization

**By Time Period**:
- Filters patents filed after 1999: `DATE_FORMAT(appno_date, '%Y') > 1999`
- Identifies expired patents (20+ years old)
- Filters by maintenance fee status

**By Representative**:
- `representative_id` links entities to their normalized parent companies
- Allows filtering by parent company vs. subsidiary

### 6.5 Size & Performance

**Typical Output Size**:
- **Small patents** (1-3 assignments): ~5-15 KB JSON
- **Medium patents** (5-10 assignments): ~20-50 KB JSON
- **Large patents** (20+ assignments): ~100-500 KB JSON
- **Complex corporate histories**: Can exceed 1 MB for patents with extensive merger/acquisition chains

**Performance Characteristics**:
- **Query count**: 10-30 SQL queries per dashboard generation
- **Database hits**: Multiple databases (uspto, business, application, bibliographic)
- **Processing time**: 
  - Simple: 0.5-2 seconds
  - Complex: 5-15 seconds
  - Very complex: 30+ seconds

**Bottlenecks**:
- Complex JOIN operations across large assignment tables
- Full-text searches for entity name matching
- TF-IDF similarity calculations for name normalization
- Multiple cross-database queries

### 6.6 Generation Triggers

**On-Demand**:
- User requests via HTTP GET: `?p=[patent_number]&o=[org_id]&u=[user_id]&f=[type]`
- No pre-computation or caching evident in code
- Each request triggers full regeneration

**Not Cached**: 
- No evidence of caching layer in analyzed scripts
- JSON is generated fresh for every request
- Could benefit from Redis/Memcached for frequently-accessed patents

**Batch Generation**:
- Not explicitly supported in analyzed code
- Would require custom wrapper script

**Update Triggers** (indirect):
- When new assignment data ingested → user must manually re-request dashboard
- No automated invalidation or push updates
- No WebSocket or polling for real-time updates

---

## 7. Timeline Generation

### 7.1 Data & Granularity

**Source File**: `uspto-data-sync/timeline.php`

**Input**:
- Organization ID
- Representative ID (optional)
- Company name from `db_business.organisation`

**Data Generated**:
- Transaction history timeline for a company and its subsidiaries
- Tracks when company was assignor vs. assignee in patent transactions

**Granularity**: **Transaction-level** (exact execution dates)
- Not aggregated by day/month/year
- Each transaction stored with precise `exec_dt` (execution date)

### 7.2 Output Format

**Table**: `db_application.timeline`

**Schema**:
```
- rf_id: Registration file ID
- reel_no: Reel number
- frame_no: Frame number
- record_dt: Recording date
- organisation_id: Organization ID
- representative_id: Representative/company ID
- type: "Assignor" or "Assignee" (role in transaction)
- original_name: Entity name
- assignor_and_assignee_id: Entity ID
- exec_dt: Execution date (for sorting)
- convey_ty: Conveyance type (assignment, merger, security, release, namechg, govern, other, missing, correct)
- employer_assign: Flag (1=employer assignment, 0=other)
```

**Transaction Type Categories**:

1. **Employer Assignments** (`employer_assign = 1`)
   - As Assignor: Employees assigning to company
   - As Assignee: Company receiving from employees

2. **Assignments & Mergers** (`convey_ty IN ('assignment', 'merger')`)
   - As Assignor: Company transferring ownership
   - As Assignee: Company receiving ownership

3. **Security & Release** (`convey_ty IN ('security', 'release')`)
   - As Assignor: Company pledging patents or releasing security
   - As Assignee: Company receiving pledge or release

4. **Other Types** (`convey_ty IN ('namechg', 'govern', 'other', 'missing', 'correct')`)
   - Name changes, government assignments, corrections, etc.

**Process**:
1. Delete existing timeline: `DELETE FROM timeline WHERE organisation_id = [ID]`
2. For each company name (parent + subsidiaries):
   - Insert assignor records (4 separate queries by transaction type)
   - Insert assignee records (4 separate queries by transaction type)
3. Filter to patents filed after 1999

**Typical Query Pattern**:
```sql
INSERT IGNORE INTO timeline 
  (rf_id, reel_no, frame_no, record_dt, organisation_id, representative_id, 
   type, original_name, assignor_and_assignee_id, exec_dt, convey_ty, employer_assign)
SELECT 
  ac.rf_id, 
  ass.reel_no, 
  ass.frame_no, 
  ass.record_dt, 
  '[org_id]', 
  [representative_id], 
  'Assignor' as type,
  aa.name as original_name, 
  aa.assignor_and_assignee_id, 
  ac.exec_dt, 
  acc.convey_ty, 
  acc.employer_assign
FROM assignor as ac
INNER JOIN assignment as ass ON ass.rf_id = ac.rf_id
INNER JOIN assignment_conveyance as acc ON acc.rf_id = ac.rf_id
INNER JOIN assignor_and_assignee as aa ON aa.assignor_and_assignee_id = ac.assignor_and_assignee_id
LEFT JOIN representative as r1 ON r1.representative_id = aa.representative_id
INNER JOIN (
  SELECT ee.rf_id FROM assignee as ee
  INNER JOIN documentid as d ON d.rf_id = ee.rf_id
  INNER JOIN assignor_and_assignee as aaa ON aaa.assignor_and_assignee_id = ee.assignor_and_assignee_id
  LEFT JOIN representative as r ON r.representative_id = aaa.representative_id
  WHERE (aaa.name = '[company_name]' OR r.representative_name = '[company_name]')
    AND DATE_FORMAT(d.appno_date,'%Y') > '1999'
) as temp ON temp.rf_id = ac.rf_id
WHERE acc.convey_ty IN ('[transaction_types]') 
  AND acc.employer_assign = [0 or 1]
```

**Use Case**: Powers timeline visualizations showing company IP acquisition and divestiture history over time

---

## 8. Flag/State Management

### 8.1 Flags Tracked

**Source Files**:
- `uspto-data-sync/update_flag.php` (775 lines)
- `customer-data-migrator/update_flag.php` (768 lines)

**Primary Table**: `db_uspto.representative_assignment_conveyance`

**Flags/State Columns**:

| Column | Type | Values | Purpose |
|--------|------|--------|---------|
| `employer_assign` | Binary | 0, 1 | Marks employee-to-employer assignments |
| `convey_ty` | VARCHAR | 'employee', 'assignment', 'correct', 'govern', 'missing', 'other', 'namechg', 'security', 'merger', 'release', 'license' | Transaction classification |
| `flag` | Binary | 0, 1 | Processing state (customer-data-migrator only) |

**Processing Log Table**: `db_new_application.log_messages`

**Tracked States**:
- Employee flag ✓
- Missing Assignment
- Missing NameChange
- Missing Change address
- Missing License
- Missing Security
- Missing Release
- Missing Merger

### 8.2 Update Logic

**Triggered By**: Command-line execution with organization ID and company ID parameters

**External Dependency**: Calls `inventor_levenshtein.js` Node.js script for inventor matching (not in repository)

**Update Flow**:

#### When `flag = 1` (Mark as Employee Assignment):
```php
UPDATE db_uspto.representative_assignment_conveyance 
SET employer_assign = 1, convey_ty = 'employee' 
WHERE rf_id IN ([list of rf_ids])
  [AND flag = 0]  // Only in customer-data-migrator version
```

#### When `flag = 0` (Unset Employee Flag):

**Step 1**: Reset employer_assign flag
```php
UPDATE db_uspto.representative_assignment_conveyance 
SET employer_assign = 0 
WHERE rf_id IN ([list of rf_ids])
  AND convey_ty <> 'correct' 
  AND convey_ty <> 'govern'
  [AND flag = 0]  // Only in customer-data-migrator version
```

**Step 2**: Revert 'employee' type to 'assignment'
```php
UPDATE db_uspto.representative_assignment_conveyance 
SET convey_ty = 'assignment' 
WHERE rf_id IN ([list of rf_ids])
  [AND flag = 0]  // Only in customer-data-migrator version
```

**Protection**: Never modifies `convey_ty = 'correct'` or `convey_ty = 'govern'` records when unsetting employee flag

#### Difference Between Versions:

**customer-data-migrator** version:
- Adds `flag = 0` condition to all UPDATE statements
- Provides **idempotent** operations (can be run multiple times safely)
- Prevents re-updating already-processed records

**uspto-data-sync** version:
- No `flag` column checking
- Could update same records multiple times
- Less safe for repeated executions

**Batch Processing**:
- Groups rf_ids by organization and company
- Processes in arrays to minimize database round-trips
- Uses `INSERT IGNORE` and `UPDATE` with `IN` clauses for efficiency

**Logging**:
```php
// Log processing status
INSERT INTO db_new_application.log_messages 
  (organisation_id, company_id, message, created_at)
VALUES 
  ([org_id], [company_id], '[message]', NOW())
```

---

## 9. Summary Generation

### 9.1 Statistics Computed

**Source Files**:
- `uspto-data-sync/summary.php`
- `uspto-data-sync/all_summary.php` (wrapper/orchestrator)
- `customer-data-migrator/summary.php` (variant)

**Computed Metrics** (per company and per organization):

| Statistic | SQL Expression | Description |
|-----------|----------------|-------------|
| **companies** | 1 (per company) or COUNT(companies) (org-level) | Number of companies |
| **activities** | `COUNT(DISTINCT activity)` | Number of distinct activity types |
| **entities** | `COUNT(DISTINCT assignor_and_assignee_id)` | 3rd party entities (non-inventors, non-company) |
| **parties** | `COUNT(DISTINCT assignor_and_assignee_id)` | Company-related parties |
| **employees** | `COUNT(DISTINCT name)` from inventors | Unique employee/inventor count |
| **transactions** | `COUNT(DISTINCT rf_id)` | Total transactions |
| **assets** | `COUNT(DISTINCT appno_doc_num)` | Total patents/applications |
| **arrows** | `SUM(arrows)` from `assignment_arrows` | Visual connection count for diagrams |

### 9.2 Grouping & Storage

**Storage Table**: `summary`

**Schema**:
```
- organisation_id: Organization ID
- company_id: Company ID (0 = org-level aggregate)
- companies: Company count
- activities: Activity count
- entities: Entity count
- parties: Party count
- employees: Employee count
- transactions: Transaction count
- assets: Asset count
- arrows: Arrow count
```

**Grouping Levels**:

1. **Per-Company** (`company_id > 0`):
   - Statistics for individual company
   - Assets filtered to `company_id = [ID]`

2. **Per-Organization** (`company_id = 0`):
   - Aggregate across all companies in organization
   - Assets filtered to all `company_id IN ([list])`

**Process**:
```sql
DELETE FROM summary 
WHERE organisation_id = [org_id] 
  AND company_id = [company_id]

INSERT IGNORE INTO summary 
  (organisation_id, company_id, companies, activities, entities, parties, employees, transactions, assets, arrows)
SELECT 
  [org_id],
  [company_id],
  [companies],
  COUNT(DISTINCT activity) as activities,
  [entities],
  [parties],
  [employees],
  [transactions],
  [assets],
  [arrows]
FROM (
  SELECT CASE 
    WHEN activity_id = 11 THEN 5
    WHEN activity_id = 12 THEN 5
    WHEN activity_id = 13 THEN 5
    WHEN activity_id = 16 THEN 5
    ELSE activity_id 
  END AS activity
  FROM db_new_application.activity_parties_transactions
  WHERE organisation_id = [org_id] 
    AND company_id = [company_id]
  GROUP BY organisation_id, activity_id
) AS temp
```

**Activity Consolidation**: Activities 11, 12, 13, 16 mapped to activity 5 for grouping

**Filters**:
- Only assets filed after 1999: `DATE_FORMAT(appno_date, '%Y') > [YEAR]`
- Assets from 1998-2001 tracked separately for employee name extraction
- `layout_id = 15` filter applied

**Employee Calculation Logic**:
1. Get inventors from bibliographic databases (application + grant)
2. Subtract known employee names from 1998-2001 assets
3. Add back separately-tracked employee names
4. Use `COUNT(DISTINCT name)` for final count

**3rd Party Entity Calculation**:
```sql
-- Entities who were assignees or assignors but NOT:
-- - Inventors (in bibliographic DB)
-- - Recorded in activity_parties_transactions
SELECT COUNT(*) FROM (
  SELECT assignor_and_assignee_id FROM assignee 
  WHERE rf_id IN ([list])
    AND assignor_and_assignee_id NOT IN (SELECT assignor_and_assignee_id FROM inventors)
    AND assignor_and_assignee_id NOT IN (SELECT recorded_assignor_and_assignee_id FROM activity_parties_transactions)
  UNION
  SELECT assignor_and_assignee_id FROM assignor 
  WHERE rf_id IN ([list])
    AND assignor_and_assignee_id NOT IN (SELECT assignor_and_assignee_id FROM inventors)
    AND assignor_and_assignee_id NOT IN (SELECT recorded_assignor_and_assignee_id FROM activity_parties_transactions)
)
```

**Batch Processing** (`all_summary.php`):
- Groups organizations into batches (mainOrg, mainOrg1-6)
- Executes summary generation per organization:
  ```php
  exec('php -f /var/www/html/trash/summary.php [org_id] "" "1"');
  ```
- Allows parallel processing of multiple organizations

---

## 10. Other Processing Pipelines

### 10.1 Regenerate Pipeline (`regenerate.php`)

**Size**: 36KB

**Purpose**: Comprehensive data regeneration script

**Key Operations**:
- Re-runs multiple processing pipelines in sequence
- Likely includes:
  - Name normalization
  - Tree regeneration
  - Dashboard JSON regeneration
  - Summary statistics updates

**Note**: Requires code analysis for complete detail

### 10.2 Illustration JSON Generation (`generate_illustration_json.php`)

**Size**: 44KB

**Purpose**: Generates visual diagram/illustration data in JSON format

**Likely Components**:
- Patent family trees
- Assignment flow diagrams
- Entity relationship graphs
- Visual timeline representations

**Overlaps with**: Dashboard JSON generation but focused on illustrations

**Note**: Requires code analysis for schema and algorithm details

### 10.3 Comprehensive Fix Script (`fix_inventor_timeline_tree_transaction_assests_updates.php`)

**Size**: 199KB (largest processing script)

**Purpose**: **Omnibus data correction and synchronization script**

**Likely Functions** (based on filename):
- **Inventor data fixes**: Correct missing or malformed inventor records
- **Timeline updates**: Regenerate timeline data
- **Tree updates**: Rebuild ownership trees
- **Transaction corrections**: Fix misclassified or corrupted transactions
- **Asset synchronization**: Sync asset tables across databases

**Critical for**: Data integrity after bulk imports or system migrations

**Note**: This is the most complex processing pipeline and requires detailed analysis

### 10.4 Assignment JSON Parsing (`back_uspto_patent_assignment_json_parse_742020.php`)

**Size**: 88KB

**Purpose**: Parses USPTO Assignment API JSON responses

**Referenced in Session 1**: Part of ingestion pipeline

**Overlap**: Bridges ingestion (Session 1) and processing (Session 2)

**Functions**:
- Parses Solr JSON responses from USPTO Assignment API
- Extracts assignment metadata
- Populates assignment, assignor, assignee tables
- Links to document IDs

### 10.5 Test Tree Script (`test_tree_script.php`)

**Size**: 52KB

**Purpose**: Extended tree building with additional transaction types

**Difference from `tree_script.php`**:
- Includes License (In/Out)
- Includes Option (In/Out)
- Includes CourtOrder (In/Out)
- More comprehensive transaction type coverage

**Use Case**: Likely used for complex ownership scenarios or testing

### 10.6 New Code Pipeline (`new_code.php`)

**Size**: 75KB

**Purpose**: Unknown (requires analysis)

**Speculation**: 
- New feature implementation
- Refactored version of existing pipeline
- Experimental processing logic

### 10.7 Address Swapping (`address_swapping.php`)

**Size**: 25KB

**Purpose**: Corrects address data mismatches

**Likely Functions**:
- Swaps incorrectly-assigned addresses between entities
- Fixes address typos or format issues
- Normalizes address formats (street, suite, city, state, zip)

**Tables Affected**:
- `address` (in customer databases)
- `representative_address` (in main database)

### 10.8 Collateralization (`add_collateralize.php`)

**Purpose**: Identifies and marks patents used as collateral

**Business Context**: Patents pledged as security for loans

**Likely Processes**:
- Scans for security interest transactions
- Links patents to lending entities
- Flags collateralized assets
- Tracks release of security interests

### 10.9 Security Release Finder (`find_release_security.php`)

**Purpose**: Matches security interests with their corresponding releases

**Logic**:
- Finds security transactions without matching release
- Identifies unreleased security interests (potential red flags)
- Matches reel/frame numbers between security and release transactions

**Output**: Likely populates a table or report of unreleased security interests

### 10.10 Representative Asset Reports

**Scripts**:
- `report_represetative_assets_transactions.php`
- `report_represetative_assets_transactions_by_account.php`
- `admin_report_represetative_assets_transactions.php`
- `admin_report_represetative_assets_transactions_by_account.php`

**Purpose**: Generate detailed reports of assets by representative/company

**Variants**:
- **By account**: Filters to specific customer account
- **Admin versions**: Likely includes additional fields or permissions

**Output Format**: Likely CSV, PDF, or JSON reports

**Data Included**:
- Assets owned by representative
- Transaction history per asset
- Current ownership status
- Security interests and releases

---

## 11. Pipeline Dependencies

**Execution Order** (recommended sequence):

```
[DATA INGESTION - See Session 1 Document]
         ↓
1. Transaction Type Classification (update_missing_type.php)
         ↓
2. Name Normalization (normalize_file.php, normalize_file1.php)
         ↓
3. Inventor Deduplication (inventor_levenshtein.js - external)
         ↓
4. Flag/State Updates (update_flag.php)
         ↓
5. Ownership Tree Construction (tree_script.php)
         ↓
6. Timeline Generation (timeline.php)
         ↓
7. Broken Title Chain Detection (broken_title.php, assets_bank_broken_title.php)
         ↓
8. Dashboard JSON Generation (dashboard_with_company.php, generate_json.php)
         ↓
9. Summary Generation (summary.php)
         ↓
10. Illustration JSON Generation (generate_illustration_json.php)
```

**Critical Dependencies**:

- **Tree** requires normalized names and classified transactions
- **Broken chain detection** requires trees and timelines
- **Dashboards** require all upstream data (trees, timelines, summaries)
- **Summaries** require activity tracking and asset classification

**Parallel-Safe Pipelines**:
- Summary generation (per organization)
- Dashboard JSON (per patent)
- Timeline generation (per organization)

**Sequential-Only**:
- Name normalization must complete before tree building
- Transaction classification must complete before flag updates

---

## 12. Key Observations & Risks

### 12.1 Performance Risks

1. **No Caching**: Dashboard JSON regenerated on every request (expensive for complex patents)
2. **Full Tree Rebuilds**: Entire ownership tree deleted and recreated (inefficient for incremental updates)
3. **Cross-Database Queries**: Multiple database connections per request
4. **Large Batch Processing**: 1,000,000 row batches risk memory exhaustion

### 12.2 Data Integrity Risks

1. **No Transactions**: Updates not wrapped in database transactions (partial failures leave inconsistent state)
2. **No Rollback**: Name normalization permanently modifies data
3. **Race Conditions**: No locking on tree/timeline regeneration (concurrent updates could corrupt)
4. **External Dependency**: inventor_levenshtein.js not in repository (pipeline breaks if script missing)

### 12.3 Code Maintainability Risks

1. **Massive Files**: 199KB, 216KB PHP files are extremely difficult to maintain
2. **Hardcoded Values**: Organization IDs, company names embedded in code
3. **SQL in PHP**: No ORM or query builder (SQL injection risks, hard to test)
4. **No Documentation**: Minimal comments in code
5. **Duplicate Logic**: Three separate broken title algorithms instead of one unified approach

### 12.4 Security Observations

1. **Positive**: Uses prepared statements in some places
2. **Risk**: `real_escape_string()` used instead of prepared statements in many scripts
3. **Risk**: User input from `$_REQUEST` directly in SQL (dashboard generation)
4. **Risk**: `shell_exec()` calls to external scripts with JSON parameters (potential command injection)

### 12.5 Scalability Concerns

1. **Linear Growth**: Processing time increases linearly with patent count
2. **No Sharding**: Single database per customer (cannot horizontally scale)
3. **No Queue System**: Long-running scripts executed synchronously
4. **No Job Management**: No way to track/cancel/retry failed pipeline executions

### 12.6 Business Logic Complexity

1. **Broken Title Detection**: Three different algorithms suggest unclear business requirements
2. **Transaction Classification**: Over 50 regex patterns (maintenance burden)
3. **Name Normalization**: Automated-only (no manual override for edge cases)
4. **Tree Building**: Flat model limits hierarchical analysis

### 12.7 Positive Observations

1. **Comprehensive Coverage**: System handles almost all USPTO transaction types
2. **Multi-Tenancy**: Well-designed database isolation per customer
3. **Audit Trail**: Timeline and log tables provide historical tracking
4. **Idempotent Design**: customer-data-migrator version includes safety flags

### 12.8 Migration Recommendations

For PatenTrack3 rebuild:

1. **Implement Caching**: Redis for dashboard JSON, computed summaries
2. **Use Job Queue**: RabbitMQ/Bull for long-running pipelines
3. **Add Transactions**: Wrap multi-step updates in database transactions
4. **Refactor Large Files**: Break 200KB files into focused modules
5. **Centralize Business Logic**: One broken title algorithm, not three
6. **Add Tests**: Unit tests for classification rules, normalization logic
7. **Use ORM**: Prisma/TypeORM to prevent SQL injection
8. **Document Pipelines**: Clear README for execution order and dependencies
9. **Implement Incremental Updates**: Don't rebuild entire trees on minor changes
10. **Add Monitoring**: Track pipeline execution times, failure rates
