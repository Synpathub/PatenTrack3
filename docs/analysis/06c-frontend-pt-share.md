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
https://
