# PatenTrack Processing Pipelines Analysis

**Note:** This document analyzes data processing and business logic that occurs AFTER initial data ingestion. For ingestion details, see [`01-data-sources-and-ingestion.md`](./01-data-sources-and-ingestion.md).

## A. Transaction Type Classification

The system classifies patent assignment conveyance text into standardized transaction types using a two-phase approach.

### Classification Priority/Evaluation Order

**Source files:** `update_missing_type.php`, `update_record_daily_xml.php`, `old_daily_small_xml.php`, `temp_update_daily_xml.php`, `fix_transactions_by_patents.php`, `assignment_conveyance.php`

#### Phase 1: Lookup Table Match

The system first checks the `assignment_conveyance` table for exact matches:

```sql
SELECT convey_ty FROM db_uspto.assignment_conveyance 
WHERE rf_id = {reel_frame_id}
```

If a match exists in `assignment_conveyance` table (from manual classification or CSV import via `assignment_conveyance.php`), that classification is used directly.

#### Phase 2: String-Matching Rules

If no lookup table match is found, the system applies case-insensitive string matching against `convey_text` from the `assignment` table in this priority order:

```php
// From update_record_daily_xml.php and related files
$convey_text_lower = strtolower($convey_text);

if (strpos($convey_text_lower, 'correct') !== false || 
    strpos($convey_text_lower, 're-record') !== false) {
    $convey_ty = 'correct';
}
elseif (strpos($convey_text_lower, 'employee') !== false || 
        strpos($convey_text_lower, 'employment') !== false) {
    $convey_ty = 'employee';
    $employer_assign = 1;
}
elseif (strpos($convey_text_lower, 'confirmator') !== false) {
    $convey_ty = 'govern';
}
elseif (strpos($convey_text_lower, 'merger') !== false) {
    $convey_ty = 'merger';
}
elseif (strpos($convey_text_lower, 'change of name') !== false || 
        strpos($convey_text_lower, 'change of address') !== false) {
    $convey_ty = 'namechg';
}
elseif (strpos($convey_text_lower, 'license') !== false || 
        strpos($convey_text_lower, 'letters of testamentary') !== false) {
    $convey_ty = 'license';
}
elseif (strpos($convey_text_lower, 'release') !== false) {
    $convey_ty = 'release';
}
elseif (strpos($convey_text_lower, 'security') !== false || 
        strpos($convey_text_lower, 'mortgage') !== false) {
    $convey_ty = 'security';
}
elseif (strpos($convey_text_lower, 'assignment') !== false) {
    $convey_ty = 'assignment';
}
else {
    $convey_ty = 'missing';  // Default fallback
}
```

### Complete Type Inventory

**Standard types from classification rules:**
- `'assignment'` — Ownership transfer
- `'correct'` / `'re-record'` — Correction/re-recording
- `'employee'` — Inventor-to-employer assignment
- `'govern'` — Government confirmatory assignment
- `'merger'` — Corporate merger
- `'namechg'` — Name or address change
- `'license'` — License agreement
- `'release'` — Security interest release
- `'security'` — Security interest/mortgage
- `'missing'` — Unclassified/default

**Additional types found in tree/dashboard code:**
- `'partialassignment'` — Partial ownership transfer
- `'option'` — Option to purchase
- `'courtorder'` — Court-ordered transfer
- `'courtappointment'` — Court appointment
- `'licenseend'` — License termination
- `'other'` — Other transaction type

### Storage

Classification results are stored in two tables:

```sql
-- Primary conveyance classification
INSERT INTO db_uspto.assignment_conveyance 
    (rf_id, convey_ty, employer_assign)
VALUES ({rf_id}, {convey_ty}, {employer_assign});

-- Representative-linked classification (for company-specific queries)
INSERT INTO db_uspto.representative_assignment_conveyance 
    (rf_id, convey_ty, employer_assign)
VALUES ({rf_id}, {convey_ty}, {employer_assign});
```

### Visual Mapping

**Source files:** `tree.php`, `generate_json.php`

Conveyance types map to visual representation in the UI:

| `convey_ty` | Box Type | Line Type | Color Code |
|------------|----------|-----------|------------|
| `'assignment'` | Ownership | Ownership | #E60000 (red) |
| `'namechg'` | Ownership | Name Change | #2493f2 (blue) |
| `'security'` | Security | Security | #ffaa00 (orange) |
| `'release'` | Security | Release | #70A800 (green) |
| `'license'` | Licenses | License | #E6E600 (yellow) |
| `'merger'`, `'other'`, `'correct'`, `'missing'`, `'govern'`, `'employee'` | Ownership | Ownership | #E60000 (default red) |

## B. Name Normalization

**Source files:** `normalize_file.php`, `normalize_names.js`, `update_assignor_and_assignee_original_name.php`, `update_retirved_cited_patents_assignees.js`

The system normalizes entity names to group variations of the same company/person.

### Manual Mapping

The `assignment_conveyance` CSV file (processed by `assignment_conveyance.php`) stores exact text → type mappings that bypass automated normalization.

### Automated Suffix Removal

**From `normalize_file.php`:**

```php
function remove_if_trailing($haystack, $needle) {
    $needle_position = strlen($needle) * -1;
    
    if (substr(strtolower($haystack), $needle_position) == strtolower($needle)) {
        $haystack = substr($haystack, 0, $needle_position);
        
        // Append standardized suffix
        if (strtolower($needle) == "company") {
            $haystack .= " co";
        } elseif (strtolower($needle) == "incorporated") {
            $haystack .= " inc";
        } elseif (strtolower($needle) == "limited") {
            $haystack .= " ltd";
        } elseif (strtolower($needle) == "corporation") {
            $haystack .= " corp";
        }
        
        return array(trim(ucwords(strtolower($haystack))), 1);
    }
    
    return array(trim(ucwords(strtolower($haystack))), 0);
}

// Processing chain
$stringC = remove_if_trailing($orName, "corporation");
if ($stringC[1] === 0) {
    $stringC = remove_if_trailing($orName, "incorporated");
    if ($stringC[1] === 0) {
        $stringC = remove_if_trailing($orName, "limited");
        if ($stringC[1] === 0) {
            $stringC = remove_if_trailing($orName, "company");
        }
    }
}
```

