# PatenTrack Processing Pipelines Analysis

This document provides detailed analysis of the data processing pipelines in the PatenTrack system. It builds upon [Session 1: Data Sources & Ingestion](./01-data-sources-and-ingestion.md) and focuses on how raw USPTO data is transformed, classified, and prepared for presentation.

---

## 1. Transaction Type Classification

**Purpose:** Classify raw assignment records into standardized transaction types for visualization and analysis.

**Input:** Raw `convey_text` (conveyance text) from assignment records in `db_USPTO.assignment` table.

### Two-tier Classification System

#### Tier 1 — Initial Classification During Ingestion

**Files:** `update_record_daily_xml.php`, `old_daily_small_xml.php`, `temp_update_daily_xml.php`

The system first checks a lookup table of previously classified texts:

```sql
SELECT a.convey_text as text, rac.convey_ty as convey_ty 
FROM db_uspto.assignment as a 
INNER JOIN db_uspto.representative_assignment_conveyance as rac ON rac.rf_id = a.rf_id 
WHERE a.convey_text <> '' AND a.convey_text IS NOT NULL 
GROUP BY a.convey_text, convey_ty
```

If no match is found, the system applies a **priority-based `strpos()` cascade**. Order matters — the first match wins:

| Priority | strpos() Match | Output Type | Notes |
|----------|---------------|-------------|-------|
| 1 | `'correct'` OR `'re-record'` | `correct` | |
| 2 | `'employee'` OR `'employment'` | `employee` | Also sets `employer_assign = 1` |
| 3 | `'confirmator'` | `govern` | |
| 4 | `'merger'` | `merger` | |
| 5 | `'change of name'` OR `'change of address'` | `namechg` | |
| 6 | `'license'` OR `'letters of testamentary'` | `license` | |
| 7 | `'release'` | `release` | |
| 8 | `'security'` OR `'mortgage'` | `security` | |
| 9 | `'assignment'` | `assignment` | |
| 10 | (none matched) | `missing` | Default fallback |

**⚠️ Inconsistency:** A different classification order exists in `fix_transactions_by_patents.php`: starts with `assignment`, then `change of name`, `merger`, `security && !release`, `correct`, `missing`, `release`, `govern`, `license` — with a default of `other` instead of `missing`.

#### Tier 2 — Reclassification

**File:** `update_missing_type.php` (33KB)

This pipeline operates on records already classified as `missing`, `other`, `govern`, or `correct` using MySQL `MATCH...AGAINST` full-text boolean search:

**Assignment Detection:**
- Patterns: `"ASSIGNMENT OF ASSIGNORS INTEREST"`, `"ACKNOWLEDGEMENT OF RIGHTS"`, `"ASSIGNMENT OF RIGHTS"`, `"CONVERSION"`, `"CONTINUANCE"`, `"NUNC"`, `"TUNC"`
- Result: → `assignment`

**Name Change Detection:**
- Pattern: `"CHANGE OF NAME"`
- Result: → `namechg`

**Security Detection:**
- Patterns: `"SECURITY" -RELEASE -DISCHARGE`, `"PLEDGE" -RELEASE -DISCHARGE`, `"SUCCESSION OF AGENCY" -RELEASE -DISCHARGE`
- Result: → `security`
- Source states: From `missing`, `security`, `other`, `govern`

**Release Detection:**
- Source states: From `missing`, `security`, `other`, `govern`
- Result: → `release`

**Security in Correct:**
- From `correct` with security-related text
- Result: → `security`

#### The updateFlag() Function

```php
function updateFlag($flag, $conveyanceType, $rfIDs, $con) {
    if($flag == 1){
        $updateQuery = "UPDATE db_uspto.representative_assignment_conveyance SET employer_assign = $flag, convey_ty = 'employee' WHERE rf_id IN (...)";
    } else {
        $updateQuery = "UPDATE db_uspto.representative_assignment_conveyance SET employer_assign = $flag, convey_ty = '$conveyanceType' WHERE rf_id IN (...)";
    }
}
```

### Complete Transaction Type Taxonomy

**All output transaction types:** `assignment`, `namechg`, `merger`, `security`, `release`, `correct`, `employee`, `govern`, `license`, `other`, `missing`, `partialassignment`, `restatedsecurity`, `courtappointment`, `courtorder`, `option`, `licenseend`

### Visual Mapping

**From `generate_json.php` — Maps conveyance types to visual box/line types:**

