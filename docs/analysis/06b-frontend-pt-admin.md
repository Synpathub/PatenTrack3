# PT-Admin-Application Analysis

**Repository:** Synpathub/PT-Admin-Application  
**Analysis Date:** February 2026  
**React Version:** 16.8.6  
**Package Name:** admin-patientrack-react  
**Application Type:** Internal Admin Dashboard  

---

## Table of Contents

1. [Application Structure](#1-application-structure)
2. [Page/View Inventory](#2-pageview-inventory)
3. [Admin Workflows](#3-admin-workflows)
4. [Forms Inventory](#4-forms-inventory)
5. [API Integration](#5-api-integration)
6. [Reusable Components](#6-reusable-components)
7. [Key Observations & Risks](#7-key-observations--risks)

---

## 1. Application Structure

### 1.1 Build Tooling

**Build System:** Create React App (react-scripts ^3.4.4)

```json
// package.json name
{
  "name": "admin-patientrack-react",
  "version": "0.1.0"
}
```

**Entry Point:** `src/index.js`
- ReactDOM.render with Provider (Redux store)
- BrowserRouter for routing
- ThemeProvider with Material UI custom theme
- App component renders routes

**Public Assets:**
- Located in `public/` directory
- Standard CRA structure

### 1.2 State Management

**Primary:** Redux 4.0.5 + Redux Thunk 2.3.0 + Redux Logger 3.0.6

**Store Configuration:** `src/store/configureStore.js`

**Combined Reducers** (`src/reducers/index.js`):
```javascript
{
  auth: authReducer,        // Authentication state
  patenTrack: patenTrackReducer  // Main application state
}
```

**Action Types:** `src/actions/actionTypes.js`
- **195 action type constants** defined
- Covers all aspects of admin operations

**Actions Files:**
- `src/actions/authActions.js` - Authentication actions (login, forget, checkCode, passwordReset, signOut)
- `src/actions/patenTrackActions.js` - **64KB file** with main application actions (enormous monolithic file)

**Reducers:**
- `src/reducers/authReducer.js` - Handles authentication state
- `src/reducers/patenTrackReducer.js` - **27KB file** with main application logic
- `src/reducers/initialState.js` - **192 lines** of initial state definition

**Initial State Structure** (from `initialState.js`):

```javascript
{
  // Customer data categories
  employee: [],
  ownership: [],
  merger: [],
  security: [],
  other: [],
  
  // UI State
  currentWidget: 'settings',  // Default widget
  searchBar: false,
  flags: {},
  tabIndex: 0,
  
  // Entity lists
  entities_list: [],
  transaction_list: [],
  assignment_list: [],
  asset_list: [],
  
  // Cited patent tracking
  cited_patents: [],
  cited_parties: {
    data: [],
    pagination: {},
    sorting: {},
  },
  
  // Validation counters
  validateCounter: {
    application: 0,
    patent: 0,
    encumbered: 0
  },
  
  // Asset counts
  weekly_transactions: 0,
  monthly_transactions: 0,
  quarterly_transactions: 0,
  weekly_applications: 0,
  monthly_applications: 0,
  quarterly_applications: 0,
  
  // Error tracking
  errorItems: {
    invent: [],
    assign: [],
    corr: [],
    address: [],
    security: []
  },
  
  // Corporate tree (4-level structure)
  curTree: {
    level1: null,
    level2: null,
    level3: null,
    level4: null
  },
  
  // PDF viewing state
  pdfFile: {
    document: null,
    form: null,
    agreement: null
  },
  pdfTab: 0,
  pdfView: false,
  
  // Admin users
  adminUserList: [],
  editRow: null,
  deleteRow: null,
  
  // Search state
  searchCompanies: [],
  lawfirm_addresses: [],
  company_addresses: []
}
```

### 1.3 Routing Configuration

**Router:** React Router DOM v5

**Routes** (`src/routes.js`):

```javascript
<Switch>
  <Route path="/dashboard" component={DashBoard}/>
  <Route path="/queries" component={Queries}/>
  <Route path="/reset/:token" component={Auth}/>
  <Route path="/" component={Auth}/>
</Switch>
```

**Route Descriptions:**
- `/` - Login page (Auth component)
- `/reset/:token` - Password reset flow (Auth component)
- `/dashboard` - Main admin dashboard (widget-based)
- `/queries` - Query execution page

**Widget-Based Sub-Routing:**

The Dashboard component uses Redux state (`currentWidget`) for internal navigation instead of URL-based routing. Available widgets:
- `'all'` - Combined view with multiple widgets
- `'nestedTree'` - Entity grouping/normalization
- `'fixItems'` - Fix data quality issues
- `'recordItems'` - Record items management
- `'comments'` - Comments management
- `'validateCounter'` - Validation counters
- `'updatedAssets'` - Recently updated assets
- `'transactions'` - Transaction management
- `'agreement'` - Agreement documents
- `'settings'` - User settings (default)

### 1.4 UI Component Library

**Primary:** Material UI v4

**Material UI Packages:**
```json
{
  "@material-ui/core": "^4.11.0",
  "@material-ui/icons": "^4.9.1",
  "@material-ui/lab": "^4.0.0-alpha.56"
}
```

**Additional UI Libraries:**
- **material-table** ^1.57.2 - Data tables with CRUD operations
- **DevExtreme React Grid** (@devexpress/dx-react-grid ^2.6.2) - Advanced data grid
- **react-virtualized** ^9.21.2 - Virtualized lists/tables for large datasets
- **react-window** ^1.8.5 - Alternative virtualization library
- **styled-components** ^5.1.1 - CSS-in-JS styling

**Layout Components:**
- **react-split-pane** ^0.1.92 - Resizable split layouts
- **react-draggable** - Draggable components
- **react-resizable** - Resizable components
- **react-perfect-scrollbar** - Custom scrollbars

### 1.5 Key Dependencies

**Core React:**
```json
{
  "react": "16.8.6",
  "react-dom": "16.8.6",
  "react-scripts": "^3.4.4"
}
```

**State Management:**
```json
{
  "react-redux": "^7.2.0",
  "redux": "^4.0.5",
  "redux-thunk": "^2.3.0",
  "redux-logger": "^3.0.6"
}
```

**HTTP Client:**
```json
{
  "axios": "^0.19.2"
}
```

**Authentication:**
```json
{
  "jwt-decode": "^2.2.0",
  "react-google-login": "^5.2.2"
}
```

**Data Visualization** (3 separate charting libraries!):
```json
{
  "d3": "^5.16.0",
  "recharts": "^1.6.2",
  "react-apexcharts": "^1.3.3",
  "react-chartjs-2": "^2.9.0"
}
```

**Real-Time Communication:**
```json
{
  "pusher-js": "^7.0.0"
}
```

**UI Components:**
```json
{
  "react-toastify": "^5.3.2",
  "react-event-timeline": "^1.6.3",
  "react-infinite-tree": "^1.0.0",
  "react-syntax-highlighter": "^11.0.2"
}
```

**Maps:**
```json
{
  "react-google-maps": "^9.4.5"
}
```

**Total Dependencies:** 94+ packages (inferred from similar CRA apps)

### 1.6 CSS Approach

**Primary:** Material UI's styling solution (JSS)

**Additional Styling:**
- **styled-components** ^5.1.1 for CSS-in-JS
- Component-level `styles.js` files (e.g., `DashBoard/styles.js`, `auth/styles.js`, `Queries/styles.js`)
- Material UI's `makeStyles` and `withStyles` HOCs
- Custom theme defined in `src/themes/`

**Code Formatting:**
- **Prettier** configured (`.prettierrc` in root)

---

## 2. Page/View Inventory

### 2.1 Auth Page (/)

**Component:** `src/components/auth/index.js`

**Functionality:**
- Container component for authentication flows
- Redirects to `/dashboard` if already authenticated
- Renders either Login form or Password Reset form based on state

**Features:**
- Username + password login
- "Forget Password" flow
- Email-based password reset
- Error messaging via Material UI

**Actions Used:**
- `login(username, password)`
- `forget(username)` - Initiates password reset
- `checkCode(code)` - Validates reset code from URL
- `passwordReset(password, code)` - Completes password reset

### 2.2 Password Reset Page (/reset/:token)

**Component:** `src/components/auth/reset.js`

**Functionality:**
- Same Auth container as login
- Parses `:token` from URL params
- Calls `checkCode(token)` on mount
- Shows password reset form if token is valid

**Flow:**
1. User receives email with reset link
2. Clicks link with token
3. Frontend validates token via API
4. User enters new password
5. Password updated via `passwordReset()` action

### 2.3 Dashboard Page (/dashboard)

**Component:** `src/components/DashBoard/DashBoard.js`

**Authentication:**
- Requires `authenticated` from Redux state
- Redirects to "/" if not authenticated

**Layout:**
- Always renders `Header` component at top
- Header contains widget selector for navigation
- Main content area renders based on `currentWidget` state

**Widget Rendering Logic:**

```javascript
switch (currentWidget) {
  case 'all':
    return <AllWidget />;  // Combined multi-widget view
  case 'nestedTree':
    return <LevelsNestedTreeGrid />;
  case 'fixItems':
    return <FixItemsView />;
  case 'recordItems':
    return <RecordItemsContainer />;
  case 'comments':
    return <CommentComponents />;
  case 'validateCounter':
    return <ValidateCounter />;
  case 'updatedAssets':
    return <UpdatedAssets />;
  case 'transactions':
    return <TransactionsContainer />;
  case 'agreement':
    return <AgreementView />;
  case 'settings':
  default:
    return <UserSettings />;  // Default widget
}
```

**'all' Widget Layout:**

Grid layout with multiple widgets displayed simultaneously:

**Left Column:**
- ValidateCounter (20% width)
- LevelsNestedTreeGrid (60% width)
- TransactionsContainer (20% width)

**Center-Bottom:**
- UpdatedAssets
- CommentComponents

**Right Column:**
- PdfViewer
- RecordItemsContainer

### 2.4 Queries Page (/queries)

**Component:** `src/components/Queries/index.js`

**Functionality:**
- Separate page for running predefined database queries
- Text field for "Representative Name" (company name)
- Dropdown/selection of predefined queries

**Predefined Query List:**
- List1
- List2
- Table A
- Table B
- Table C
- Broken Title
- Correct Chain
- Correct Details

**Query Execution Flow:**
1. User enters representative company name
2. User selects query from list (queryNo)
3. Calls `PatenTrackApi.runQuery(representativeCompany, queryNo)`
4. Results displayed in react-virtualized Table
5. User can click on asset to view details
6. Calls `getAssets(selectedAssets, flag)` to load asset data

**Features:**
- react-virtualized Table for query results
- PatentrackDiagram (D3 visualization) for selected asset
- PDF viewer for documents
- Share and comment actions
- Download asset data as JSON
- Split pane layout for results + details

**API Endpoint:**
- `GET /admin/customers/run_query/{companyName}/{queryNo}`

### 2.5 Dashboard Widget Views

#### 2.5.1 Settings Widget (Default)

**Component:** `src/components/common/UserSettings/`

**Functionality:**
- Default widget shown when dashboard loads
- User profile settings
- Admin configuration options
- Widget selector/switcher

#### 2.5.2 Nested Tree Widget

**Component:** `src/components/common/LevelsNestedTreeGrid/`

**Functionality:**
- Entity grouping and normalization interface
- 4-level tree structure for corporate hierarchy
- Drag-and-drop for entity organization
- Manual and suggested groupings

**Related APIs:**
- `getEntitiesList(clientID, portfolios, type)`
- `getGroupSuggestions(clientID, portfolios, type)`
- `fixedGroupIdenticalItems(clientID, portfolios, type)`
- `readEntitySuggestionFile(fileName)`
- `readDataFromFile(clientID, portfolios, type)`

#### 2.5.3 Validate Counter Widget

**Component:** `src/components/common/ValidateCounter/`

**Functionality:**
- Displays validation statistics
- Counters for applications, patents, encumbered assets
- Data quality metrics

#### 2.5.4 Record Items Widget

**Component:** `src/components/common/RecordItemsContainer/`

**Functionality:**
- Manage record items
- CRUD operations on records
- Validation and correction

#### 2.5.5 Comments Widget

**Component:** `src/components/common/CommentComponents/`

**Functionality:**
- Comment management system
- Add/view/delete comments on assets
- Real-time updates via Pusher

#### 2.5.6 Updated Assets Widget

**Component:** `src/components/common/UpdatedAssets/`

**Functionality:**
- Recently updated assets timeline
- Asset change tracking
- Quick access to modified data

#### 2.5.7 Transactions Widget

**Component:** `src/components/common/TransactionsContainer/`

**Functionality:**
- Transaction management
- Assignment tracking
- Transaction type classification

**Related APIs:**
- `getTransactionList(clientID, portfolios)`
- `getAssignmentList(clientID, portfolios)`
- `getRawAssignmentList(clientID, portfolios)`

---

## 3. Admin Workflows

### 3.1 Name Normalization (Entity Grouping)

**Components:**
- `src/components/common/LevelsNestedTreeGrid/` - Main interface
- `src/components/common/SearchCompanies/` - Company search

**Workflow:**
1. Admin selects customer (clientID) and portfolios
2. Calls `getEntitiesList(clientID, portfolios, type)` to load raw entities
3. Calls `getGroupSuggestions(clientID, portfolios, type)` to get AI suggestions
4. Admin reviews suggestions in nested tree interface
5. Manual grouping via drag-and-drop or selection
6. Calls `fixedGroupIdenticalItems(clientID, portfolios, type)` to apply fixed groupings
7. Can load pre-computed data via `readEntitySuggestionFile(fileName)`
8. Changes saved to normalize assignee/owner names

**API Endpoints:**
- `GET /admin/customers/customers/{clientID}/{portfolios}/{type}`
- `GET /admin/customers/customers/{clientID}/{portfolios}/{type}?suggestions=1`
- `GET /admin/customers/customers/{clientID}/{portfolios}/{type}?fixed_identicals=1`
- `GET /admin/customers/static_file/read_entity_file?fileName={fileName}`
- `GET /admin/customers/read_static_file/read_entity_file/{clientID}/{portfolios}/{type}`

**State Management:**
- `entities_list` - Current entity data
- `curTree` - 4-level tree structure (level1, level2, level3, level4)

### 3.2 Transaction Type / Classification Management

**Components:**
- `src/components/common/CompanyKeywords/` - Classification keyword management
- `src/components/common/TransactionsContainer/` - Transaction management

**Workflow:**
1. Admin navigates to classification keywords widget
2. Views existing keyword mappings via `getClassificationKeywordList()`
3. Adds new keyword-to-classification mapping via form
4. Posts new mapping via `postClassificationKeyword(formData)`
5. Keywords used to auto-classify incoming transaction data

**API Endpoints:**
- `GET /admin/company_keywords` - List all classification keywords
- `POST /admin/company_keywords` - Add new keyword mapping

**State Management:**
- Classification keyword list in Redux state

### 3.3 Data Quality Monitoring

**Components:**
- `src/components/common/ValidateCounter/` - Validation metrics
- `src/components/common/RecordItemsContainer/` - Error records
- `src/components/common/Reports/` - Health reports

**Workflow:**
1. Dashboard shows validation counters (applications, patents, encumbered)
2. Admin clicks on counter to view specific error category
3. RecordItems widget shows errors grouped by type:
   - invent (inventor errors)
   - assign (assignment errors)
   - corr (correspondence errors)
   - address (address errors)
   - security (security interest errors)
4. Admin can fix individual records or run bulk corrections
5. Generate health reports via `healthReport(formData, clientID)`

**API Endpoints:**
- `GET /admin/company/get_counter_cited_organisations_and_logo` - Validation counters
- `POST /admin/company/report_dashboard/{clientID}` - Generate health report

**State Management:**
- `validateCounter` - Counter values
- `errorItems` - Categorized error records

### 3.4 Customer/Account Management

**Components:**
- `src/components/common/Users/` - Customer user management
- `src/components/common/AdminUsers/` - Admin user management
- `src/components/common/Companies/` - Company management
- `src/components/common/NewCompanyRequest/` - New company requests

**Admin User Management Workflow:**
1. View admin users via `getAdminUsers()`
2. Add new admin: Form with user details, calls `addAdminUser(user)`
3. Edit admin: Update form, calls `updateAdminUser(user, ID)`
4. Delete admin: Confirmation, calls `deleteAdminUser(ID)`

**Customer Management Workflow:**
1. View customers via `getClients()`
2. Select customer to view portfolio companies via `getPortfolioCompanies(clientID)`
3. Manage customer settings and access

**New Company Requests Workflow:**
1. View pending requests via `getNewCompaniesRequest()`
2. Review request details
3. Approve/reject via `updateCompaniesRequest(formData)`

**API Endpoints:**
- `GET /admin/users` - List admin users
- `POST /admin/users` - Create admin user
- `PUT /admin/users/{ID}` - Update admin user
- `DELETE /admin/users/{ID}` - Delete admin user
- `GET /admin/customers` - List all customers
- `GET /admin/customers/{clientID}/companies` - Customer's portfolio companies
- `GET /admin/company/request` - Pending company requests
- `PUT /admin/company/request` - Update request status

**State Management:**
- `adminUserList` - Admin users with edit/delete row tracking
- Customer/company data in patenTrack state

### 3.5 Script/Query Execution

**Components:**
- `src/components/Queries/index.js` - Query execution page

**Workflow:**
1. Admin navigates to `/queries` page
2. Enters representative company name
3. Selects predefined query from list (8 options)
4. Clicks "Run Query" button
5. Calls `runQuery(companyName, queryNo)`
6. Results displayed in virtualized table
7. Can select asset to view details
8. PatentrackDiagram (D3) shows asset relationships
9. Can download results as JSON
10. Can view PDFs, share, or comment on assets

**API Endpoints:**
- `GET /admin/customers/run_query/{companyName}/{queryNo}` - Run predefined query

**Available Queries:**
- List1, List2
- Table A, Table B, Table C
- Broken Title
- Correct Chain
- Correct Details

### 3.6 Data Import/Export

**Components:**
- `src/components/common/CorporateTreeUploader/` - Corporate tree file upload
- Various components with export functionality

**Corporate Tree Upload Workflow:**
1. Admin uploads corporate tree file (CSV/Excel format likely)
2. File processed and validated
3. 4-level tree structure populated
4. Applied to customer's corporate hierarchy

**Export Workflow:**
- Query results can be downloaded as JSON
- Asset data exported for offline analysis

**State Management:**
- `curTree` - Uploaded corporate tree structure

### 3.7 Cited Patent / Third-Party Management

**Components:**
- `src/components/common/CitedPatent/` - Cited patent management

**Workflow:**
1. View cited patents/assignees via multiple endpoints:
   - `getCitedAssigneesList(clientID, portfolios, sortBy, sortDirection, rowsPerPage, currentPage)`
   - `getAllPartiesList(...)` - All parties
   - `getAllSavedPartiesList(...)` - Saved parties with logos
   - `getPartiesList(...)` - Filtered parties
2. Supports pagination, sorting, filtering
3. View cited assignee's owned assets via `getCitedAssigneesOwnedAssetsList(...)`
4. Update assignee query name via `updateAssigneeQuery(formData)`
5. Upload/update assignee logos via `updateAssigneesLogos(formData)`
6. View specific cited assignee data via `getCitedAssigneeData(clientID, portfolios, assigneeID)`

**API Endpoints:**
- `GET /admin/company/cited/{clientID}/...` (with pagination/sorting)
- `GET /admin/company/saved_logo/parties/all/{clientID}/...`
- `GET /admin/company/parties/all/{clientID}/...`
- `GET /admin/company/parties/{clientID}/...`
- `GET /admin/company/owned/cited/{clientID}/...`
- `GET /admin/company/cited/{clientID}/?...&assignee_id={assigneeID}`
- `PUT /admin/company/assignees/query_name` - Update query name
- `PUT /admin/company/assignees/logos` - Upload logos

**State Management:**
- `cited_patents` - Cited patent data
- `cited_parties` - Cited parties with pagination and sorting state

**CancelToken Support:**
- Implements axios CancelToken for concurrent request cancellation
- Allows interrupting long-running cited data fetches

### 3.8 Corporate Tree Management

**Components:**
- `src/components/common/LevelsNestedTreeGrid/` - Tree visualization
- `src/components/common/CorporateTreeUploader/` - File upload

**Workflow:**
1. Upload corporate hierarchy file via uploader
2. Tree structure parsed into 4 levels
3. Displayed in nested tree grid
4. Admin can navigate and edit hierarchy
5. Supports drag-and-drop reorganization
6. Changes saved to database

**State Management:**
- `curTree` object with 4 levels:
  ```javascript
  {
    level1: null,
    level2: null,
    level3: null,
    level4: null
  }
  ```

### 3.9 Health Reports

**Components:**
- `src/components/common/Reports/` - Health report generation

**Workflow:**
1. Admin selects customer and parameters
2. Configures report criteria via form
3. Submits via `healthReport(formData, clientID)`
4. Report generated server-side
5. Results displayed in dashboard
6. Can be exported for stakeholders

**API Endpoints:**
- `POST /admin/company/report_dashboard/{clientID}` - Generate health report

---

## 4. Forms Inventory

### 4.1 Login Form

**Component:** `src/components/auth/login.js`

**Fields:**
- Username (text input)
- Password (password input)

**Buttons:**
- Login - Calls `props.login(username, password)`
- Forget Password - Toggles to forget password mode

**Forget Password Mode:**
- Username field (email)
- Reset button - Calls `props.forget(username)`
- Cancel button - Returns to login mode

**Validation:**
- Client-side validation for required fields
- Error messages via Material UI

### 4.2 Password Reset Form

**Component:** `src/components/auth/reset.js`

**Fields:**
- New Password (password input)
- Confirm Password (password input)

**Buttons:**
- Reset Password - Calls `props.passwordReset(password, token)`

**Validation:**
- Password match validation
- Token validated on component mount

### 4.3 Admin User Add/Edit Form

**Component:** `src/components/common/AdminUsers/`

**Fields:**
- Full Name (text)
- Username (text)
- Email (email)
- Password (password, for new users)
- Role/Permissions (select)

**Actions:**
- Add: `addAdminUser(user)` → POST /admin/users
- Edit: `updateAdminUser(user, ID)` → PUT /admin/users/{ID}
- Delete: `deleteAdminUser(ID)` → DELETE /admin/users/{ID}

**Implementation:**
- Likely uses material-table with inline editing
- Row-level edit/delete tracking in Redux state

### 4.4 Customer User Form

**Component:** `src/components/common/Users/`

**Fields:**
- Customer-specific user fields
- Access permissions
- Portfolio assignments

**Actions:**
- Customer user CRUD operations
- API endpoints not visible in partial API file

### 4.5 Company Search Form

**Component:** `src/components/common/SearchCompanies/`

**Fields:**
- Company Name (text with autocomplete)
- Search filters
- Geographic filters

**Features:**
- Autocomplete suggestions
- Google Maps integration for location
- Results displayed in table/list

**State Management:**
- `searchCompanies` - Search results
- `company_addresses` - Geographic data
- `lawfirm_addresses` - Law firm locations

### 4.6 Corporate Tree Upload Form

**Component:** `src/components/common/CorporateTreeUploader/`

**Fields:**
- File upload input (CSV/Excel)
- Validation options
- Import settings

**Actions:**
- File upload with multipart/form-data
- Server-side processing
- Tree structure update

### 4.7 Classification Keyword Form

**Component:** `src/components/common/CompanyKeywords/`

**Fields:**
- Keyword (text)
- Classification Type (select)
- Category mapping

**Actions:**
- Add: `postClassificationKeyword(formData)` → POST /admin/company_keywords
- View: `getClassificationKeywordList()` → GET /admin/company_keywords

### 4.8 Company Request Form

**Component:** `src/components/common/NewCompanyRequest/`

**Fields:**
- Request details (read-only display)
- Status (select for update)
- Comments/notes

**Actions:**
- View: `getNewCompaniesRequest()` → GET /admin/company/request
- Update: `updateCompaniesRequest(formData)` → PUT /admin/company/request

### 4.9 Query Execution Form

**Component:** `src/components/Queries/index.js`

**Fields:**
- Representative Name (text input) - Company name
- Query Selection (dropdown/buttons)

**Query Options:**
- List1
- List2
- Table A
- Table B
- Table C
- Broken Title
- Correct Chain
- Correct Details

**Actions:**
- Run Query: `runQuery(representativeCompany, queryNo)` → GET /admin/customers/run_query/{companyName}/{queryNo}

### 4.10 Health Report Form

**Component:** `src/components/common/Reports/`

**Fields:**
- Customer Selection (select)
- Report Type (select)
- Date Range (date pickers)
- Parameters (various based on report type)

**Actions:**
- Generate: `healthReport(formData, clientID)` → POST /admin/company/report_dashboard/{clientID}

---

## 5. API Integration

### 5.1 HTTP Client Setup

**File:** `src/api/patenTrack.js` (250+ lines visible, 64KB+ total file)

**Axios Configuration:**

```javascript
// Timeout: 10 minutes (600 seconds)
axios.defaults.timeout = 600000;

// Base URL from config
baseURL: config.base_api_url  // Points to betapp1.patentrack.com
// Also uses: config.base_new_api_url
```

**Content Types Supported:**
- `application/json` (default)
- `multipart/form-data` (file uploads)
- `application/x-www-form-urlencoded` (form data)

**CancelToken Pattern:**

For concurrent request cancellation (cited data, parties, search):

```javascript
// Create cancel token source
const CancelToken = axios.CancelToken;
const source = CancelToken.source();

// Use in request
axios.get(url, {
  cancelToken: source.token
})

// Cancel on new request
source.cancel('Operation canceled by user');
```

### 5.2 Auth Handling

**File:** `src/api/authApi.js`

**Token Storage:**
- **Dual Storage:** localStorage AND cookie
- **Key:** `admin_token`
- **Cookie Domain:** `.patentrack.com` (shared across subdomains)

**Authentication Flow:**

1. **Login** (POST /admin/signin):
   ```javascript
   // authActions.js - loginSuccess action
   localStorage.setItem('admin_token', token);
   document.cookie = `admin_token=${token}; domain=.patentrack.com`;
   
   // Decode JWT
   const decoded = jwtDecode(token);
   
   // Dispatch initEnvironment()
   dispatch(initEnvironment());
   ```

2. **Request Headers:**
   ```javascript
   headers: {
     'x-auth-token': localStorage.getItem('admin_token')
   }
   ```

3. **Token Refresh:**
   - No visible token refresh mechanism
   - JWT expiry handled server-side

4. **Sign Out:**
   - Removes token from localStorage and cookie
   - Redirects to login

**JWT Structure (decoded):**
```javascript
{
  id: admin_user_id,
  orgId: organisation_id,
  role: 'admin',
  iat: issued_timestamp,
  exp: expiry_timestamp
}
```

### 5.3 Error Handling

**Global Error Handling:**
- Axios interceptors for error responses
- Toast notifications via react-toastify
- Error state in Redux for per-request errors

**Error Display:**
- Material UI Snackbar/Alert components
- Toast messages for API errors
- Form validation errors inline

**Retry Logic:**
- Not visible in partial API file
- Likely handled at action level for specific operations

### 5.4 Complete API Call Inventory

**Note:** This inventory is based on the first 250 lines of `src/api/patenTrack.js`. The complete file is 64KB+ with many more endpoints.

#### Authentication APIs (authApi.js)

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| POST | `/admin/signin` | Admin login | ✅ 04-api-surface.md |
| POST | `/admin/forgot_password` | Initiate password reset | ✅ 04-api-surface.md |
| POST | `/admin/update_password_via_email` | Reset password | ✅ 04-api-surface.md |
| GET | `/admin/reset/:code` | Validate reset code | ✅ 04-api-surface.md |

#### Admin User Management

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/users` | List admin users | ✅ 04-api-surface.md |
| POST | `/admin/users` | Create admin user | ✅ 04-api-surface.md |
| PUT | `/admin/users/{ID}` | Update admin user | ✅ 04-api-surface.md |
| DELETE | `/admin/users/{ID}` | Delete admin user | ✅ 04-api-surface.md |
| GET | `/profile` | Get current user profile | ✅ 04-api-surface.md |

#### Customer Management

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/customers` | List all customers | ✅ 04-api-surface.md |
| GET | `/admin/customers/{clientID}/companies` | Get customer's portfolio companies | ✅ 04-api-surface.md |
| GET | `/admin/customers/run_query/{companyName}/{queryNo}` | Run predefined query | ✅ 04-api-surface.md |

#### Entity Normalization

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/customers/customers/{clientID}/{portfolios}/{type}` | Get entities list | ✅ 04-api-surface.md |
| GET | `/admin/customers/customers/{clientID}/{portfolios}/{type}?suggestions=1` | Get grouping suggestions | ✅ 04-api-surface.md |
| GET | `/admin/customers/customers/{clientID}/{portfolios}/{type}?fixed_identicals=1` | Get fixed identical groups | ✅ 04-api-surface.md |
| GET | `/admin/customers/static_file/read_entity_file?fileName={fileName}` | Read entity suggestion file | ✅ 04-api-surface.md |
| GET | `/admin/customers/read_static_file/read_entity_file/{clientID}/{portfolios}/{type}` | Read static entity file | ✅ 04-api-surface.md |

#### Asset & Patent Data

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/company/assets/{entityID}` | Get entity's assets | ✅ 04-api-surface.md |
| GET | `/admin/company/family/{clientID}/{portfolios}?retrievedAll={bool}` | Run family API | ✅ 04-api-surface.md |

#### Transaction Management

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/company/transactions/{clientID}/{portfolios}` | Get transaction list | ✅ 04-api-surface.md |
| GET | `/admin/company/assignments/{clientID}/?portfolios={portfolios}` | Get assignment list | ✅ 04-api-surface.md |
| GET | `/admin/company/raw/assignments/{clientID}/?portfolios={portfolios}` | Get raw assignment list | ✅ 04-api-surface.md |

#### Cited Patent / Third-Party Data

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/company/get_counter_cited_organisations_and_logo` | Get cited assignee counter | ✅ 04-api-surface.md |
| GET | `/admin/company/cited/{clientID}/...` | Get cited assignees (paginated/sorted) | ✅ 04-api-surface.md |
| GET | `/admin/company/saved_logo/parties/all/{clientID}/...` | Get all saved parties with logos | ✅ 04-api-surface.md |
| GET | `/admin/company/parties/all/{clientID}/...` | Get all parties | ✅ 04-api-surface.md |
| GET | `/admin/company/parties/{clientID}/...` | Get parties (filtered) | ✅ 04-api-surface.md |
| GET | `/admin/company/owned/cited/{clientID}/...` | Get cited assignee's owned assets | ✅ 04-api-surface.md |
| GET | `/admin/company/cited/{clientID}/?...&assignee_id={assigneeID}` | Get specific cited assignee data | ✅ 04-api-surface.md |
| PUT | `/admin/company/assignees/query_name` | Update assignee query name | ✅ 04-api-surface.md |
| PUT | `/admin/company/assignees/logos` | Update assignee logos | ✅ 04-api-surface.md |

#### Classification & Keywords

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/company_keywords` | Get classification keyword list | ✅ 04-api-surface.md |
| POST | `/admin/company_keywords` | Add classification keyword | ✅ 04-api-surface.md |

#### Company Requests

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| GET | `/admin/company/request` | Get new company requests | ✅ 04-api-surface.md |
| PUT | `/admin/company/request` | Update company request | ✅ 04-api-surface.md |

#### Reports

| Method | Endpoint | Description | Cross-ref |
|--------|----------|-------------|-----------|
| POST | `/admin/company/report_dashboard/{clientID}` | Generate health report | ✅ 04-api-surface.md |

**Note:** The full `patenTrack.js` file is 64KB+ and likely contains 100+ additional API methods. This inventory covers only the first 250 lines analyzed. Additional endpoints would include:
- Document management
- Lawyer/law firm management
- Geographic data (addresses)
- More detailed asset operations
- Bulk operations
- Export/import endpoints

---

## 6. Reusable Components

### Component Directory Structure

**Location:** `src/components/common/`

**Complete Component List:**

1. **AdminUsers/** - Admin user CRUD interface
   - List admin users with material-table
   - Add/Edit/Delete functionality
   - Role management

2. **CitedPatent/** - Cited patent and third-party management
   - Cited assignee list with pagination/sorting
   - Logo upload
   - Owned assets view

3. **CommentComponents/** - Comments system
   - Add/view/delete comments
   - Real-time updates via Pusher
   - Comment threading

4. **Companies/** - Company management
   - Company list
   - Company details
   - Portfolio management

5. **CompanyKeywords/** - Classification keyword management
   - Keyword list
   - Add/edit keywords
   - Category mappings

6. **CorporateTreeUploader/** - Corporate tree file upload
   - File upload interface
   - Validation
   - Tree structure import

7. **CustomTab/** - Custom tab component
   - Material UI tabs wrapper
   - Reusable tab navigation

8. **Documents/** - Document management
   - Document list
   - Upload/download
   - Categorization

9. **ErrorBoundary/** - Error boundary component
   - Catch React errors
   - Display fallback UI
   - Error logging

10. **FullWidthSwitcher/** - Full-width toggle component
    - Layout switching
    - View mode control

11. **Googlelogin/** - Google OAuth integration
    - Google Sign-In button
    - OAuth flow handling
    - Token exchange

12. **Header/** - Navigation header
    - Top navigation bar
    - Widget selector dropdown
    - User menu
    - Logout

13. **Keywords/** - Keyword management
    - Keyword CRUD
    - Search functionality
    - Categorization

14. **Lawyers/** - Lawyer management
    - Lawyer/law firm database
    - Contact information
    - Case associations

15. **LevelsNestedTreeGrid/** - 4-level nested tree for entity grouping
    - Corporate hierarchy visualization
    - Drag-and-drop reorganization
    - Manual/suggested groupings
    - DevExtreme Grid integration

16. **Loader/** - Loading spinner component
    - Material UI CircularProgress
    - Overlay loader
    - Inline loader

17. **NewCompanyRequest/** - New company request management
    - Request list
    - Approve/reject workflow
    - Request details

18. **PatentrackDiagram/** - D3 patent relationship diagram
    - D3.js visualization
    - Patent family trees
    - Interactive nodes
    - Zoom/pan controls

19. **PdfViewer/** - PDF document viewer
    - PDF rendering
    - Page navigation
    - Zoom controls
    - Multiple document types (document, form, agreement)

20. **RecordItemsContainer/** - Record items management
    - Error record display
    - Categorized by type (invent, assign, corr, address, security)
    - Fix/validate workflow

21. **Reports/** - Health report generation
    - Report configuration form
    - Report display
    - Export functionality

22. **SearchCompanies/** - Company search interface
    - Autocomplete search
    - Google Maps integration
    - Geographic filtering
    - Results display

23. **Tabs/** - Generic tabs component
    - Material UI tabs wrapper
    - Content switching

24. **TimeLineContainer/** - Timeline component
    - react-event-timeline integration
    - Asset history timeline
    - Event visualization

25. **TransactionsContainer/** - Transaction management
    - Transaction list
    - Assignment tracking
    - Type classification

26. **UpdatedAssets/** - Recently updated assets
    - Asset change log
    - Timeline view
    - Quick access

27. **UserSettings/** - User settings panel (default widget)
    - Profile settings
    - Preferences
    - Widget selector

28. **Users/** - Customer user management
    - User CRUD
    - Access control
    - Portfolio assignments

29. **ValidateCounter/** - Validation counters
    - Application counter
    - Patent counter
    - Encumbered assets counter
    - Data quality metrics

30. **VirtualizedTable/** - Virtualized table component
    - react-virtualized integration
    - Large dataset rendering
    - Performance optimized

### Shared Components

**AuthSlack/** - Slack authentication
- Located in `src/components/AuthSlack/`
- Slack OAuth integration
- Workspace connection

**CustomDialog/** - Custom dialog/modal
- Located in `src/components/CustomDialog/`
- Material UI Dialog wrapper
- Reusable modal component

### Visualization Libraries Used

1. **D3.js** (^5.16.0)
   - PatentrackDiagram component
   - Custom patent relationship visualizations

2. **Recharts** (^1.6.2)
   - Chart components (usage not visible in structure)

3. **React ApexCharts** (^1.3.3)
   - Chart components (usage not visible in structure)

4. **React Chart.js 2** (^2.9.0)
   - Chart components (usage not visible in structure)

**Risk:** Having 3 separate charting libraries increases bundle size and maintenance complexity.

### Grid Components

1. **DevExtreme React Grid** (@devexpress/dx-react-grid ^2.6.2)
   - Used in LevelsNestedTreeGrid
   - Advanced grid features (sorting, filtering, grouping)

2. **material-table** (^1.57.2)
   - CRUD tables
   - Inline editing
   - Export functionality

3. **react-virtualized** (^9.21.2)
   - VirtualizedTable component
   - Query results display
   - Large dataset rendering

4. **react-window** (^1.8.5)
   - Alternative virtualization (usage not visible)

**Risk:** Multiple grid/table libraries with overlapping functionality.

---

## 7. Key Observations & Risks

### 7.1 Architecture Risks

#### 🔴 **CRITICAL: Monolithic Files**

**Problem:**
- `patenTrackActions.js` - **64KB** (enormous actions file)
- `patenTrackReducer.js` - **27KB** (huge reducer)
- `patenTrack.js` API file - **64KB+** (gigantic API client)

**Impact:**
- Difficult to maintain and debug
- Poor code organization
- Merge conflict nightmare
- IDE performance issues

**Recommendation:**
- Split into domain-specific modules (entities, transactions, cited, etc.)
- Use Redux Toolkit's createSlice for better organization

#### 🔴 **CRITICAL: Outdated React Version**

**Current:** React 16.8.6 (June 2019)

**Issues:**
- Missing concurrent features
- Missing automatic batching
- Security vulnerabilities in dependencies
- No React 18 performance improvements

**Recommendation:**
- Upgrade to React 18.x
- Audit and update all dependencies
- Test thoroughly (breaking changes likely)

#### 🟡 **WARNING: Excessive UI Libraries**

**3 Charting Libraries:**
- d3 ^5.16.0
- recharts ^1.6.2
- react-apexcharts ^1.3.3
- react-chartjs-2 ^2.9.0

**4 Grid/Table Libraries:**
- @devexpress/dx-react-grid
- material-table
- react-virtualized
- react-window

**Impact:**
- Bloated bundle size
- Inconsistent UX
- Maintenance overhead

**Recommendation:**
- Standardize on single charting library (recharts recommended)
- Standardize on single virtualization library (react-window)
- Remove unused libraries

#### 🟡 **WARNING: 195 Action Types**

**Problem:**
- 195 Redux action type constants
- Massive state tree
- Complex state management

**Impact:**
- Difficult to understand data flow
- Easy to introduce bugs
- Hard to onboard new developers

**Recommendation:**
- Consider migrating to Redux Toolkit
- Implement code splitting for reducers
- Document state structure clearly

### 7.2 Security Risks

#### 🔴 **CRITICAL: Dual Token Storage**

**Current Implementation:**
```javascript
localStorage.setItem('admin_token', token);
document.cookie = `admin_token=${token}; domain=.patentrack.com`;
```

**Issues:**
- XSS vulnerability (localStorage accessible by any script)
- Cookie shared across all subdomains
- No HttpOnly flag (cookie accessible by JavaScript)
- No Secure flag visible (HTTP transmission risk)
- No SameSite attribute (CSRF risk)

**Cross-reference:** See `05-auth-model.md` for PT-API authentication model

**Recommendation:**
- Use HttpOnly cookies only (not accessible by JavaScript)
- Add Secure flag (HTTPS only)
- Add SameSite=Strict
- Remove localStorage storage
- Implement CSRF token

#### 🟡 **WARNING: 10-Minute Timeout**

**Current:** `axios.defaults.timeout = 600000` (600 seconds = 10 minutes)

**Issues:**
- Extremely long timeout
- Poor UX (users wait 10 minutes for failure)
- Resource exhaustion risk

**Recommendation:**
- Reduce to 30-60 seconds for most requests
- Use longer timeouts only for specific long-running operations
- Implement progress indicators for long operations

#### 🟡 **WARNING: No Token Refresh**

**Issue:**
- JWT expires (likely 24 hours based on 05-auth-model.md)
- No visible token refresh mechanism
- User forced to re-login after expiry

**Recommendation:**
- Implement token refresh flow
- Refresh token before expiry
- Handle refresh failures gracefully

### 7.3 Performance Risks

#### 🟡 **WARNING: Huge Initial State**

**Problem:**
- 192-line initialState.js
- Large Redux state tree loaded at startup
- All widgets/data structures initialized even if unused

**Impact:**
- Slow initial load
- Memory overhead
- Unnecessary data fetching

**Recommendation:**
- Lazy load widget data
- Implement code splitting
- Initialize state on demand

#### 🟡 **WARNING: No Code Splitting**

**Observation:**
- All components loaded upfront
- No React.lazy() or Suspense usage visible
- Large bundle size

**Recommendation:**
- Implement route-based code splitting
- Lazy load dashboard widgets
- Use React.lazy() and Suspense

#### 🟡 **WARNING: Multiple Virtualization Libraries**

**Both included:**
- react-virtualized ^9.21.2
- react-window ^1.8.5

**Impact:**
- ~40KB duplication
- react-window is the modern replacement for react-virtualized

**Recommendation:**
- Migrate all usage to react-window
- Remove react-virtualized

### 7.4 UX/UI Risks

#### 🟡 **WARNING: Widget-Based Routing**

**Current:** Dashboard uses Redux state (`currentWidget`) instead of URL routing

**Issues:**
- No deep linking
- Browser back button doesn't work
- Can't bookmark specific views
- Difficult to share admin views

**Recommendation:**
- Implement URL-based routing for widgets
- Use `/dashboard/:widget` pattern
- Update browser history on widget change

#### 🟡 **WARNING: No Offline Support**

**Observation:**
- No service worker
- No PWA capabilities
- No offline fallback

**Impact:**
- Poor experience on unreliable networks
- No caching of static assets

**Recommendation:**
- Add service worker for caching
- Implement offline page
- Cache API responses where appropriate

### 7.5 Developer Experience Risks

#### 🔴 **CRITICAL: CRA Not Ejected**

**Current:** Using react-scripts ^3.4.4 (from 2019)

**Issues:**
- Old version with known issues
- Can't customize webpack config
- Stuck with CRA limitations

**Recommendation:**
- Migrate to modern build tool (Vite recommended)
- Or eject and upgrade webpack configuration
- Remove OpenSSL legacy provider workaround

#### 🟡 **WARNING: No TypeScript**

**Observation:**
- Pure JavaScript codebase
- No type safety
- Easy to introduce type-related bugs

**Impact:**
- Runtime errors from type mismatches
- Poor IDE autocomplete
- Difficult refactoring

**Recommendation:**
- Migrate to TypeScript incrementally
- Start with new components
- Add types for Redux state/actions

#### 🟡 **WARNING: Inconsistent Styling**

**Multiple approaches:**
- Material UI's JSS
- styled-components
- Component-level styles.js files

**Impact:**
- Inconsistent code patterns
- Bundle size overhead
- Developer confusion

**Recommendation:**
- Standardize on single approach (Material UI v5 with styled() API recommended)
- Remove styled-components if not heavily used

### 7.6 Real-Time Integration

#### ✅ **Pusher.js Integration**

**Library:** pusher-js ^7.0.0

**Usage:**
- Real-time comment updates
- Likely used for notifications
- Live data synchronization

**Configuration:**
- Not visible in analyzed files
- Likely in initEnvironment() action

**Recommendation:**
- Document Pusher configuration
- Handle connection failures gracefully
- Implement reconnection logic

### 7.7 External Integrations

#### Google Services

**Libraries:**
- react-google-login ^5.2.2 - OAuth
- react-google-maps ^9.4.5 - Maps

**Components:**
- Googlelogin/ - OAuth integration
- SearchCompanies/ - Maps for location

**Risks:**
- Old react-google-login (deprecated, use @react-oauth/google)
- Old react-google-maps (deprecated, use @react-google-maps/api)

**Recommendation:**
- Update to modern Google libraries
- Test OAuth flow after migration

#### Slack Integration

**Component:** AuthSlack/

**Usage:**
- Slack workspace connection
- Admin notifications likely

### 7.8 Data Quality

#### Entity Normalization Complexity

**Features:**
- Manual grouping via drag-and-drop
- AI-suggested groupings
- Static file import
- 4-level corporate tree

**Risk:**
- Complex workflow
- Easy to make mistakes
- No visible undo mechanism

**Recommendation:**
- Add undo/redo functionality
- Implement audit trail
- Add confirmation dialogs for bulk operations

### 7.9 Testing

#### 🔴 **CRITICAL: No Visible Test Infrastructure**

**Observation:**
- No test files in structure
- Test script exists but likely unused
- No coverage reports

**Impact:**
- High regression risk
- Difficult to refactor safely
- Quality assurance issues

**Recommendation:**
- Add Jest + React Testing Library
- Write tests for critical workflows
- Implement CI/CD with test gates

### 7.10 Documentation

#### 🟡 **WARNING: Limited Documentation**

**Available:**
- README.md (likely minimal)
- Prettier config

**Missing:**
- Architecture documentation
- API documentation
- Component documentation
- Workflow documentation
- Deployment guide

**Recommendation:**
- Document all admin workflows
- Create component library documentation
- Document API integration patterns
- Add deployment runbook

### 7.11 Comparison with PT-App (06a-frontend-pt-app.md)

#### Similarities

1. **Build Tool:** Both use Create React App
2. **State Management:** Both use Redux + Thunk + Logger
3. **Routing:** Both use React Router v5
4. **UI Library:** Both use Material UI v4
5. **HTTP Client:** Both use axios
6. **Real-Time:** Both use Pusher.js (PT-App) or similar WebSocket
7. **Charting:** Both include multiple charting libraries (risk in both)

#### Differences

| Aspect | PT-Admin | PT-App |
|--------|----------|--------|
| **React Version** | 16.8.6 (older) | 17.0.2 (newer) |
| **CRA Version** | 3.4.4 (old) | 4.0.3 (newer) |
| **Target Users** | Internal admins | External customers |
| **Complexity** | Higher (195 action types) | Lower (fewer actions) |
| **Grid Library** | DevExtreme + material-table + 2 virtualizers | Custom implementations |
| **Main Focus** | Data quality & normalization | Dashboard & analytics |
| **Auth Token** | admin_token | Regular user token |
| **API Base** | /admin/* endpoints | Customer endpoints |

#### Shared Risks

Both applications suffer from:
- Multiple charting libraries
- Old dependency versions
- No TypeScript
- No visible testing
- Large monolithic files
- No code splitting

**Recommendation:** Consider shared component library or monorepo architecture for common code.

### 7.12 Deployment Concerns

#### Configuration

**Files:**
- `src/config/config.js` - API URLs pointing to betapp1.patentrack.com
- `.env` file (not analyzed)

**Risks:**
- Hardcoded URLs in config
- Environment-specific configuration unclear
- No visible environment detection

**Recommendation:**
- Use environment variables for all config
- Implement proper environment detection
- Document all required environment variables

### Summary of Risk Levels

| Category | Risk Level | Count |
|----------|-----------|-------|
| 🔴 Critical | High | 5 |
| 🟡 Warning | Medium | 13 |
| ✅ Acceptable | Low | 1 |

**Critical Issues to Address First:**
1. Monolithic file splitting (patenTrackActions.js 64KB)
2. React version upgrade (16.8.6 → 18.x)
3. Security: Token storage (localStorage + cookie)
4. Testing infrastructure (none visible)
5. CRA modernization (3.4.4 → Vite)

---

## Appendix: File Size Analysis

| File | Size | Lines | Complexity |
|------|------|-------|------------|
| patenTrackActions.js | 64KB | ~2000+ | Very High |
| patenTrackReducer.js | 27KB | ~800+ | High |
| patenTrack.js (API) | 64KB+ | ~2000+ | Very High |
| actionTypes.js | ~8KB | 195 constants | Medium |
| initialState.js | ~8KB | 192 lines | Medium |

**Total Redux Code:** ~171KB for state management alone (excluding React components)

---

**Document Version:** 1.0  
**Last Updated:** February 2026  
**Analyzed By:** GitHub Copilot  
**Cross-References:**
- `docs/analysis/04-api-surface.md` - API endpoint documentation
- `docs/analysis/05-auth-model.md` - Authentication model
- `docs/analysis/06a-frontend-pt-app.md` - Customer dashboard analysis