**Result:** 
- "Microsoft Corporation" → "Microsoft Corp"
- "Apple Incorporated" → "Apple Inc"
- "Google Limited" → "Google Ltd"
- "Amazon Company" → "Amazon Co"

### Entity Suffix Regex

**From `update_retirved_cited_patents_assignees.js` and `update_flag.php`:**

```javascript
const entitySuffixRegex = /\b(?:inc|llc|corporation|corp|systems|system|llp|industries|gmbh|lp|agent|sas|na|bank|co|states|ltd|kk|a\/s|aktiebolag|kigyo|kaisha|university|kabushiki|company|plc|gesellschaft|gesmbh|société|societe|mbh|aktiengesellschaft|haftung|vennootschap|bv|bvba|aktien|limitata|srl|sarl|kommanditgesellschaft|kg|gesellschaft|gbr|ohg|handelsgesellschaft|compagnie|privatstiftung|foundation|cie)\b/ig
```

This regex identifies and standardizes international corporate entity suffixes across multiple languages:
- **English:** inc, llc, corp, co, ltd, lp, llp
- **German:** gmbh, ag, kg, gesellschaft
- **French:** société, sarl, compagnie, cie
- **Dutch:** bv, bvba, vennootschap
- **Italian:** srl, limitata
- **Japanese:** kk (株式会社), kabushiki, kaisha

### Levenshtein Distance Grouping

**From `normalize_names.js`:**

```javascript
// Sort names by word count (descending) for better matching
names.sort((a, b) => b.wordCount - a.wordCount);

// Group names if Levenshtein distance < threshold
const threshold = 5; // Distance varies 3-5 depending on name length

for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
        if (levenshteinDistance(names[i].name, names[j].name) < threshold) {
            // Group as same entity
            // Canonical name = name with highest occurrence count
        }
    }
}
```

**Storage:**

```sql
-- Canonical name storage
INSERT INTO db_uspto.representative 
    (representative_id, representative_name)
VALUES ({id}, {canonical_name});

-- Link original name to canonical
UPDATE db_uspto.assignor_and_assignee
SET representative_id = {representative_id}
WHERE name = {original_name};
```

### Grouping Algorithm

1. Sort names by word count (descending)
2. Calculate Levenshtein distance between all name pairs
3. If distance < threshold (3-5), mark as same entity
4. Select canonical name = name with highest occurrence count
5. Link all variations to canonical `representative_id`

**Limitations:** No false positive prevention mechanism.

## C. Inventor Deduplication

**Source files:** `inventor_levenshtein.js`, `update_flag.php`

The system identifies when inventors assign patents to companies they work for (inventor-to-employer assignments).

### Name Variation Generation

**From `inventor_levenshtein.js`:**

Each inventor name generates 6 variations:
1. Family-Given (e.g., "Smith John")
2. Given-Family (e.g., "John Smith")
3. Family-Given-Middle (e.g., "Smith John A")
4. Given-Middle-Family (e.g., "John A Smith")
5. Family only (e.g., "Smith")
6. Given only (e.g., "John")

### Matching Algorithm

**From `update_flag.php`:**

```php
// Step 1: Get all representative names for organization
$queryNames = "SELECT representative_name FROM representative 
               WHERE organisation_id = {org_id}";

// Step 2: Find rf_ids for those representatives
$queryRfIds = "SELECT rf_id FROM assignee 
               WHERE assignor_and_assignee_id IN (
                   SELECT assignor_and_assignee_id FROM assignor_and_assignee 
                   WHERE representative_id IN ({representative_ids})
               )";

// Step 3: Get inventors from biblio databases for those rf_ids
$queryInventors = "SELECT name FROM db_patent_grant_bibliographic.inventor 
                   WHERE appno_doc_num IN (
                       SELECT appno_doc_num FROM documentid 
                       WHERE rf_id IN ({rf_ids})
                   )
                   UNION
                   SELECT name FROM db_patent_application_bibliographic.inventor
                   WHERE appno_doc_num IN (
                       SELECT appno_doc_num FROM documentid 
                       WHERE rf_id IN ({rf_ids})
                   )";

// Step 4: Match inventor names against assignors using Levenshtein
foreach ($inventors as $inventor) {
    foreach ($assignors as $assignor) {
        // Generate 6 name variations for inventor
        $variations = generateNameVariations($inventor->name);
        
        foreach ($variations as $variation) {
            if (levenshteinDistance($variation, $assignor->name) < 5) {
                // Match found - mark as employee assignment
                $updateQuery = "UPDATE db_uspto.representative_assignment_conveyance 
                                SET employer_assign = 1, convey_ty = 'employee' 
                                WHERE rf_id = {assignor->rf_id}";
            }
        }
    }
}
```

### Match Action

When a match is found (Levenshtein distance < 5 for any variation):

```sql
UPDATE db_uspto.representative_assignment_conveyance
SET employer_assign = 1, convey_ty = 'employee'
WHERE rf_id = {rf_id};
```

### Threshold

- **Distance threshold:** < 5 for any of the 6 name variations
- **No false positive prevention:** The algorithm can incorrectly match similar names

## D. Ownership Tree Construction

**Source files:** `tree.php`, `fix_inventor_timeline_tree_transaction_assests_updates(3DEC2020).php`, `test_fix_inventor.php`

