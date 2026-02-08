# PT-Share (Public Share Viewer) Analysis

> **Repository:** [Synpathub/PT-Share](https://github.com/Synpathub/PT-Share)
> **Language Composition:** JavaScript 92.2%, CSS 6.9%, Other 0.9%
> **Default Branch:** `master`
> **Analysis Date:** 2026-02-08

## 1. Application Structure

### 1.1 Build Tooling

- **Create React App (CRA)** v4.0.3 via `react-scripts`
- Standard CRA scripts: `start`, `build`, `test`, `eject`
- Package manager: **Yarn** (yarn.lock present, no package-lock.json)
- No custom Webpack config, no eject

### 1.2 State Management

- **None** — all state is managed with React `useState` hooks in `App.js`
- No Redux, no Context API, no MobX
- The monolithic `App` component holds ~20 `useState` variables and passes them as props to children
- State includes: `data`, `pdfView`, `pdfFile`, `pdfTab`, `arrow`, `showThirdParties`, `usptoMode`, `connectionMode`, `companyLogo`, `connectionData`, `code`, `linkId`, `asset`, `isDrag`, `toggleButtonType`, `companyButtonVisible`, etc.

### 1.3 Routing

- **react-router-dom** v5.2.0
- `BrowserRouter` wraps the single `<App />` component in `src/index.js`
- **No `<Route>` definitions** — the app does not use declarative routes
- Instead, the URL path is extracted manually:
  - `App.js`: `document.location.href.toString().split('/').pop()` extracts the share code from the URL
  - `Assets/index.js`: `useLocation()` hook reads `location.pathname` to get the share code
- Effectively a single-page app with a single view

### 1.4 UI Component Library

- **Material-UI (MUI) v4** — `@material-ui/core` v4.11.4, `@material-ui/icons` v4.11.2, `@material-ui/lab` v4.0.0-alpha.58
- Components used: `AppBar`, `Toolbar`, `Grid`, `Table`, `Tabs`, `Tab`, `Button`, `IconButton`, `Fab`, `Paper`, `Typography`, `Avatar`, `Modal`, `TextField`, `CircularProgress`, `Checkbox`, `Radio`, `Select`, `MenuItem`, `Tooltip`, `Drawer`
- **Font Awesome** icons via `@fortawesome/react-fontawesome` v0.1.14
- **react-icons** v4.2.0 (listed as dependency but usage not confirmed in examined code)

### 1.5 Key Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| react | ^17.0.2 | UI framework |
| react-dom | ^17.0.2 | DOM rendering |
| react-router-dom | ^5.2.0 | URL routing (minimal use) |
| d3 | 5.16.0 | SVG patent ownership diagram rendering |
| react-split-pane | ^0.1.92 | Resizable split panels (illustration / PDF / connection) |
| react-virtualized | ^9.22.3 | Virtualized asset list table |
| react-quill / quill | ^1.3.5 / ^1.3.7 | Rich-text comment editor |
| react-event-timeline | ^1.6.3 | Comment timeline display |
| react-google-login | ^5.2.2 | Google OAuth (for comments/Drive integration) |
| react-draggable | ^4.4.3 | Draggable UI elements |
| moment | ^2.29.1 | Date formatting |
| @material-ui/core | ^4.11.4 | UI component library |
| lodash (orderBy, sortBy) | — | Array sorting in VirtualizedTable |
| clsx | — | Conditional classnames |
| prop-types | — | Prop validation |

### 1.6 CSS Approach

- **CSS-in-JS via MUI `makeStyles`** — each component has a co-located `styles.js` file using `makeStyles(theme => ({...}))`
- **Global CSS** — `src/App.css` and `src/index.css` for layout, split-pane styling, dark theme overrides
- **Component-scoped CSS** — `src/components/QuillEditor/styles.css` and `src/components/PatentrackDiagram/css/styles.css`
- Dark theme: `background-color: #121212`, white text, MUI paper overridden to `#424242`
- `min-width: 800px` on `<body>` — **not mobile responsive**

---

## 2. URL Structure & Access Pattern

### 2.1 Share URL Format

The app serves two distinct access patterns based on URL structure:

**Pattern 1 — Illustration Share (primary):**
```
https://<share-domain>/<shareCode>
```
- The last segment of `document.location.href` is extracted as the share code
- `App.js`: `href = href.toString().split('/').pop()`
- This code is used to call `GET /share/illustrate/show/{shareCode}`

**Pattern 2 — Asset List Share:**
```
https://<share-domain>/<orgCode>/<otherSegments>
```
- `Assets/index.js` reads `location.pathname` (the full path after domain)
- Calls `GET /share{pathname}` — e.g. `GET /share/orgCode/type`

**Pattern 3 — Individual Asset Diagram:**
- When a user clicks an asset from the list, the app calls:
  `GET /share/illustration/{assetNumber}/{shareCode}`

### 2.2 API Endpoints Called

All API calls go to the hardcoded base URL: **`https://betapp.patentrack.com/`**
(with a commented-out localhost alternative: `http://localhost:3600/`)

| Endpoint Called (from PT-Share) | Matched Backend Endpoint (04-api-surface.md) | Auth | Purpose |
|-------------------------------|----------------------------------------------|------|---------|
| `GET /share/illustrate/show/{code}` | `GET /share/illustrate/show/:code` (#7) | None | Load initial illustration data + company logo |
| `GET /share{pathname}` | `GET /share/:code/:type` (#3) | None | Load asset list for a shared org |
| `GET /share/illustration/{asset}/{code}` | `GET /share/illustration/:asset/:code` (#2) | None | Load diagram data for a specific asset |
| `GET /connection/{popuptop}` | _(connections group)_ | None | Load assignment connection popup details |
| `GET /assets/{asset}/1/outsource` | _(assets group)_ | None | Load USPTO TSDR iframe URL |

### 2.3 Authentication

- **No authentication required for the core share viewing flow.** All `/share/*` endpoints are marked as having no auth (`-`) in `04-api-surface.md`.
- The codebase contains **dead authentication code** copied from PT-App:
  - `src/utils/tokenStorage.js` — Slack/Google token management via `localStorage`
  - `src/components/Googlelogin/` — Google OAuth login component
  - `src/components/AssetsCommentTimeline/` — references Slack auth, Google Drive integration
  - `.env` file contains `REACT_APP_SLACK_CLIENTID`, `REACT_APP_GOOGLE_CLIENTID`, `REACT_APP_GOOGLE_SCOPE`
- These features are non-functional in the share context (comment submission handlers are empty `useCallback(async () => {}, [])`)

### 2.4 Error Handling

- **Minimal.** API errors throw generic `throw new Error('Something went wrong on api server!')` but these are **not caught** — no try/catch wrapping the fetch calls
- No user-facing error UI (no error boundaries, no "link expired" message, no "not found" page)
- No loading spinner for the initial illustration load (Assets list does show `CircularProgress` while loading)
- Invalid/expired share codes will silently fail — `data` state remains `null`, rendering nothing

---

## 3. Data Displayed

### 3.1 Patent Data Shown

The app displays:
1. **Asset List** — list of patents/assets associated with the shared organization
2. **Patent Ownership Diagram** — the core PatenTrack SVG illustration showing:
   - Inventors (segment 0)
   - Owners (segment 1)
   - Banks/security interests (segment 2)
   - Third parties (segment 3)
   - Assignment connections between entities (colored lines with categories: Ownership, Security, Release, License, LicenseEnd, NameChange, Correct)
   - Timeline with dates along the left axis
3. **Assignment Connection Details** — popup table showing conveyance text, assignor names, assignee names, execution date, recorded date, correspondence address, mail date, pages, days between execution and recording
4. **PDF Documents** — three tabs: Agreement, Form, Document (loaded in iframes)
5. **USPTO Data** — TSDR outsource iframe
6. **Company Logo** — displayed in header from `general.logo_1`
7. **Comments** — comment timeline UI present but functionality gutted

### 3.2 Data Format

The main illustration data (from `GET /share/illustrate/show/{code}`) includes:
```javascript
{
  general: {
    logo_1: "url_to_company_logo",
    // patent metadata
  },
  box: [
    {
      id: Number,
      patent_number: String,
      segment: Number,      // 0=inventor, 1=owner, 2=bank, 3=thirdParty
      name: String,
      date_1: String,       // ISO date
      flag: String,         // country flag code
      assignment_no: Number,
    }
  ],
  connection: [
    {
      id: Number,
      start_id: { type: String, i: Number },
      end_id: { type: String, i: Number },
      assignment_no: Number,
      category: String,     // "Ownership", "Security", etc.
      color: String,
      popup: Number,        // index into popup data
      line: Object,
    }
  ],
  comment: Object           // comment data (not functional)
}
```

The asset list response (from `GET /share{pathname}`):
```javascript
{
  list: Array,    // array of asset objects
  logo: String    // company logo URL
}
```

### 3.3 Visualizations

**Patent Ownership Diagram (PatentrackDiagram):**
- Custom D3.js v5.16.0-based SVG visualization (~1,700+ lines in `index.js`)
- Class-based React component (not hooks)
- Renders an SVG with:
  - `PatentTimeline` — vertical dashed timeline with horizontal date markers (D3-drawn)
  - `PatentNode` — rectangular boxes for each entity (inventors, owners, banks, third parties)
  - `PatentLink` — curved/straight connection lines between nodes showing assignment relationships
- Interactive playback controls: fast-backward, step-backward, step-forward, fast-forward through assignments
- Filter toggles for assignment categories (Ownership, Security, Release, License, etc.)
- Color-coded by assignment type (configured in `config.json`)
- Responsive SVG via `viewBox` with `preserveAspectRatio: "xMidYMid meet"`
- Copyright notice rendered at bottom of SVG

### 3.4 Snapshot vs. Live Data

- **Live data** — the app fetches from the API on every page load. There is no snapshot/frozen mechanism.
- If the backend data changes, the share link will show updated data.
- Share links appear to be permanent (no expiration logic visible in the frontend).

---

## 4. User Interactions

The viewer can:
1. **View the asset list** — scrollable virtualized table of patent assets
2. **Click an asset** to load its patent ownership diagram
3. **Click assignment lines** in the diagram to view connection details (assignors, assignees, conveyance text, dates, document PDFs)
4. **View PDF documents** — three-tab viewer (Agreement, Form, Document) in iframe; tabs are switchable
5. **Toggle third-party visibility** — show/hide third-party entities in the diagram
6. **Step through assignments** — playback controls to progressively reveal assignment history
7. **Filter assignment types** — checkboxes for Ownership, Security, Release, License, etc.
8. **Open USPTO TSDR** — iframe-embedded USPTO data
9. **Resize panels** — draggable split pane dividers between assets list, diagram, PDF viewer, and connection box
10. **Schedule a demo** — "Schedule a Demo" button opens HubSpot meeting embed
11. **Share illustration** — `handleShare` function can open a new share URL in a new tab

The viewer **cannot**:
- Download data or export
- Edit or add comments (handlers are empty stubs)
- Search or filter the asset list
- Authenticate or log in (auth code is dead)

---

## 5. Components Inventory

| # | Component | Path | Purpose | Key Behavior |
|---|-----------|------|---------|-------------|
| 1 | **App** | `src/App.js` (13.3KB) | Root component, all state management | Monolithic; holds ~20 state variables; hardcoded API URL; manages all panel layout via SplitPane; extracts share code from URL; orchestrates all data fetching |
| 2 | **Assets** | `src/components/Assets/index.js` | Asset list sidebar | Uses `useLocation()` to read share code from pathname; fetches asset list from API; renders VirtualizedTable; handles asset selection |
| 3 | **PatentrackDiagram** | `src/components/PatentrackDiagram/index.js` (~1,700+ lines) | Patent ownership SVG illustration | Class component using D3.js; renders SVG with nodes, links, timeline; assignment playback controls; filter toggles; the most complex component |
| 4 | — PatentNode | `src/components/PatentrackDiagram/PatentNode.js` | Individual entity box in diagram | Renders SVG rect + text for inventors/owners/banks/third parties |
| 5 | — PatentLink | `src/components/PatentrackDiagram/PatentLink.js` | Connection line in diagram | Renders SVG path between nodes; curved/straight; color-coded by category; clickable for popup |
| 6 | — PatentTimeline | `src/components/PatentrackDiagram/PatentTimeline.js` | Date timeline axis | D3-drawn vertical timeline with horizontal date markers |
| 7 | — PatentTopTitle | `src/components/PatentrackDiagram/PatentTopTitle.js` | Title bar + controls above diagram | Patent title, playback controls, filter checkboxes, assignment counter, share/comment/USPTO buttons |
| 8 | **PdfViewer** | `src/components/PdfViewer/index.js` (4.7KB) | Three-tab PDF iframe viewer | Tabs: Agreement, Form, Document; loads PDFs in iframes with `#zoom=FitH`; close and fullscreen buttons |
| 9 | **ConnectionBox** | `src/components/ConnectionBox/index.js` (7.9KB) | Assignment detail popup | Fetches from `GET /connection/{id}`; displays conveyance text, assignors, assignees, dates, correspondence address in MUI Table |
| 10 | **NewHeader** | `src/components/NewHeader/index.js` (3.2KB) | Top navigation bar | PatenTrack logo, company logo, copyright text, "Schedule a Demo" button (HubSpot embed) |
| 11 | **USPTOContainer** | `src/components/USPTOContainer/index.js` | USPTO TSDR iframe | Fetches outsource URL from `GET /assets/{asset}/1/outsource`; renders iframe |
| 12 | **AssetsCommentsTimeline** | `src/components/AssetsCommentTimeline/index.js` (20.3KB) | Comment timeline panel | **Effectively non-functional**: submit handlers are empty; references Slack/Google auth; uses QuillEditor and Googlelogin |
| 13 | **QuillEditor** | `src/components/QuillEditor/index.js` (6.5KB) | Rich text editor for comments | ReactQuill-based; includes CustomToolbar with mentions, attachments, USPTO buttons; **non-functional in share context** |
| 14 | — CustomToolbar | `src/components/QuillEditor/CustomToolbar.js` (8KB) | Editor toolbar | Buttons for: mention, attach, bold, italic, send, drive, USPTO, share, address/name corrections |
| 15 | — AtButton | `src/components/QuillEditor/AtButton.js` | Mention button icon | Simple icon wrapper |
| 16 | — AttachButton | `src/components/QuillEditor/AttachButton.js` | Attachment button icon | Simple icon wrapper |
| 17 | — AutoCompleteSearch | `src/components/QuillEditor/AutoCompleteSearch.js` | Autocomplete dropdown | MUI Autocomplete for user search |
| 18 | **Googlelogin** | `src/components/Googlelogin/` | Google OAuth component | **Dead code** — used by AssetsCommentsTimeline; not functional in share context |
| 19 | **NavigationIcon** | `src/components/NavigationIcon/` | Navigation icon component | Panel navigation toggle |
| 20 | **ArrowButton** | `src/components/ArrowButton/index.js` (1.5KB) | Directional toggle button | MUI Fab with arrow icons; used for panel collapse/expand |
| 21 | **VirtualizedTable** | `src/components/VirtualizedTable/index.js` (21KB) | Virtualized data table | react-virtualized Table with sorting, selection, collapsable rows, column resize; used by Assets for the asset list |

### Utility Files

| File | Purpose |
|------|---------|
| `src/utils/tokenStorage.js` | localStorage helpers for Slack/Google tokens; `loginRedirect()` |
| `src/utils/html_encode_decode.js` | HTML entity encode/decode; `downloadFile()` for XML download |
| `src/utils/numbers.js` | `numberWithCommas()`, `capitalize()`, `addCommas()`, `applicationFormat()`, `capitalizeEachWord()` |

### Misplaced Files

| File | Purpose | Issue |
|------|---------|-------|
| `src/name_to_domain_api.js` | Server-side Node.js script for fetching company logos from Clearbit/UpLead/RiteKit APIs | **DOES NOT BELONG** — uses `require()`, `process.argv`, Sequelize DB connections, Pusher. Contains hardcoded API keys. |

---

## 6. Comparison with PT-App

### 6.1 Shared/Copied Code

Nearly every component in PT-Share appears to be **directly copied from PT-App** with minimal modification:

| Component | Evidence of Copy |
|-----------|-----------------|
| **PatentrackDiagram** | Identical D3 diagram engine; same config.json; same sub-components |
| **VirtualizedTable** | Full-featured table with collapsable rows, column resize — far more than needed for read-only share |
| **AssetsCommentsTimeline** | 20KB component with Slack/Google Drive integration — all non-functional |
| **QuillEditor** | Full editor with custom toolbar for mentions, attachments, USPTO — entirely dead code |
| **Googlelogin** | OAuth component — has no purpose in unauthenticated share viewer |
| **ConnectionBox** | Appears functional; likely copied with minimal changes |
| **PdfViewer** | Functional; similar to PT-App version |
| **NewHeader** | Simplified — removed most navigation, kept logo + "Schedule a Demo" |
| **ArrowButton** | Identical to PT-App version |
| **tokenStorage.js** | Full Slack/Google token management — dead code in share context |
| **numbers.js** | Utility functions — identical to PT-App |

### 6.2 Feature Delta

**PT-Share has** (that PT-App doesn't need separately):
- Unauthenticated share URL access pattern
- "Schedule a Demo" CTA button (HubSpot integration)

**PT-Share is missing** (vs PT-App):
- Authentication (login/logout)
- Redux state management
- Multiple pages/routes
- Company/customer selection
- Asset CRUD operations
- Full comment/Slack/Teams integration (code present but non-functional)
- Dashboard views, charts, Sankey diagrams, geo charts
- Settings/administration
- Search functionality

### 6.3 Dependency Differences

| Feature | PT-App | PT-Share |
|---------|--------|----------|
| State management | Redux + redux-thunk | useState only |
| Routing | react-router-dom (multiple routes) | react-router-dom (no routes defined) |
| HTTP client | Axios (via PatenTrackApi) | Raw `fetch()` API |
| Charts | Chart.js, react-google-charts, vis-timeline | None (only D3 diagram) |
| Sankey | d3-sankey | Not included |
| Gauge | react-gauge-chart | Not included |
| Word cloud | react-wordcloud, chartjs-chart-wordcloud | Not included |
| D3 version | 5.16.0 | 5.16.0 (identical) |
| MUI version | v4 | v4 (identical) |

---

## 7. Performance & Responsiveness

### 7.1 Initial Load

- **Data volume:** Depends on the shared company. The illustration data for a single patent can be substantial (box + connection arrays). The entire company's asset list is also loaded.
- **No lazy loading** — all components are bundled together via CRA
- **No code splitting** — React.lazy/Suspense not used
- The `PatentrackDiagram` component is ~1,700+ lines and includes the full D3 rendering engine

### 7.2 Mobile Responsiveness

- **Not mobile responsive.** Explicit `min-width: 800px` on `<body>` with `overflow: hidden`
- Layout uses absolute positioning, split panes, and fixed dimensions
- The `<meta name="viewport" content="width=device-width, initial-scale=1">` tag is present but the layout doesn't accommodate mobile widths

### 7.3 SEO / Open Graph

- **No Open Graph meta tags** — no `og:title`, `og:description`, `og:image`
- **No Twitter Card tags**
- Title is static: `<title>PatenTrack Share Illustration</title>`
- Being a client-rendered React SPA, search engines cannot index the dynamic content
- **Missed opportunity** — share links would benefit from social media preview cards showing the patent/company name

---

## 8. Security Concerns

### CRITICAL: Hardcoded API Keys in Committed Code

**File: `src/name_to_domain_api.js`** (a misplaced server-side script) contains:
- Clearbit API Key: `sk_d89c...` (production key)
- RiteKit Client ID: `9e44da...` (production key)
- UpLead Client ID: `977c4d...` (production key)
- Pusher App ID, Key, and Secret (production credentials)

**All of these keys should be considered compromised and rotated immediately.**

### CRITICAL: `.env` File Committed to Repository

**File: `.env`** (in repo root, tracked by git) contains:
- `REACT_APP_SLACK_CLIENTID` — Slack OAuth client ID
- `REACT_APP_GOOGLE_CLIENTID` — Google OAuth client ID
- `REACT_APP_GOOGLE_SCOPE` — Full Google Drive access scopes
- `REACT_APP_SLACK_REDIRECT_URL` — Points to `localhost:3002`
- `REACT_APP_SLACK_USER_SCOPE` — Extensive Slack permissions

While `REACT_APP_*` variables are inherently public in CRA builds, the `.env` file should not be committed.

### HIGH: Server-Side Script in Client Repository

`src/name_to_domain_api.js` is a **Node.js server-side script** that:
- Uses `require()` (not ES modules)
- Accesses `process.argv` for command-line arguments
- Connects to a database via Sequelize
- References `./config/index` and `./models/` that don't exist in this repo
- Makes server-to-server API calls (Clearbit, UpLead, RiteKit)
- Uses Pusher for push notifications

This file does not belong in a client-side React application repository.

### MEDIUM: Hardcoded API Base URL

The production API URL `https://betapp.patentrack.com/` is hardcoded directly in `App.js` (not read from environment variables). The commented-out `localhost:3600` alternative suggests this was toggled manually during development.

---

## 9. Key Observations & Risks

### Architecture Assessment

1. **PT-Share is a copy-paste fork of PT-App**, stripped down to the share viewing flow. Rather than extracting a clean share viewer, the developers copied the full application and removed/disabled features by emptying handler functions.

2. **~40% of the code is dead weight.** The full comment system (AssetsCommentsTimeline at 20KB, QuillEditor at 6.5KB, CustomToolbar at 8KB), Google OAuth, Slack integration, and token management are all present but non-functional.

3. **Monolithic App.js** — all state and logic lives in a single 13KB component with ~20 useState variables, making it difficult to maintain or test.

4. **No state management library** — while acceptable for a small app, the prop-drilling across many components creates coupling.

### Rebuild Recommendations

1. **Keep only what's functional:** PatentrackDiagram, Assets, PdfViewer, ConnectionBox, USPTOContainer, NewHeader, ArrowButton, VirtualizedTable
2. **Delete dead code:** AssetsCommentsTimeline, QuillEditor (entire directory), Googlelogin, tokenStorage.js
3. **Delete `src/name_to_domain_api.js`** — server-side script that should never have been here
4. **Remove `.env` from version control** and add to `.gitignore`
5. **Rotate all exposed API keys immediately**
6. **Move API base URL to environment variable**
7. **Add error handling** — loading states, error boundaries, "link not found" page
8. **Add Open Graph meta tags** — dynamic meta for social sharing of patent illustrations
9. **Consider SSR/SSG** for the share viewer to improve SEO and social preview cards

### Risk Summary

| Risk | Severity | Description |
|------|----------|-------------|
| Hardcoded API keys in `name_to_domain_api.js` | CRITICAL | Clearbit, RiteKit, UpLead, Pusher keys exposed in public repo |
| `.env` committed with OAuth client IDs | CRITICAL | Slack and Google OAuth credentials in version control |
| Server-side script in client repo | HIGH | `name_to_domain_api.js` contains DB connection strings and server logic |
| No error handling for invalid share links | MEDIUM | Users see blank page for expired/invalid links |
| ~40% dead code from PT-App copy | MEDIUM | Increases bundle size and maintenance burden |
| Not mobile responsive | MEDIUM | Share links unusable on mobile devices |
| No SEO/Open Graph tags | MEDIUM | Shared links show generic CRA metadata on social platforms |
| Hardcoded production API URL | MEDIUM | No environment-based configuration; manual toggle for dev |
| Monolithic component architecture | LOW | Manageable given app simplicity, but should be improved in rebuild |