| Conveyance Type | Box Type | Line Type | Description |
|----------------|----------|-----------|-------------|
| `assignment` | Ownership (2) | Ownership | "Ownership" |
| `namechg` | Ownership (2) | Name Change | "Name Change" |
| `security` | Security (3) | Security | "Security" |
| `release` | Security (3) | Release | "Release" |
| `merger` | Ownership (2) | Ownership | (default) |
| `license` | Licenses (4) | Licenses | "Licenses" |
| `other`, `correct`, `missing`, `govern`, `employee` | Ownership (2) | Ownership | (default) |

**Box Type Definitions:**
- `id=1`: Inventor
- `id=2`: Ownership
- `id=3`: Security
- `id=4`: Licenses
- `id=5`: 3rdParties

---

## 2. Name Normalization

**Purpose:** Standardize entity names across different variations to enable accurate linking and deduplication.

**Files:** `normalize_file.php`, `update_assignor_and_assignee_original_name.php`, `update_retirved_cited_patents_assignees.js`

### Manual Suffix Stripping

**Files:** `normalize_file.php`, `update_assignor_and_assignee_original_name.php`

The `remove_if_trailing()` function checks and removes trailing words in this order:
1. `corporation`
2. ` Corp` (with leading space)
3. `incorporated`
4. `limited`
5. `company`

### Automated Regex Pattern

**Files:** `update_missing_type.php` (L573), `update_flag.php` (L352)

Used for name comparison (not permanent normalization):

```regex
/\b(?:inc|llc|corporation|corp|systems|system|llp|industries|gmbh|lp|agent|sas|na|bank|co|states|ltd|kk|a\/s|aktiebolag|kigyo|kaisha|university|kabushiki|company|plc|gesellschaft|gesmbh|société|societe|mbh|aktiengesellschaft|haftung|vennootschap|bv|bvba|aktien|limitata|srl|sarl|kommanditgesellschaft|kg|gbr|ohg|handelsgesellschaft|compagnie|privatstiftung|foundation|technologies|technology|solutions|solution|networks|network|holding|holdings|health|animal|scientific|chemical|chemicals|pharmaceutical|trust|the|resources|government|college|support|pharma|labs|lab|...many more...)\b/i
```

**Note:** This extensive pattern strips corporate suffixes and common business terms across multiple languages (English, German, French, Japanese, etc.).

### Database Tables for Name Resolution

**`db_uspto.representative`**
- **Purpose:** Canonical entity names
- **Key columns:** `representative_id` (PK), `representative_name`

**`db_uspto.assignor_and_assignee`**
- **Purpose:** Links raw names to canonical representatives
- **Key columns:** `assignor_and_assignee_id` (PK), `name`, `representative_id` (FK)

**`db_uspto.representative_assignment_conveyance`**
- **Purpose:** Stores updated conveyance type per transaction
- **Key columns:** `rf_id` (PK/FK), `convey_ty`, `employer_assign`

### Resolution Query Pattern

```sql
SELECT a.*, r.representative_name as normalize_name 
FROM assignor as a 
LEFT JOIN assignor_and_assignee as aaa ON aaa.assignor_and_assignee_id = a.assignor_and_assignee_id 
LEFT JOIN representative as r ON r.representative_id = aaa.representative_id 
WHERE a.rf_id = {rf_id} 
GROUP BY a.rf_id, a.assignor_and_assignee_id
```

**Fallback:** If `normalize_name` is `NULL`, the system uses the raw name from the assignment record.

---

## 3. Inventor Deduplication

**Reference:** See [Session 1](./01-data-sources-and-ingestion.md) sections 3.13 and 3.14 for complete details on inventor data retrieval and processing.

### Key Implementation Details

**Matching Algorithm:**
- **Threshold:** Levenshtein distance < 5
- **Name Variations:** Tests 6 different name orderings:
  - Family-Given
  - Given-Family
  - With middle names
  - Without middle names
  - Various permutations

**Match Result:**
When an assignor matches an inventor:
- Sets `convey_ty = 'employee'` in `representative_assignment_conveyance`
- Sets `employer_assign = 1`

**Purpose:** Identifies employee assignments (where assignor = inventor/employee of assignee company).

---

## 4. Ownership Tree Construction

**Purpose:** Build hierarchical ownership trees showing entity relationships through patent transactions.

**Files:** `tree.php`, `test_tree_script.php`, `fix_inventor_timeline_tree_transaction_assests_updates.php`

### Tree Structure

**Storage:** `tree` table in per-customer database

**Columns:**
- `assignor_and_assignee_id` — Entity ID
- `name` — Entity name
- `parent` — Parent entity ID
- `type` — Node type (see below)
- `tab` — UI tab grouping
- `organisation_id` — Customer organization
- `representative_id` — Canonical entity