The system builds hierarchical ownership trees showing relationships between entities.

### Tree Table Schema

```sql
CREATE TABLE tree (
    assignor_and_assignee_id INT,
    name VARCHAR(255),
    parent INT,              -- Parent node ID (0 for root)
    type INT,               -- Transaction type code
    tab INT,                -- UI tab grouping code
    organisation_id INT,
    representative_id INT
);
```

### Tree Type/Tab Codes

**From `tree.php`:**

| Type | Tab | Transaction Category | Query Condition |
|------|-----|---------------------|-----------------|
| 0/1 | 0/1 | Employee Assignment | `employer_assign = 1` |
| 1 | 1 | Purchase (Assignment In) | `convey_ty = 'assignment'` AND assignee matches org |
| 2 | 1 | Sale (Assignment Out) | `convey_ty = 'assignment'` AND assignor matches org |
| 3 | 1 | Merger In | `convey_ty = 'merger'` AND assignee matches org |
| 4 | 1 | Merger Out | `convey_ty = 'merger'` AND assignor matches org |
| 5 | 2 | Security Out | `convey_ty = 'security'` AND assignee matches org |
| 6 | 2 | Security In | `convey_ty = 'security'` AND assignor matches org |
| 7 | 2 | Release Out | `convey_ty = 'release'` AND assignor matches org |
| 8 | 2 | Release In | `convey_ty = 'release'` AND assignee matches org |
| 9 | 3 | Name Change | `convey_ty = 'namechg'` |
| 10 | 3 | Govern | `convey_ty = 'govern'` |
| 11 | 3 | Correct | `convey_ty = 'correct'` |
| 12 | 3 | Missing | `convey_ty = 'missing'` |
| 13 | 3 | Other | `convey_ty = 'other'` |

### Construction Algorithm

```sql
-- Example: Purchase query (type=1, tab=1)
INSERT IGNORE INTO tree 
    (assignor_and_assignee_id, name, parent, type, tab, organisation_id, representative_id)
SELECT 
    aaa.assignor_and_assignee_id,
    CASE WHEN r.representative_name IS NOT NULL 
         THEN r.representative_name 
         ELSE aaa.name 
    END as show_name,
    0 as parent,
    1 as type,
    1 as tab,
    {organisation_id},
    {representative_id}
FROM assignor as `or`
LEFT JOIN assignor_and_assignee as aaa 
    ON aaa.assignor_and_assignee_id = or.assignor_and_assignee_id
LEFT JOIN representative as r 
    ON r.representative_id = aaa.representative_id
INNER JOIN (
    SELECT ee.rf_id 
    FROM assignee as ee
    INNER JOIN assignment_conveyance as ass ON ass.rf_id = ee.rf_id
    INNER JOIN documentid as d ON ass.rf_id = d.rf_id
    INNER JOIN assignor_and_assignee as aa 
        ON aa.assignor_and_assignee_id = ee.assignor_and_assignee_id
    LEFT JOIN representative as r1 
        ON r1.representative_id = aa.representative_id
    WHERE ass.convey_ty = "assignment" 
      AND ass.employer_assign = 0 
      AND aa.name IN ({org_names})
) as temp ON temp.rf_id = or.rf_id
GROUP BY show_name;
```

### Related Tables

**From `tree_script.php`:**

```sql
-- Third-party relationships
CREATE TABLE tree_parties (
    tree_id INT,
    assignor_and_assignee_id INT,
    rf_id VARCHAR(20),
    organisation_id INT
);

-- Party collections
CREATE TABLE tree_parties_collection (
    collection_id INT,
    tree_id INT,
    assignor_and_assignee_id INT,
    organisation_id INT
);
```

## E. Broken Title Chain Detection

**Source files:** `broken_title.php`, `assets_bank_broken_title.php`, `dashboard_with_company.php`

The system identifies patents with incomplete ownership chains (missing links from inventor to current owner).

### Detection Algorithm

**From `broken_title.php`:**

```php
// Step 1: Call stored procedures to populate temp tables
$con->query("CALL routine_transaction({company_id}, {organisation_id})");
$result = $con->query("CALL GetAssetsTableC('{company_id}', {organisation_id})");

// Step 2: For each asset, trace the ownership chain
while ($row = $result->fetch_object()) {
    $appno_doc_num = $row->appno_doc_num;
    
    // Get all transactions for this asset in chronological order
    $query = "SELECT 
        temp_document_transactions.rf_id,
        temp_document_transactions.assignor_and_assignee_id as frm,
        temp_document_transactions1.assignor_and_assignee_id as toA,
        temp_document_transactions.convey_name
    FROM temp_document_transactions
    INNER JOIN temp_document_transactions as temp_document_transactions1
        ON temp_document_transactions1.rf_id = temp_document_transactions.rf_id
        AND temp_document_transactions1.party_type > temp_document_transactions.party_type
    WHERE temp_document_transactions.appno_doc_num = '{$appno_doc_num}'
    ORDER BY 
        temp_document_transactions.transaction_date ASC,
        temp_document_transactions.party_type ASC";
    
    $resultA = $con->query($query);
    
    // Step 3: Check for chain continuity
    $previousAssignee = 0;
    $previousAssignor = 0;
    $previousRFID = 0;
    $totalEmployees = 0;
    $breakLoop = false;
    
    while ($rowA = $resultA->fetch_object()) {
        // Skip duplicate entries
        if ($previousRFID != $rowA->rf_id && 
            $previousAssignor != $rowA->frm && 
            $previousAssignee != $rowA->toA) {
            
            if ($rowA->convey_name == 'employee') {
                // Employee assignments don't break the chain
                if ($rowA->frm != 0) $totalEmployees++;
            } else {
                // Check if current assignor matches previous assignee
                if ($previousAssignee != 0 && $previousAssignee != $rowA->frm) {
                    // Chain is broken!
                    $breakLoop = true;
                    array_push($brokenTitle, '"'.$appno_doc_num.'"');
                    break;
                }
            }
            
            $previousRFID = $rowA->rf_id;
            $previousAssignor = $rowA->frm;
            $previousAssignee = $rowA->toA;
        }
    }
    
    // If chain is complete but starts with employee, still mark as broken
    if ($breakLoop === false && $totalEmployees == 0) {
        array_push($brokenTitle, '"'.$appno_doc_num.'"');
    }
}

// Step 4: Store broken titles
if (count($brokenTitle) > 0) {
    $con->query("DELETE FROM table_d 
                 WHERE company_id = {$companyID} 
                 AND organisation_id = {$organisationID}");
    
    $con->query("INSERT IGNORE INTO table_d 
                 SELECT appno_doc_num, representative_id, company_id, organisation_id
                 FROM table_c
                 WHERE appno_doc_num IN (".implode(',', $brokenTitle).")
                 AND company_id = {$companyID}
                 AND organisation_id = {$organisationID}");
}
```

### Business Rule

**A title is "broken" when:**
1. There's no continuous chain from inventor to current owner through ownership-transfer transactions, OR
2. The chain exists but doesn't start with an inventor-to-employer (employee) assignment

**Chain continuity check:**
- For each transaction in chronological order
- The assignee of transaction N must equal the assignor of transaction N+1
- Employee assignments (`convey_name = 'employee'`) are allowed as chain starters but don't create links
- Any gap in the chain marks the title as broken

### Storage

**From `dashboard_with_company.php`:**

```sql
-- Insert broken chains into dashboard items
INSERT INTO db_new_application.dashboard_items
    (organisation_id, representative_id, assignor_id, type, patent, application)
VALUES
    ({org_id}, {rep_id}, {assignor_id}, 1, {grant_num}, {app_num});
```

Where `type = 1` indicates "Broken Chain of Title"

## F. Dashboard JSON Generation

**Source files:** `dashboard_with_company.php` (~220KB), `dashboard_with_bank.php`

The system generates aggregated dashboard data showing portfolio health, encumbrances, and third-party relationships.

### Dashboard Item Types

**Stored in `db_new_application.dashboard_items` table:**

```sql
CREATE TABLE dashboard_items (
    organisation_id INT,
    representative_id INT,
    assignor_id INT,
    type INT,              -- Dashboard item type
    patent VARCHAR(20),    -- Grant document number
    application VARCHAR(20), -- Application number
    rf_id VARCHAR(20),     -- Reel/frame ID
    total INT,
    lawfirm VARCHAR(255),
    lawfirm_id INT
);
```

**Type Codes:**

| Type | Category | Description |
|------|----------|-------------|
| 0 | Chain of Title | Complete ownership chain |
| 1 | Broken Chain | Broken title chain |
| 18 | Encumbrances | Security interests/liens |
| 20 | Law Firms | Associated law firms |
| 28+ | Asset Categories | Various asset categorizations |
| 30 | Bank Assets | Bank-related security interests |
| 31 | Unassigned | Assets without current assignee |
| 33 | Bank Assets | Additional bank categorization |
| 34 | Additional Counts | Supplemental statistics |
| 35 | Bank Assets | Further bank-related assets |
| 36 | Bank Assets | Final bank asset category |
| 37 | Special Counts | Special case statistics |

### Dashboard Counts

**Stored in `db_new_application.dashboard_items_count` table:**

```sql
CREATE TABLE dashboard_items_count (
    number INT,
    other_number INT,
    total INT,
    organisation_id INT,
    representative_id INT,
    assignor_id INT,
    type INT,
    other VARCHAR(255)
);
```

### Generation Logic

**From `dashboard_with_company.php`:**

```php
// Step 1: Clear existing dashboard data
$con->query("DELETE FROM db_new_application.dashboard_items 
             WHERE organisation_id = {$org_id} 
             AND representative_id = {$rep_id}");

// Step 2: Populate chain of title (type=0)
$query = "INSERT INTO db_new_application.dashboard_items
          (organisation_id, representative_id, type, patent, application)
          SELECT {$org_id}, {$rep_id}, 0, grant_doc_num, appno_doc_num
          FROM db_new_application.assets
          WHERE organisation_id = {$org_id}
          AND company_id = {$company_id}
          AND layout_id = 15
          AND appno_doc_num NOT IN (
              SELECT appno_doc_num FROM table_d 
              WHERE organisation_id = {$org_id}
          )";

// Step 3: Populate broken chains (type=1) - already done by broken_title.php

// Step 4: Populate encumbrances (type=18)
$query = "INSERT INTO db_new_application.dashboard_items
          (organisation_id, representative_id, type, patent, application, rf_id)
          SELECT {$org_id}, {$rep_id}, 18, grant_doc_num, appno_doc_num, rf_id
          FROM db_new_application.activity_parties_transactions
          WHERE organisation_id = {$org_id}
          AND company_id = {$company_id}
          AND activity_id IN (5, 6)"; // Security/Release activities

// Step 5: Populate law firms (type=20)
$query = "INSERT INTO db_new_application.dashboard_items
          (organisation_id, representative_id, type, patent, application, lawfirm, lawfirm_id)
          SELECT {$org_id}, {$rep_id}, 20, grant_doc_num, appno_doc_num, 
                 lf.name, lf.law_firm_id
          FROM db_uspto.correspondent c
          INNER JOIN db_uspto.law_firm lf ON lf.name = c.cname
          WHERE c.rf_id IN (
              SELECT rf_id FROM db_uspto.documentid
              WHERE appno_doc_num IN ({asset_list})
          )";

// Step 6: Calculate counts
$con->query("DELETE FROM db_new_application.dashboard_items_count 
             WHERE organisation_id = {$org_id}");

$query = "INSERT INTO db_new_application.dashboard_items_count
          (number, total, organisation_id, representative_id, type)
          SELECT COUNT(*), COUNT(*), {$org_id}, {$rep_id}, type
          FROM db_new_application.dashboard_items
          WHERE organisation_id = {$org_id}
          AND representative_id = {$rep_id}
          GROUP BY type";
```