**Nodes:** Entities (assignors/assignees)  
**Edges:** Transactions

### Tree Node Types and Tabs

**From `tree.php`:**

| Query | type | tab | Conveyance Filter | Direction |
|-------|------|-----|-------------------|-----------|
| Employee | 0 | 0 | employee | Assignor→Assignee |
| Purchase | 1 | 1 | assignment, partialassignment | Company is assignee |
| Sale | 2 | 1 | assignment | Company is assignor |
| Security In | 4 | 2 | security | Company is assignee |
| Security Out | 5 | 2 | security | Company is assignor |
| Release Out | 7 | 2 | release | Company is assignor |
| Release In | 8 | 2 | release | Company is assignee |
| License In | 9 | 3 | license | Company is assignee |
| License Out | 10 | 3 | license | Company is assignor |
| Other | 13 | 3 | other | |

**Additional types:**
- **Options:** In/Out (type 8-9, tab 7)
- **Court Orders:** In/Out (type 10-11, tab 8)
- **Other Changes:** type 15, tab 10

### Tree Generation Process

**Root:** The company itself (identified by `representative_id`)

**Scope:** Built per company within each organization

**Algorithm:**
1. Full delete of existing tree data for company
2. Rebuild via `INSERT IGNORE` for each transaction type
3. Populates related tables:
   - `tree_parties` — Party details
   - `tree_parties_collection` — Grouped parties

**Regeneration:** Complete delete + reinsert (no incremental updates)

---

## 5. Broken Title Chain Detection

**Purpose:** Identify patents where the chain of ownership from inventor/applicant to current owner is incomplete.

**Files:** `broken_title.php`, `assets_bank_broken_title.php`, `dashboard_with_company.php`

### Algorithm

**Primary Implementation:** `broken_title.php`

**Process:**
1. Takes `companyID` and `organisationID` as CLI arguments
2. Calls stored procedure: `CALL routine_transaction($companyID, $organisationID)`
3. Calls stored procedure: `CALL GetAssetsTableC("$companyID", $organisationID)`
4. Builds `$brokenTitle` array from procedure results
5. Deletes existing entries:
   ```sql
   DELETE table_d WHERE company_id = X AND organisation_id = Y
   ```
6. Inserts broken title records:
   ```sql
   INSERT IGNORE INTO table_d SELECT ... FROM table_c WHERE appno_doc_num IN (...)
   ```

### Business Rule

**Definition:** A title chain is "broken" when no continuous assignment chain exists from inventor/applicant to current owner.

**Valid chain transaction types:**
- `assignment`
- `partialassignment`
- `namechg` (name change)
- `merger`
- `employee`
- `courtappointment`
- `courtorder`

**Invalid:** Gaps in the chain or missing transactions prevent establishing clear ownership.

### Bank Variant

**File:** `assets_bank_broken_title.php`

**Special logic:**
- Uses `conveyance.is_ota = 1` flag (Office of Technology Assessment?)
- Checks `assignor.exec_dt <= last_exec_dt` (execution date validation)
- Identifies temporal gaps in ownership chain

### Dashboard Integration

**Storage:** Results stored in `dashboard_items` table with `type = 1`

**Purpose:** Surfaces broken chain issues for client review and remediation.

---

## 6. Dashboard JSON Generation

**Purpose:** Generate comprehensive dashboard data showing asset status, transactions, and key metrics for each client.

**Files:** `dashboard_with_company.php` (~220KB), `dashboard_with_bank.php`, `generate_json.php` (~71KB)

### Dashboard Item Types

**Table:** `dashboard_items`

| Type | Description |
|------|-------------|
| 1 | Broken Chain of Title |
| 17 | Collateralized Assets |
| 18 | Encumbrances |
| 21 | Monetized Assets |
| 22 | Un-assigned Assets |
| 30 | Client-Owned Transactions |
| 31 | Filed Assets (Applicant) |
| 32 | Assets Acquired |
| 33 | Client-Owned Assets (Bank) |
| 34 | Top Inventors |
| 35 | Client Portfolio Assets |
| 36 | Client Asset Transactions |
| 37 | Law Firms |

### Schema