### Bank-Related Asset Processing

**From `dashboard_with_bank.php`:**

```php
// Identify security interests with bank entities
$queryBankSecurity = "SELECT rf_id, appno_doc_num, grant_doc_num
                      FROM db_uspto.bank_security_transactions
                      WHERE assignee_id IN (
                          SELECT assignor_and_assignee_id 
                          FROM assignor_and_assignee
                          WHERE representative_id IN ({bank_rep_ids})
                      )";

// Mark as type=30 (bank security interests)
$con->query("INSERT INTO dashboard_items (..., type, ...) VALUES (..., 30, ...)");

// Process releases
$queryBankRelease = "SELECT rf_id, appno_doc_num, grant_doc_num
                     FROM db_uspto.bank_release_transactions
                     WHERE release_rf_id IN ({security_rf_ids})";
```

## G. Timeline Generation

**Source files:** `timeline.php`

The system generates chronological timelines of all transactions involving an organization's patents.

### Timeline Table Schema

```sql
CREATE TABLE db_application.timeline (
    rf_id VARCHAR(20),
    reel_no VARCHAR(10),
    frame_no VARCHAR(10),
    record_dt DATE,
    organisation_id INT,
    representative_id INT,
    type ENUM('Assignor', 'Assignee'),  -- Role in transaction
    original_name VARCHAR(255),
    assignor_and_assignee_id INT,
    exec_dt DATE,
    convey_ty VARCHAR(50),
    employer_assign TINYINT
);
```

### Generation Algorithm

**From `timeline.php`:**

```php
// CLI args: php timeline.php {organisationID} {representativeID}
$organisationID = $argv[1];
$representativeID = $argv[2];

// Step 1: Get organization database credentials
$queryOrg = "SELECT * FROM db_business.organisation 
             WHERE organisation_id = {$organisationID}";
$orgRow = $result->fetch_object();
$orgConnect = new mysqli($orgRow->org_host, $orgRow->org_usr, 
                         $orgRow->org_pass, $orgRow->org_db);

// Step 2: Get all representative names for this organization
$queryRep = "SELECT representative_id, original_name, representative_name
             FROM representative
             WHERE representative_id = {$representativeID}
             OR parent_id = {$representativeID}";

// Step 3: Clear existing timeline
$con->query("DELETE FROM db_application.timeline 
             WHERE organisation_id = {$organisationID}");

// Step 4: Insert timeline entries for each transaction category

// 4a. Employee assignments (employer_assign = 1)
// As Assignor
$query = "INSERT IGNORE INTO db_application.timeline
          (rf_id, reel_no, frame_no, record_dt, organisation_id, 
           representative_id, type, original_name, assignor_and_assignee_id, 
           exec_dt, convey_ty, employer_assign)
          SELECT ac.rf_id, ass.reel_no, ass.frame_no, ass.record_dt,
                 {$organisationID}, {$representativeID}, 'Assignor',
                 aa.name, aa.assignor_and_assignee_id, ac.exec_dt,
                 acc.convey_ty, acc.employer_assign
          FROM assignor as ac
          INNER JOIN assignment as ass ON ass.rf_id = ac.rf_id
          INNER JOIN assignment_conveyance as acc ON acc.rf_id = ac.rf_id
          INNER JOIN assignor_and_assignee as aa 
              ON aa.assignor_and_assignee_id = ac.assignor_and_assignee_id
          INNER JOIN (
              SELECT ee.rf_id FROM assignee as ee
              INNER JOIN assignor_and_assignee as aaa 
                  ON aaa.assignor_and_assignee_id = ee.assignor_and_assignee_id
              WHERE aaa.name IN ({org_names})
              AND date_format(d.appno_date, '%Y') > '1999'
          ) as temp ON temp.rf_id = ac.rf_id
          WHERE acc.employer_assign = 1";

// As Assignee
$query = "INSERT IGNORE INTO db_application.timeline
          (rf_id, reel_no, frame_no, record_dt, organisation_id,
           representative_id, type, original_name, assignor_and_assignee_id,
           exec_dt, convey_ty, employer_assign)
          SELECT ac.rf_id, ass.reel_no, ass.frame_no, ass.record_dt,
                 {$organisationID}, {$representativeID}, 'Assignee',
                 aa.name, aa.assignor_and_assignee_id,
                 (SELECT ap.exec_dt FROM assignor as ap 
                  WHERE ap.rf_id = ac.rf_id ORDER BY ap.exec_dt ASC LIMIT 1),
                 acc.convey_ty, acc.employer_assign
          FROM assignee as ac
          INNER JOIN assignment as ass ON ass.rf_id = ac.rf_id
          INNER JOIN assignment_conveyance as acc ON acc.rf_id = ac.rf_id
          INNER JOIN assignor_and_assignee as aa 
              ON aa.assignor_and_assignee_id = ac.assignor_and_assignee_id
          INNER JOIN (
              SELECT or.rf_id FROM assignor as `or`
              INNER JOIN assignor_and_assignee as aaa 
                  ON aaa.assignor_and_assignee_id = or.assignor_and_assignee_id
              WHERE aaa.name IN ({org_names})
              AND date_format(d.appno_date, '%Y') > '1999'
          ) as temp ON temp.rf_id = ac.rf_id
          WHERE acc.employer_assign = 1";

// 4b. Assignments and Mergers (convey_ty IN ('assignment', 'merger'))
// Similar pattern with different WHERE clause

// 4c. Security and Release (convey_ty IN ('security', 'release'))
// Similar pattern

// 4d. Administrative (convey_ty IN ('namechg', 'govern', 'other', 'missing', 'correct'))
// Similar pattern
```

### Data Fields

Each timeline entry captures:
- **Transaction ID:** rf_id, reel_no, frame_no
- **Dates:** record_dt (recording date), exec_dt (execution date)
- **Organization Context:** organisation_id, representative_id
- **Role:** type ('Assignor' or 'Assignee')
- **Entity:** original_name, assignor_and_assignee_id
- **Classification:** convey_ty, employer_assign

### Filtering Rules

- Only includes transactions from 2000 onwards (`date_format(appno_date, '%Y') > '1999'`)
- Separate queries for each conveyance type category
- Both assignor and assignee perspectives captured

## H. Flag/State Updates

**Source files:** `update_flag.php` (~35KB)

The system identifies and flags inventor-to-employer assignments using name matching and Levenshtein distance.

### Employee Flag Algorithm

```php
// Step 1: Get all representative names for organization
$queryReps = "SELECT representative_name FROM representative
              WHERE organisation_id = {$org_id}";

// Step 2: Find all rf_ids involving those representatives as assignees
$queryRfIds = "SELECT DISTINCT ee.rf_id
               FROM assignee as ee
               INNER JOIN assignor_and_assignee as aa 
                   ON aa.assignor_and_assignee_id = ee.assignor_and_assignee_id
               WHERE aa.name IN ({representative_names})";

// Step 3: Get inventors for those patents from biblio databases
$queryInventors = "
    SELECT name, appno_doc_num
    FROM db_patent_grant_bibliographic.inventor
    WHERE appno_doc_num IN (
        SELECT appno_doc_num FROM db_uspto.documentid
        WHERE rf_id IN ({rf_ids})
    )
    UNION
    SELECT name, appno_doc_num
    FROM db_patent_application_bibliographic.inventor
    WHERE appno_doc_num IN (
        SELECT appno_doc_num FROM db_uspto.documentid
        WHERE rf_id IN ({rf_ids})
    )";

// Step 4: For each inventor, check if they appear as assignor
foreach ($inventors as $inventor) {
    // Parse inventor name
    $nameParts = explode(' ', $inventor->name);
    $familyName = $nameParts[0];
    $givenName = $nameParts[1] ?? '';
    $middleName = $nameParts[2] ?? '';
    
    // Generate name variations
    $variations = [
        "$familyName $givenName",
        "$givenName $familyName",
        "$familyName $givenName $middleName",
        "$givenName $middleName $familyName",
        "$familyName",
        "$givenName"
    ];
    
    // Get assignors for this rf_id
    $queryAssignors = "SELECT or.rf_id, aa.name
                       FROM assignor as `or`
                       INNER JOIN assignor_and_assignee as aa 
                           ON aa.assignor_and_assignee_id = or.assignor_and_assignee_id
                       WHERE or.rf_id = {$inventor->rf_id}";
    
    foreach ($assignors as $assignor) {
        foreach ($variations as $variation) {
            $distance = levenshtein($variation, $assignor->name);
            
            if ($distance < 5) {
                // Match found - update flags
                $updateQuery = "UPDATE db_uspto.representative_assignment_conveyance
                                SET employer_assign = 1, convey_ty = 'employee'
                                WHERE rf_id = {$assignor->rf_id}";
                $con->query($updateQuery);
                
                // Also update assignment_conveyance table
                $updateQuery2 = "UPDATE db_uspto.assignment_conveyance
                                 SET employer_assign = 1, convey_ty = 'employee'
                                 WHERE rf_id = {$assignor->rf_id}";
                $con->query($updateQuery2);
                
                break 2; // Exit both loops
            }
        }
    }
}
```

### Update Cascade

After updating employer flags, the script triggers downstream updates:

```php
// Reclassify transaction types
exec("php update_missing_type.php");

// Rebuild customer database
exec("php create_data_for_company_db_application.php {$org_id}");
```

### Tables Updated

```sql
-- Primary flag storage
UPDATE db_uspto.representative_assignment_conveyance
SET employer_assign = 1, convey_ty = 'employee'
WHERE rf_id = {rf_id};

-- Secondary flag storage
UPDATE db_uspto.assignment_conveyance
SET employer_assign = 1, convey_ty = 'employee'
WHERE rf_id = {rf_id};
```

## I. Summary Generation

**Source files:** `summary.php`, `all_summary.php`

The system computes portfolio statistics for dashboard display.

### Summary Table Schema

```sql
CREATE TABLE summary (
    organisation_id INT,
    company_id INT,
    companies INT,      -- Count of companies
    activities INT,     -- Count of activity types
    entities INT,       -- Count of 3rd party entities
    parties INT,        -- Count of parties
    employees INT,      -- Count of employee transactions
    transactions INT,   -- Count of transactions
    assets INT,         -- Count of assets
    arrows INT          -- Count of relationship arrows
);
```

### Calculation Logic

**From `summary.php`:**