**`dashboard_items` Table:**
```sql
dashboard_items (
    organisation_id,
    representative_id,
    assignor_id,
    type,
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

**`dashboard_items_count` Table:**
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

### Data Sources

The dashboard queries multiple databases:
- `db_uspto.documentid` — Patent/application identifiers
- `db_new_application.activity_parties_transactions` — Transaction activity
- `db_uspto.representative_assignment_conveyance` — Conveyance types
- `db_uspto.assignee/assignor` — Entity information
- `db_new_application.assets/lost_assets` — Asset status
- `db_patent_application_bibliographic` — Application metadata
- `db_new_application.cited_patents` — Citation data

### Execution Trigger

**File:** `create_data_for_company_db_application.php`

```php
exec('php -f /var/www/html/trash/dashboard_with_company.php "'.$row->company_id.'" "'.$row->organisation_id.'"');
```

**Note:** Runs as separate PHP process, not background daemon.

### Visual Tree JSON

**File:** `generate_json.php`

**Purpose:** Creates visual representation of ownership trees with nodes (boxes) and edges (relations).

**Storage Tables:**
- `lead_patent_assignment` — Node/box data
- `lead_patent_assigment_relation` — Edge/relationship data

**Output Format:** JSON arrays containing visual graph data for frontend rendering.

---

## 7. Timeline Generation

**Purpose:** Generate year-over-year transaction and asset timelines for each company.

**File:** `fix_inventor_timeline_tree_transaction_assests_updates.php`

### Metrics Per Company Per Year

**Transaction Counts:**
- Buy (acquisitions)
- Sale
- Security agreements
- Releases
- License In
- License Out
- Court Orders
- Options
- Name Changes

**Asset Counts:**
- Current year patents
- Current year applications
- Previous year patents
- Previous year applications
- Year-over-year differences (deltas)

### Storage

**Table:** `validity`

```sql
validity (
    organisation_id,
    representative_id,
    application,
    patent,
    encumbered,
    current_patent_year,
    current_application_year,
    previous_patent_year,
    previous_application_year,
    difference_patent,
    difference_application
)
```

### Asset Expiration Logic

**Calculation:** Filing date + 20 years

**Alternative:** Checks for maintenance fee events:
- `event_code = 'EXP'` or `'EXP.'`
- Source: `db_patent_maintainence_fee` database

**Purpose:** Identifies assets approaching or past expiration for portfolio management.

---

## 8. Flag/State Updates

**Purpose:** Identify and flag employee assignments (where assignor is an inventor/employee of the assignee company).

**File:** `update_flag.php` (35KB)

### Algorithm

1. **Get company data:**
   - Retrieve `representative_id` and `representative_name` for organization

2. **Get company patents:**
   - Query all `rf_id` values for company's patent portfolio

3. **Get assignors:**
   - Extract unique assignors from those transactions

4. **Get inventors:**
   - Query inventor data from bibliographic databases

5. **Name comparison:**
   - Exact matching
   - Regex pattern matching (using suffix-stripping regex)

6. **Set flags:**
   - On match: `employer_assign = 1` in `representative_assignment_conveyance`

7. **Fuzzy matching:**
   - Remaining unmatched assignors → call `inventor_levenshtein.js`
   - Levenshtein distance threshold for final matching

### Execution Chain

**Pipeline order:**
1. `update_flag.php` — Employee identification
2. `update_missing_type.php` — Transaction reclassification
3. `create_data_for_company_db_application.php` — Data orchestration and sync

---

## 9. Summary Generation

**Purpose:** Generate high-level statistics for organizations and companies.

**Files:** `summary.php`, `all_summary.php`

### Schema

**Table:** `summary`

```sql
summary (
    organisation_id,
    company_id,
    companies,      -- Number of companies
    activities,     -- Number of activities
    entities,       -- Number of entities
    parties,        -- Number of parties
    employees,      -- Number of employees
    transactions,   -- Number of transactions
    assets,         -- Number of assets
    arrows          -- Number of relationships
)
```

### Activity Grouping

**Mapping:** Activity IDs 11, 12, 13, 16 all map to activity group 5.

### Two-Level Aggregation

**Per-Company Summaries:**
- Specific `company_id` value
- Statistics for individual company

**Organization-Level Summaries:**
- `company_id = 0`
- Aggregated statistics across all companies in organization

### Batch Processing

**File:** `all_summary.php`

**Logic:**
- Contains hardcoded arrays of organization IDs
- Loops through each organization
- Calls `summary.php` for each organization
- Generates both company-level and org-level summaries

---

## 10. Other Pipelines

### Orchestrator

**File:** `create_data_for_company_db_application.php`

**Purpose:** Main coordination script that orchestrates multiple pipelines in sequence.

**Calls:** Invokes dashboards, trees, summaries, and other processing scripts.

### Per-Account Reports

**File:** `report_represetative_assets_transactions_by_account.php`

**Purpose:** Generates detailed reports for specific customer accounts.

### Assignment Grouping

**File:** `update_assignment_group.php`

**Purpose:** Groups related assignments together (likely by family or transaction set).

### EPO Data Processing

**File:** `epo_api_retrieve_patent_data.php`

**Purpose:** Retrieves and processes European Patent Office (EPO) data.

**Note:** Extends system beyond USPTO data to international patents.

### JSON Regeneration

**File:** `regenerate.php`

**Purpose:** Regenerates JSON visualization data for a specific patent.

**Use case:** Refresh after data corrections or updates.

### Illustration JSON

**File:** `generate_illustration_json.php`

**Purpose:** Generates JSON data for patent illustration visualization.

---

## 11. Pipeline Dependencies (Execution Order)

The following order represents the logical dependency chain:

1. **Ingestion** (See [Session 1](./01-data-sources-and-ingestion.md))
   - Raw data from USPTO APIs and bulk downloads
   - Stored in `db_uspto` master database

2. **`update_flag.php`**
   - Identifies employee assignments
   - Sets `employer_assign` flags

3. **`update_missing_type.php`**
   - Reclassifies transactions
   - Updates `convey_ty` values

4. **`create_data_for_company_db_application.php`**
   - Orchestrates data synchronization
   - Coordinates downstream pipelines

5. **`tree.php`**
   - Builds ownership trees
   - Populates tree tables

6. **`broken_title.php`**
   - Detects broken title chains
   - Identifies ownership gaps

7. **`dashboard_with_company.php`**
   - Generates dashboard data
   - Populates dashboard_items tables

8. **`summary.php`**
   - Aggregates statistics
   - Generates summaries

9. **`generate_json.php`**
   - Creates visual JSON
   - Generates frontend data structures

---

## 12. Key Observations & Risks

### Code Quality Issues

**Inconsistent Classification Logic:**
- Different transaction classification orders in `update_record_daily_xml.php` vs `fix_transactions_by_patents.php`
- Risk: Same conveyance text may classify differently depending on entry point

**No Unit Tests:**
- No automated testing infrastructure
- Risk: Changes cannot be validated; regressions likely

**Massive Monolithic Files:**
- `dashboard_with_company.php` ~220KB
- `generate_json.php` ~71KB
- `update_flag.php` 35KB
- `update_missing_type.php` 33KB
- Risk: Difficult to maintain, understand, or refactor

**Hardcoded Configuration:**
- Organization IDs hardcoded in `all_summary.php`
- Risk: Manual updates required for new customers

### Database Issues

**Stored Procedures Not in Source Control:**
- `routine_transaction($companyID, $organisationID)`
- `GetAssetsTableC("$companyID", $organisationID)`
- Risk: Cannot version control, review, or reproduce environments

**SQL Injection Vulnerabilities:**
- String concatenation for SQL queries throughout
- Example: `"UPDATE ... WHERE rf_id IN (...)"` built via string concatenation
- Risk: Security vulnerabilities, data corruption

**No Transactions/Rollbacks:**
- Multi-step operations lack atomicity
- Example: Delete + Insert in `broken_title.php` without transaction wrapper
- Risk: Partial failures leave inconsistent state

**INSERT IGNORE Pattern:**
- Used extensively throughout codebase
- Risk: Silently ignores duplicate key errors, masking data issues

### Operational Risks

**No Error Handling:**
- Failed stored procedure calls not validated
- Database errors not logged or surfaced
- Risk: Silent failures, data inconsistencies

**Full Delete + Reinsert Pattern:**
- Trees, dashboards regenerated by deleting all data and reinserting
- Risk: Temporary data unavailability during regeneration

**No Incremental Updates:**
- Most pipelines are full regenerations
- Risk: Performance degradation as data grows

**Process Execution Model:**
- PHP scripts invoked via `exec()` calls
- No job queuing, retry logic, or monitoring
- Risk: Failed jobs go unnoticed

### Data Quality Risks

**Fallback to Raw Names:**
- When normalization fails, uses raw text
- Risk: Inconsistent entity matching

**Levenshtein Threshold:**
- Distance < 5 may be too permissive for short names
- Risk: False positive matches

**Missing Default Values:**
- Some classification paths may return `NULL`
- Risk: Incomplete data in reports

### Recommendations

1. **Implement unit tests** for classification logic
2. **Add transaction wrappers** for multi-step operations
3. **Version control stored procedures** in repository
4. **Parameterize SQL queries** to prevent injection
5. **Add error handling** and logging throughout
6. **Refactor monolithic files** into smaller, testable modules
7. **Implement incremental updates** instead of full regenerations
8. **Add job queue** for async processing
9. **Document classification order** and enforce consistency
10. **Add data validation** at pipeline boundaries