```php
// CLI args: php summary.php {organisationID} {representativeName} {orgRun}
$organisationID = $argv[1];
$representativeName = $argv[2];  // Optional filter
$orgRun = $argv[3];  // 1 = generate org-level summary

// Step 1: Get all companies for this organization
$queryCompanies = "SELECT representative_id, representative_name
                   FROM representative
                   WHERE organisation_id = {$org_id}
                   AND type = 0  -- Company type
                   AND parent_id = 0";

// For each company, calculate:

// 1. EMPLOYEES COUNT
$queryEmployees = "
    SELECT name FROM (
        -- Inventors from application biblio
        SELECT name, appno_doc_num
        FROM db_patent_application_bibliographic.inventor
        WHERE appno_doc_num IN ({company_assets})
        GROUP BY name, appno_doc_num
        
        UNION
        
        -- Inventors from grant biblio (not in application)
        SELECT name, appno_doc_num
        FROM db_patent_grant_bibliographic.inventor
        WHERE appno_doc_num IN ({company_assets})
        AND appno_doc_num NOT IN (
            SELECT appno_doc_num 
            FROM db_patent_application_bibliographic.inventor
            WHERE appno_doc_num IN ({company_assets})
        )
        GROUP BY name, appno_doc_num
    ) AS tempEmployees
    WHERE name NOT IN ({already_flagged_employees})
    GROUP BY name";

$totalEmployees = $result->num_rows;

// Add pre-flagged employees
if (count($employeeName) > 0) {
    $totalEmployees += count($employeeName);
}

// 2. PARTIES COUNT (3rd parties in recorded transactions)
$queryParties = "
    SELECT count(*) as countParties FROM (
        SELECT apt.assignor_and_assignee_id
        FROM db_new_application.activity_parties_transactions AS apt
        WHERE activity_id <> 10  -- Exclude certain activity type
        AND organisation_id = {$org_id}
        AND company_id = {$company_id}
        GROUP BY apt.assignor_and_assignee_id
    ) AS temp";

// 3. ENTITIES COUNT (3rd parties not in recorded transactions)
$queryEntities = "
    SELECT COUNT(*) AS tempCount FROM (
        SELECT assignor_and_assignee_id FROM (
            -- From assignees
            SELECT assignor_and_assignee_id
            FROM assignee
            WHERE rf_id IN ({relevant_rf_ids})
            AND assignor_and_assignee_id NOT IN (
                SELECT assignor_and_assignee_id FROM inventors
            )
            AND assignor_and_assignee_id NOT IN (
                SELECT recorded_assignor_and_assignee_id
                FROM db_new_application.activity_parties_transactions
                WHERE organisation_id = {$org_id}
                AND company_id = {$company_id}
            )
            GROUP BY assignor_and_assignee_id
            
            UNION
            
            -- From assignors
            SELECT assignor_and_assignee_id
            FROM assignor
            WHERE rf_id IN ({relevant_rf_ids})
            AND assignor_and_assignee_id NOT IN (
                SELECT assignor_and_assignee_id FROM inventors
            )
            AND assignor_and_assignee_id NOT IN (
                SELECT recorded_assignor_and_assignee_id
                FROM db_new_application.activity_parties_transactions
                WHERE organisation_id = {$org_id}
                AND company_id = {$company_id}
            )
            GROUP BY assignor_and_assignee_id
        ) AS temp
        GROUP BY assignor_and_assignee_id
    ) AS temp1";

// 4. TRANSACTIONS COUNT
$queryTransactions = "
    SELECT count(*) AS counTransactions FROM (
        SELECT rf_id
        FROM db_uspto.documentid
        WHERE appno_doc_num IN ({company_assets})
        GROUP BY rf_id
    ) AS temp";

// 5. ACTIVITIES COUNT (with grouping)
$queryActivities = "
    SELECT COUNT(DISTINCT activity) AS noOfActivities
    FROM (
        SELECT CASE
            WHEN activity_id = 11 THEN 5
            WHEN activity_id = 12 THEN 5
            WHEN activity_id = 13 THEN 5
            WHEN activity_id = 16 THEN 5
            ELSE activity_id
        END AS activity
        FROM db_new_application.activity_parties_transactions
        WHERE organisation_id = {$org_id}
        AND company_id = {$company_id}
        GROUP BY organisation_id, activity_id
    ) AS temp";

// 6. ARROWS COUNT (visualization connection lines)
$queryArrows = "
    SELECT SUM(arrows) AS totalArrows
    FROM assignment_arrows
    WHERE rf_id IN (
        SELECT rf_id FROM db_uspto.documentid
        WHERE appno_doc_num IN ({company_assets})
    )";

// 7. ASSETS COUNT
$totalAssets = count($allCompanyAssets);

// Insert company-level summary
$queryInsert = "
    INSERT IGNORE INTO summary
    (organisation_id, company_id, companies, activities, entities, 
     parties, employees, transactions, assets, arrows)
    VALUES
    ({$org_id}, {$company_id}, 1, {$totalActivities}, {$totalEntities},
     {$totalParties}, {$totalEmployees}, {$totalTransactions}, 
     {$totalAssets}, {$totalArrows})";
```

### Organization-Level Summary

When `$orgRun == '1'`, also compute org-level rollup:

```php
// Combine all company assets
$queryAllAssets = "SELECT appno_doc_num FROM db_new_application.assets
                   WHERE organisation_id = {$org_id}
                   AND company_id IN (".implode(',', $all_company_ids).")
                   AND date_format(appno_date, '%Y') > {$YEAR}
                   AND layout_id = {$LAYOUTID}";

// Recalculate all metrics across all companies

// Insert org-level summary (company_id = 0)
$queryInsert = "
    INSERT IGNORE INTO summary
    (organisation_id, company_id, companies, activities, entities,
     parties, employees, transactions, assets, arrows)
    VALUES
    ({$org_id}, 0, {count($all_companies)}, {$totalActivities}, 
     {$totalEntities}, {$totalParties}, {$totalEmployees}, 
     {$totalTransactions}, {$totalAssets}, {$totalArrows})";
```

### Activity Grouping Rules

Activities 11, 12, 13, and 16 are grouped as activity 5:

```sql
CASE
    WHEN activity_id = 11 THEN 5
    WHEN activity_id = 12 THEN 5
    WHEN activity_id = 13 THEN 5
    WHEN activity_id = 16 THEN 5
    ELSE activity_id
END AS activity
```

### Filtering Criteria

- **Date filter:** `date_format(appno_date, '%Y') > {$YEAR}` (default: > 1998)
- **Layout filter:** `layout_id = {$LAYOUTID}` (default: 15)
- **Date range for employee detection:** `BETWEEN 1998 AND 2001`

## J. Other Pipelines

### J1. Visualization JSON Generation

**Source file:** `generate_json.php` (~71KB)

Generates per-patent visualization JSON with boxes (entities) and connections (transactions).

**Output structure:**
```json
{
    "boxes": [
        {
            "id": "entity_1",
            "name": "Company Name",
            "type": "Ownership|Security|Licenses",
            "color": "#E60000|#ffaa00|#E6E600",
            "tooltip": "Entity details"
        }
    ],
    "connections": [
        {
            "from": "entity_1",
            "to": "entity_2",
            "type": "Ownership|Name Change|Security|Release|License",
            "color": "#E60000|#2493f2|#ffaa00|#70A800|#E6E600",
            "rf_id": "12345-0001",
            "reel_no": "12345",
            "frame_no": "0001",
            "pdf_url": "http://legacy-assignments.uspto.gov/...",
            "notes": "Transaction details"
        }
    ],
    "metadata": {
        "patent": "US1234567",
        "application": "12/345,678",
        "title": "Patent Title"
    }
}
```

### J2. EPO Patent Family Data

**Source file:** `epo_api_retrieve_patent_data.php`

Retrieves EPO (European Patent Office) patent family data and links to USPTO assignments.

**EPO OPS API queries:**
```
GET https://ops.epo.org/3.2/rest-services/family/publication/docdb/{patent_number}
GET https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/{patent_number}/biblio
```

**Linking logic:**
- Fetch EPO family members for USPTO patents
- Map EPO patent numbers to USPTO assignments
- Store family relationships in database

### J3. CPC Hierarchy

**Source file:** `cpc_parent_child.php`

Executes SPARQL queries against CPC (Cooperative Patent Classification) endpoint to build classification hierarchies.

**SPARQL query example:**
```sparql
PREFIX cpc: <http://www.w3.org/2004/02/skos/core#>
SELECT ?parent ?child
WHERE {
    ?child cpc:broader ?parent .
    FILTER(regex(str(?child), "^{cpc_code}"))
}
```

**Processing:**
- Query CPC hierarchy from W3C SPARQL endpoint
- Store parent-child relationships
- Enable classification tree navigation

### J4. Customer Data Orchestration

**Source file:** `create_data_for_company_db_application.php` (in customer-data-migrator)

Orchestrates the full data pipeline for a customer account. Executed after major data updates.

**Pipeline steps:**
```php
// 1. Update transaction type classifications
exec("php update_missing_type.php");

// 2. Update employee flags
exec("php update_flag.php {$org_id} {$rep_name} 1");

// 3. Rebuild ownership trees
exec("php tree.php {$org_id} {$rep_id}");

// 4. Generate timeline
exec("php timeline.php {$org_id} {$rep_id}");

// 5. Detect broken title chains
exec("php broken_title.php {$company_id} {$org_id}");

// 6. Generate dashboard data
exec("php dashboard_with_company.php {$org_id} {$rep_id}");

// 7. Calculate summary statistics
exec("php summary.php {$org_id} {$rep_name} 1");

// 8. Generate visualization JSON
exec("php generate_json.php {$org_id} {$rep_id}");
```

**Execution context:**
- Triggered manually or via cron
- Processes one organization at a time
- Can take hours for large portfolios
- Updates customer-specific database tables

---

## Pipeline Dependencies

```
Data Ingestion (Session 1)
    ↓
Transaction Type Classification
    ↓
Name Normalization
    ↓
Inventor Deduplication ────→ update_flag.php
    ↓                              ↓
Ownership Tree ←──────────────────┘
    ↓
Timeline Generation
    ↓
Broken Title Detection
    ↓
Dashboard Generation
    ↓
Summary Statistics
    ↓
Visualization JSON
```

## Performance Characteristics

- **Transaction Classification:** O(n) where n = number of unclassified transactions
- **Name Normalization:** O(n²) due to Levenshtein distance calculations
- **Inventor Deduplication:** O(n × m × 6) where n = inventors, m = assignors, 6 = name variations
- **Tree Construction:** O(n × m) where n = transactions, m = organization names
- **Broken Title Detection:** O(n × t) where n = assets, t = avg transactions per asset
- **Dashboard Generation:** Multiple complex queries, O(n × log n)
- **Summary Calculation:** O(n) with multiple table scans

## Data Quality Issues

1. **False Positives in Inventor Matching:** Levenshtein threshold of 5 can match unrelated names
2. **Missing Name Variations:** Only 6 variations per inventor may miss cultural naming conventions
3. **No Conflict Resolution:** Multiple matches treated as equal without confidence scoring
4. **No Audit Trail:** Updates have no rollback or versioning mechanism
5. **Inconsistent State:** Race conditions possible during multi-step updates
6. **Performance Degradation:** O(n²) algorithms don't scale to very large portfolios

## Business Logic Quirks

1. **Year Cutoff:** Most queries filter for `appno_date > '1999'` (excludes older patents)
2. **Activity ID Grouping:** Activities 11, 12, 13, 16 → 5 (undocumented business rule)
3. **Layout ID Filter:** Hardcoded `layout_id = 15` (meaning unclear)
4. **Employee Detection Window:** Special handling for 1998-2001 applications
5. **Broken Chain Definition:** Even complete chains marked broken if missing employee start
