# PatenTrack3 Frontend Architecture

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Complete

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Application Structure & Routing](#2-application-structure--routing)
3. [Component Architecture](#3-component-architecture)
4. [D3 Ownership Diagram — Hero Feature](#4-d3-ownership-diagram--hero-feature)
5. [State Management](#5-state-management)
6. [Authentication & Authorization in the Frontend](#6-authentication--authorization-in-the-frontend)
7. [Design System & UI Library](#7-design-system--ui-library)
8. [Performance & Optimization](#8-performance--optimization)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Architecture Overview

### 1.1 Design Goals

The legacy system has three separate React applications (PT-App, PT-Admin, PT-Share) with duplicated code, inconsistent UX, EOL frameworks (React 16/17), and zero test coverage. The new frontend consolidates everything into a single Next.js 15+ application with:

- **One app, role-based views** — replaces 3 separate React apps
- **Server Components by default** — reduce client bundle, improve initial load
- **Shared component library** — no more copy-paste forks (PT-Share was 40% dead code cloned from PT-App)
- **Mobile responsive** — fixing the legacy 800px min-width restriction on share pages
- **Type-safe end-to-end** — Zod schemas shared with API via `packages/shared`
- **Accessible** — WCAG 2.1 AA compliance

### 1.2 Technology Stack

| Technology | Purpose | Replaces |
|-----------|---------|----------|
| Next.js 15+ (App Router) | Framework | React 17 (CRA), React 16 (CRA) |
| React 19+ | UI library | React 17.0.2, React 16.8.6 |
| TypeScript | Language | JavaScript (no types anywhere) |
| Tailwind CSS 4 | Styling | MUI v4/v5, styled-components, JSS, makeStyles (3+ approaches) |
| Shadcn/ui | Component primitives | MUI v4/v5 (2 different versions) |
| D3.js 7 | Ownership diagram | D3 5.16.0 |
| TanStack Query v5 | Server state management | Redux + Thunk, raw Axios calls |
| Zustand | Client state (minimal) | Redux (195 action types in PT-Admin alone) |
| TanStack Table v8 | Data tables | 4 different grid/table libraries in PT-Admin |
| Vitest | Unit/component tests | No tests (0% coverage) |
| Playwright | E2E tests | No tests |

### 1.3 Monorepo Packages

The frontend lives in `apps/web/` and consumes shared packages:

```
apps/web/                    # Next.js application
├── app/                     # App Router pages
├── components/              # App-specific components
├── hooks/                   # App-specific hooks
├── lib/                     # App utilities
└── public/                  # Static assets

packages/ui/                 # Shared React component library
├── components/              # Reusable UI components
│   ├── diagram/             # D3 ownership diagram
│   ├── tables/              # Data table components
│   ├── charts/              # Visualization components
│   └── common/              # Buttons, modals, forms, etc.
├── hooks/                   # Shared hooks
└── styles/                  # Tailwind config, design tokens

packages/shared/             # Shared types and schemas
├── schemas/                 # Zod schemas (API contracts)
├── types/                   # TypeScript type definitions
├── constants/               # Enums, color maps, config
└── utils/                   # Shared utility functions
```

### 1.4 Legacy Application Mapping

| Legacy App | New Location | Access |
|-----------|-------------|--------|
| PT-App (Customer Dashboard) | `/dashboard/*` | 🔑 Authenticated (any role) |
| PT-Admin (Admin Panel) | `/admin/*` | ⚡ Super Admin only |
| PT-Share (Public Viewer) | `/shared/:code/*` | 🔓 Public (no auth) |

---

## 2. Application Structure & Routing

### 2.1 Route Map

Next.js App Router structure using file-based routing:

```
app/
├── (auth)/                          # Auth layout group (no sidebar)
│   ├── login/page.tsx               # POST /auth/login
│   ├── register/page.tsx            # POST /auth/register
│   ├── verify-email/page.tsx        # POST /auth/verify-email
│   ├── forgot-password/page.tsx     # POST /auth/forgot-password
│   ├── reset-password/page.tsx      # POST /auth/reset-password
│   └── layout.tsx                   # Centered card layout
│
├── (dashboard)/                     # Dashboard layout group (sidebar + header)
│   ├── layout.tsx                   # Sidebar nav, header, org context
│   ├── page.tsx                     # Dashboard summary (GET /dashboards/summary)
│   ├── assets/
│   │   ├── page.tsx                 # Asset list (GET /assets)
│   │   └── [id]/
│   │       ├── page.tsx             # Asset detail (GET /assets/:id)
│   │       ├── assignments/page.tsx # Assignment history
│   │       ├── family/page.tsx      # Patent family
│   │       ├── diagram/page.tsx     # Ownership diagram (HERO)
│   │       └── maintenance/page.tsx # Maintenance fees
│   ├── trees/
│   │   ├── page.tsx                 # Ownership trees list (GET /dashboards/trees)
│   │   └── [treeId]/page.tsx        # Tree detail
│   ├── broken-titles/page.tsx       # Broken title chains
│   ├── timeline/page.tsx            # Transaction timeline
│   ├── events/
│   │   ├── page.tsx                 # Event feed
│   │   ├── maintenance/page.tsx     # Maintenance events
│   │   └── assignments/page.tsx     # Recent assignments
│   ├── entities/
│   │   ├── page.tsx                 # Entity list
│   │   └── [entityId]/page.tsx      # Entity detail
│   ├── companies/page.tsx           # Company portfolio
│   ├── settings/
│   │   ├── page.tsx                 # Org settings
│   │   ├── users/page.tsx           # User management
│   │   ├── integrations/page.tsx    # Slack, Teams, Google Drive
│   │   ├── shares/page.tsx          # Share link management
│   │   └── security/page.tsx        # MFA, password change
│   └── search/page.tsx              # Global search
│
├── (admin)/                         # Admin layout group (admin sidebar)
│   ├── layout.tsx                   # Admin layout, super-admin guard
│   ├── admin/
│   │   ├── page.tsx                 # Admin dashboard (all orgs)
│   │   ├── organizations/
│   │   │   ├── page.tsx             # Org list (GET /admin/organizations)
│   │   │   ├── new/page.tsx         # Create org
│   │   │   └── [orgId]/page.tsx     # Org admin detail
│   │   ├── transactions/page.tsx    # Transaction review
│   │   ├── ingestion/
│   │   │   ├── page.tsx             # Ingestion status dashboard
│   │   │   └── jobs/page.tsx        # Job queue browser
│   │   └── fix-items/page.tsx       # Data quality tools
│
├── shared/                          # Public share viewer (NO auth)
│   └── [code]/
│       ├── page.tsx                 # Share landing (GET /shared/:code)
│       ├── assets/page.tsx          # Shared asset list
│       └── assets/[assetId]/
│           └── diagram/page.tsx     # Shared diagram (HERO public)
│
├── api/                             # Next.js API routes (BFF)
│   └── v1/                          # Proxied to API or handled directly
│       └── [...path]/route.ts       # Catch-all proxy to Fastify API
│
├── layout.tsx                       # Root layout (html, body, providers)
├── not-found.tsx                    # 404 page
└── error.tsx                        # Error boundary
```

### 2.2 Layout Groups

| Layout Group | Components | Auth Guard | Purpose |
|-------------|-----------|-----------|---------|
| `(auth)` | Centered card, logo | None (public) | Login, register, password flows |
| `(dashboard)` | Sidebar, header, breadcrumbs, org context | `🔑 Authenticated` middleware | Customer dashboard (replaces PT-App) |
| `(admin)` | Admin sidebar, system-wide nav | `⚡ Super Admin` middleware | Admin panel (replaces PT-Admin) |
| `shared/` | Minimal header, org branding, no sidebar | None (public) | Share viewer (replaces PT-Share) |

### 2.3 Middleware

```typescript
// middleware.ts — runs on every request at the edge
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth required
  if (
    pathname.startsWith('/shared/') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email')
  ) {
    return NextResponse.next();
  }

  // All other routes require authentication
  const token = request.cookies.get('access_token')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const user = verifyAccessToken(token);
  if (!user) {
    // Token expired — let client-side refresh handle it
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Admin routes require super_admin role
  if (pathname.startsWith('/admin') && user.role !== 'super_admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Set RLS context header for API routes
  const response = NextResponse.next();
  response.headers.set('x-org-id', user.organizationId);
  response.headers.set('x-user-id', user.id);
  response.headers.set('x-user-role', user.role);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
```

### 2.4 Legacy Route Migration

| Legacy | New | Notes |
|--------|-----|-------|
| PT-App `/` (root) | `/` (dashboard summary) | Same function, new layout |
| PT-App widget-based navigation | URL-based routing | Deep linking now works |
| PT-Admin widget routing via Redux (`currentWidget`) | `/admin/*` routes | Back button now works (fixing BR-062) |
| PT-Share `/:code` (last path segment) | `/shared/:code` | Explicit prefix, mobile responsive |

---

## 3. Component Architecture

### 3.1 Component Hierarchy

```
Root Layout
├── Providers (TanStack Query, Zustand, Theme)
│
├── (auth) Layout
│   └── AuthCard → Form components
│
├── (dashboard) Layout
│   ├── Sidebar (nav items by role)
│   ├── Header (org selector, user menu, notifications)
│   ├── Breadcrumbs (auto-generated from route)
│   └── Page Content
│       ├── DashboardSummary → MetricCards, ActivityChart
│       ├── AssetList → DataTable, SearchBar, Filters
│       ├── AssetDetail → Tabs (Biblio, Assignments, Family, CPC, Diagram)
│       ├── OwnershipDiagram → D3DiagramCanvas, ControlPanel, Legend
│       ├── TreesList → DataTable, TabFilter
│       ├── Timeline → TimelineList, DateFilter
│       ├── EntityList → DataTable, SearchBar
│       └── Settings → SettingsTabs (General, Users, Integrations, Shares)
│
├── (admin) Layout
│   ├── AdminSidebar
│   ├── AdminHeader
│   └── Admin Pages
│       ├── OrgList → DataTable
│       ├── IngestionDashboard → StatusCards, JobQueue, FreshnessTable
│       └── TransactionReview → DataTable, Filters
│
└── shared/ Layout
    ├── ShareHeader (org name, logo — minimal)
    └── Share Pages
        ├── SharedLanding → AssetGrid
        └── SharedDiagram → D3DiagramCanvas (read-only)
```

### 3.2 Server vs Client Component Strategy

Next.js App Router defaults to Server Components. Client Components are used only when needed:

| Pattern | Component Type | Why |
|---------|---------------|-----|
| Page shells, layouts | Server Component | Fetch data on server, stream HTML |
| Data tables (static) | Server Component | No interactivity needed for initial render |
| Dashboard summary cards | Server Component | Static data display |
| Forms | Client Component (`'use client'`) | User input, validation |
| D3 Diagram | Client Component | DOM manipulation, interactivity |
| Search with debounce | Client Component | Real-time input handling |
| Sidebar (collapse/expand) | Client Component | Interactive state |
| Data tables (sortable/filterable) | Client Component | Interactive columns |
| SSE event listener | Client Component | EventSource API |
| Theme toggle | Client Component | localStorage interaction |

**Rule of thumb:** Start as Server Component. Add `'use client'` only when the component needs: event handlers, useState/useEffect, browser APIs, or third-party client-only libraries (D3, TanStack Table).

### 3.3 Data Fetching Patterns

**Server Components — fetch on the server:**

```typescript
// app/(dashboard)/page.tsx — Dashboard summary
import { api } from '@/lib/api-server';

export default async function DashboardPage() {
  const summary = await api.dashboards.summary();

  return (
    <div className="grid grid-cols-3 gap-4">
      <MetricCard title="Total Assets" value={summary.data.totalAssets} />
      <MetricCard title="Broken Chains" value={summary.data.brokenChains} />
      <MetricCard title="Entities" value={summary.data.totalEntities} />
      {/* ... */}
    </div>
  );
}
```

**Client Components — TanStack Query for interactivity:**

```typescript
// components/asset-list.tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function AssetList({ initialData }: { initialData: AssetListResponse }) {
  const [filters, setFilters] = useState<AssetFilters>({});

  const { data, isLoading } = useQuery({
    queryKey: ['assets', filters],
    queryFn: () => api.assets.list(filters),
    initialData,                          // Hydrated from server
  });

  return (
    <DataTable
      data={data.data}
      columns={assetColumns}
      pagination={data.cursor}
      onFilterChange={setFilters}
    />
  );
}
```

**Hybrid pattern — server fetch + client interactivity:**

```typescript
// app/(dashboard)/assets/page.tsx
import { api } from '@/lib/api-server';
import { AssetList } from '@/components/asset-list';

export default async function AssetsPage() {
  // Server fetch for initial data (fast, cached)
  const initialData = await api.assets.list({ limit: 25 });

  // Pass to client component for interactivity
  return <AssetList initialData={initialData} />;
}
```

---

## 4. D3 Ownership Diagram — Hero Feature

The D3 ownership diagram is PatenTrack's signature feature — the interactive SVG visualization showing patent ownership chains, assignments, and transaction types with color coding. It's shared publicly via share links and is the primary visual differentiator.

### 4.1 Legacy State

- **PT-App:** `PatentrackDiagram` component (~1,700 lines, D3 5.16.0)
- **PT-Share:** Copy-paste fork of the same component (identical code)
- **Data:** `generate_json.php` output — tree nodes with parent/child relationships, color-coded by transaction type
- **Rendering:** SVG with zoom/pan, click-to-expand, connection popups
- **Issues:** No mobile support, no accessibility, tightly coupled to Redux

### 4.2 New Architecture

```
packages/ui/components/diagram/
├── OwnershipDiagram.tsx       # Main container (client component)
├── DiagramCanvas.tsx           # D3 SVG rendering engine
├── DiagramControls.tsx         # Zoom, pan, reset, export controls
├── DiagramLegend.tsx           # Color legend (BR-031)
├── DiagramTooltip.tsx          # Hover/click popups
├── ConnectionPopup.tsx         # Assignment detail popup
├── hooks/
│   ├── useDiagramData.ts      # Data fetching + transformation
│   ├── useDiagramZoom.ts      # D3 zoom behavior
│   ├── useDiagramLayout.ts    # Tree layout calculation
│   └── useDiagramExport.ts    # SVG/PNG export
├── utils/
│   ├── layout.ts              # D3 tree layout algorithms
│   ├── colors.ts              # BR-031 color mapping
│   └── transform.ts           # API data → D3 hierarchy
└── types.ts                    # Diagram-specific types
```

### 4.3 Color Mapping (BR-031)

```typescript
// packages/shared/constants/diagram-colors.ts
export const CONVEYANCE_COLORS: Record<string, string> = {
  assignment: '#E53E3E',    // red
  namechg:    '#3182CE',    // blue
  security:   '#DD6B20',    // orange
  release:    '#38A169',    // green
  license:    '#D69E2E',    // yellow
  employee:   '#805AD5',    // purple
  merger:     '#D53F8C',    // pink
  govern:     '#718096',    // gray
  correct:    '#4FD1C5',    // teal
  missing:    '#A0AEC0',    // light gray
} as const;
```

### 4.4 Data Flow

```
API Response (GET /assets/:id/diagram)
  → useDiagramData hook (TanStack Query)
  → transform.ts (API nodes/links → D3 hierarchy)
  → useDiagramLayout hook (D3 tree layout calculation)
  → DiagramCanvas (SVG rendering)
  → User interactions (zoom, pan, click)
  → ConnectionPopup (fetches GET /shared/:code/assets/:assetId/connections)
```

### 4.5 Key Implementation Details

**Preserving exact visual behavior** (non-negotiable requirement):

```typescript
// packages/ui/components/diagram/DiagramCanvas.tsx
'use client';
import * as d3 from 'd3';
import { useRef, useEffect } from 'react';
import { useDiagramZoom } from './hooks/useDiagramZoom';
import { useDiagramLayout } from './hooks/useDiagramLayout';
import { CONVEYANCE_COLORS } from '@patentrack/shared/constants';
import type { DiagramData } from '@patentrack/shared/types';

interface DiagramCanvasProps {
  data: DiagramData;
  width?: number;
  height?: number;
  readOnly?: boolean;           // True for share viewer
  onNodeClick?: (nodeId: string) => void;
  onConnectionClick?: (rfId: string) => void;
}

export function DiagramCanvas({
  data,
  width = 1200,
  height = 800,
  readOnly = false,
  onNodeClick,
  onConnectionClick,
}: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { zoomBehavior, resetZoom } = useDiagramZoom(svgRef);
  const { nodes, links } = useDiagramLayout(data, width, height);

  useEffect(() => {
    if (!svgRef.current || !nodes.length) return;

    const svg = d3.select(svgRef.current);
    const g = svg.select('g.diagram-content');

    // Render links (colored by conveyance type — BR-031)
    const linkSelection = g.selectAll('line.link')
      .data(links)
      .join('line')
      .attr('class', 'link')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
      .attr('stroke', d => CONVEYANCE_COLORS[d.conveyanceType] || '#A0AEC0')
      .attr('stroke-width', 2)
      .attr('cursor', readOnly ? 'default' : 'pointer');

    if (!readOnly && onConnectionClick) {
      linkSelection.on('click', (event, d) => onConnectionClick(d.rfId));
    }

    // Render nodes
    const nodeSelection = g.selectAll('g.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x},${d.y})`);

    // Node circles with type-based colors
    nodeSelection.selectAll('circle')
      .data(d => [d])
      .join('circle')
      .attr('r', 8)
      .attr('fill', d => CONVEYANCE_COLORS[d.type] || '#A0AEC0');

    // Node labels
    nodeSelection.selectAll('text')
      .data(d => [d])
      .join('text')
      .attr('dy', -12)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .text(d => d.name);

  }, [nodes, links, readOnly, onNodeClick, onConnectionClick]);

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="diagram-svg"
      role="img"
      aria-label="Patent ownership diagram"
    >
      <g className="diagram-content" />
    </svg>
  );
}
```

### 4.6 Shared Between Dashboard and Share Viewer

The same `DiagramCanvas` component is used in both contexts:

| Context | Props | Features |
|---------|-------|----------|
| Dashboard (`/assets/:id/diagram`) | `readOnly={false}` | Click to expand, connection popups, export |
| Share viewer (`/shared/:code/assets/:id/diagram`) | `readOnly={true}` | View only, limited popups based on share permissions |

This eliminates the copy-paste fork that created PT-Share's codebase.

### 4.7 Mobile Responsiveness

Legacy PT-Share had `min-width: 800px`. The new diagram supports mobile:

- Touch gestures for zoom/pan (D3 zoom handles this natively)
- Responsive SVG via `viewBox` (scales to container)
- Simplified node labels on small screens
- Horizontal scroll as fallback for very wide trees

---

## 5. State Management

### 5.1 Strategy

The legacy system used Redux with Thunk for everything — 195 action types in PT-Admin alone, 64KB monolithic action files. The new system uses a layered approach:

| Layer | Technology | What it manages |
|-------|-----------|----------------|
| Server state | TanStack Query v5 | All API data (assets, dashboards, events, etc.) |
| Client state | Zustand (minimal) | UI state: sidebar open/closed, active filters, selected items |
| URL state | Next.js `searchParams` | Filters, pagination cursors, sort order |
| Form state | React Hook Form + Zod | Form inputs, validation |

**Why not Redux?** Redux was massive overkill for this app. Most "state" in the legacy system was actually server data cached in Redux. TanStack Query handles server state (fetching, caching, invalidation, optimistic updates) better than Redux ever could. The remaining client state is trivial — a few booleans and filter objects.

### 5.2 TanStack Query Configuration

```typescript
// lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,           // 5 minutes
      gcTime: 30 * 60 * 1000,             // 30 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
```

**Query key conventions:**

```typescript
// Consistent, hierarchical query keys
const queryKeys = {
  assets: {
    all: ['assets'] as const,
    list: (filters: AssetFilters) => ['assets', 'list', filters] as const,
    detail: (id: string) => ['assets', 'detail', id] as const,
    assignments: (id: string) => ['assets', 'assignments', id] as const,
    diagram: (id: string) => ['assets', 'diagram', id] as const,
    family: (id: string) => ['assets', 'family', id] as const,
  },
  dashboards: {
    summary: ['dashboards', 'summary'] as const,
    trees: (filters?: TreeFilters) => ['dashboards', 'trees', filters] as const,
    brokenTitles: ['dashboards', 'broken-titles'] as const,
    timeline: (filters?: TimelineFilters) => ['dashboards', 'timeline', filters] as const,
  },
  organizations: {
    detail: (orgId: string) => ['organizations', orgId] as const,
    entities: (orgId: string) => ['organizations', orgId, 'entities'] as const,
    companies: (orgId: string) => ['organizations', orgId, 'companies'] as const,
    users: (orgId: string) => ['organizations', orgId, 'users'] as const,
  },
  admin: {
    organizations: ['admin', 'organizations'] as const,
    ingestion: {
      status: ['admin', 'ingestion', 'status'] as const,
      jobs: (filters?: JobFilters) => ['admin', 'ingestion', 'jobs', filters] as const,
      freshness: ['admin', 'ingestion', 'freshness'] as const,
    },
  },
};
```

### 5.3 Cache Invalidation via SSE

When the backend ingestion pipeline completes, the frontend receives an SSE event and invalidates relevant caches:

```typescript
// hooks/use-sse-events.ts
'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useSseEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const eventSource = new EventSource('/api/v1/events/stream', {
      withCredentials: true,
    });

    eventSource.addEventListener('new-assignments', (event) => {
      const data = JSON.parse(event.data);
      // Invalidate dashboard and asset caches
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    });

    eventSource.addEventListener('dashboard-refresh', (event) => {
      const data = JSON.parse(event.data);
      queryClient.invalidateQueries({
        queryKey: ['dashboards', data.dataType],
      });
    });

    eventSource.addEventListener('pipeline-complete', (event) => {
      // Invalidate everything for this org
      queryClient.invalidateQueries();
    });

    return () => eventSource.close();
  }, [queryClient]);
}
```

### 5.4 Zustand Store (Minimal)

```typescript
// stores/ui-store.ts
import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  selectedAssetIds: Set<string>;
  toggleAssetSelection: (id: string) => void;
  clearSelection: () => void;
  diagramZoomLevel: number;
  setDiagramZoomLevel: (level: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  selectedAssetIds: new Set(),
  toggleAssetSelection: (id) => set((s) => {
    const next = new Set(s.selectedAssetIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedAssetIds: next };
  }),
  clearSelection: () => set({ selectedAssetIds: new Set() }),
  diagramZoomLevel: 1,
  setDiagramZoomLevel: (level) => set({ diagramZoomLevel: level }),
}));
```

### 5.5 URL State for Filters

```typescript
// Filters live in the URL, not in component state
// This enables deep linking, sharing, and back button

// app/(dashboard)/assets/page.tsx
import { type SearchParams } from 'next/navigation';

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    search?: string;
    cursor?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const data = await api.assets.list({
    status: params.status || 'all',
    search: params.search,
    cursor: params.cursor,
    sort: params.sort || 'lastActivity',
  });

  return <AssetList data={data} />;
}
```

---

## 6. Authentication & Authorization in the Frontend

### 6.1 Auth Flow

```
Login Page → POST /auth/login → Server sets httpOnly cookies
  → Redirect to /dashboard
  → Middleware reads cookie, verifies token
  → Server Components fetch data with cookie forwarded
  → Client Components use TanStack Query (cookie sent automatically)

Token Expiry → 401 response → Client interceptor calls POST /auth/refresh
  → New cookies set → Retry original request

Share Viewer → /shared/:code → No cookies needed
  → Share code in URL → API validates code server-side
```

### 6.2 Auth Provider

```typescript
// components/auth-provider.tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: 'member' | 'admin' | 'super_admin';
  mfaEnabled: boolean;
}

interface AuthContext {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | null>(null);

export function AuthProvider({ children, initialUser }: {
  children: React.ReactNode;
  initialUser: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: false, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
```

### 6.3 Role-Based UI

```typescript
// components/role-guard.tsx
'use client';
import { useAuth } from './auth-provider';

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin' && user?.role !== 'super_admin') return null;
  return <>{children}</>;
}

export function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'super_admin') return null;
  return <>{children}</>;
}

// Usage in sidebar:
<nav>
  <NavItem href="/" icon={Home}>Dashboard</NavItem>
  <NavItem href="/assets" icon={FileText}>Assets</NavItem>
  <NavItem href="/trees" icon={GitBranch}>Trees</NavItem>
  <AdminOnly>
    <NavItem href="/settings/users" icon={Users}>Users</NavItem>
    <NavItem href="/settings/shares" icon={Share}>Share Links</NavItem>
  </AdminOnly>
  <SuperAdminOnly>
    <NavItem href="/admin" icon={Shield}>Admin Panel</NavItem>
  </SuperAdminOnly>
</nav>
```

### 6.4 Token Refresh Interceptor

```typescript
// lib/api-client.ts
class ApiClient {
  private refreshPromise: Promise<void> | null = null;

  async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'include',              // Send cookies
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (response.status === 401) {
      // Token expired — refresh once, then retry
      if (!this.refreshPromise) {
        this.refreshPromise = this.refresh();
      }
      await this.refreshPromise;
      this.refreshPromise = null;

      // Retry original request
      const retryResponse = await fetch(`/api/v1${path}`, {
        ...options,
        credentials: 'include',
      });
      if (retryResponse.status === 401) {
        // Refresh also failed — redirect to login
        window.location.href = '/login';
        throw new Error('Session expired');
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error);
    }

    return response.json();
  }

  private async refresh(): Promise<void> {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Refresh failed');
  }
}

export const api = new ApiClient();
```

---

## 7. Design System & UI Library

### 7.1 Approach

Replace the legacy mix of MUI v4, MUI v5, styled-components, JSS, and makeStyles (5+ CSS approaches across 3 apps) with a single consistent system:

- **Tailwind CSS 4** for utility styling
- **Shadcn/ui** for component primitives (built on Radix UI)
- **Custom components** in `packages/ui` for domain-specific features

### 7.2 Component Library (`packages/ui`)

| Category | Components | Replaces |
|----------|-----------|----------|
| Layout | `Sidebar`, `Header`, `Breadcrumbs`, `PageShell` | MUI `Drawer`, custom layouts |
| Data Display | `DataTable`, `MetricCard`, `Badge`, `StatusDot` | 4 grid/table libraries, MUI `Card` |
| Forms | `Input`, `Select`, `DatePicker`, `SearchInput` | MUI form components |
| Feedback | `Toast`, `LoadingSpinner`, `EmptyState`, `ErrorBoundary` | Various ad-hoc implementations |
| Visualization | `OwnershipDiagram`, `TimelineChart`, `WordCloud`, `CpcTree` | D3 5.16.0 + 9 viz libraries → D3 7 + Recharts |
| Navigation | `NavItem`, `TabGroup`, `Pagination` | MUI `Tabs`, custom pagination |
| Overlays | `Modal`, `Sheet`, `Popover`, `Tooltip` | MUI `Dialog`, various modals |

### 7.3 Visualization Library Consolidation

Legacy PT-App used 9 different visualization libraries (~500KB bundle). Consolidated to 2:

| Legacy Library | New Replacement | Usage |
|---------------|----------------|-------|
| D3 5.16.0 | D3 7 | Ownership diagram (hero feature) |
| react-event-timeline | Custom `Timeline` component | Transaction timeline |
| Various charting libs | Recharts | Simple charts (bar, line, pie) |
| react-wordcloud | Custom D3 word cloud | CPC word cloud |
| react-google-maps | Removed | Not needed in rebuild |
| 4 other viz libs | Removed | Functionality consolidated |

**Bundle savings:** ~500KB → ~150KB (D3 + Recharts)

### 7.4 Dark Mode

Legacy used `localStorage` for dark mode persistence (BR-064). New approach:

```typescript
// Tailwind-native dark mode with system preference detection
// tailwind.config.ts
export default {
  darkMode: 'class',
  // ...
};

// Hook for toggle (persisted in org settings via API, not localStorage)
// This respects the user's org-level preference (BR-064)
```

---

## 8. Performance & Optimization

### 8.1 Bundle Optimization

| Strategy | Impact | Implementation |
|----------|--------|---------------|
| Server Components (default) | 60%+ reduction in client JS | No client bundle for data display pages |
| Dynamic imports for D3 | D3 loaded only on diagram pages | `next/dynamic` with `ssr: false` |
| Route-based code splitting | Automatic via Next.js App Router | Each route = separate chunk |
| Tree shaking D3 modules | Import only needed D3 modules | `import { select } from 'd3-selection'` instead of `import * as d3 from 'd3'` |
| Tailwind purge | CSS < 20KB | Automatic in production build |
| Image optimization | WebP, responsive sizing | `next/image` component |

### 8.2 Data Loading

| Pattern | Where Used | Implementation |
|---------|-----------|---------------|
| Streaming SSR | Dashboard, asset lists | React Suspense + `loading.tsx` per route |
| Parallel data fetching | Asset detail (multiple tabs) | `Promise.all` in Server Component |
| Prefetching | Next page in paginated lists | `router.prefetch()` on hover |
| Optimistic updates | Share link creation, settings changes | TanStack Query `onMutate` |
| Stale-while-revalidate | All TanStack Query calls | `staleTime: 5min`, background refresh |
| Infinite scroll | Event feed, assignment history | TanStack Query `useInfiniteQuery` |

### 8.3 Target Metrics

| Metric | Target | Legacy Baseline |
|--------|--------|----------------|
| First Contentful Paint (FCP) | < 1.0s | ~3-5s (client-rendered React) |
| Largest Contentful Paint (LCP) | < 2.0s | ~5-8s |
| Time to Interactive (TTI) | < 2.5s | ~6-10s |
| Client JS bundle (initial) | < 100KB | ~800KB+ (MUI + Redux + D3 + 9 viz libs) |
| Lighthouse score | > 90 | ~40-50 (estimated) |

---

## 9. Testing Strategy

### 9.1 Testing Pyramid

| Level | Tool | Coverage Target | What to Test |
|-------|------|----------------|-------------|
| Unit | Vitest | 80%+ | Business rule functions, data transforms, utility functions |
| Component | Vitest + Testing Library | 70%+ | Component rendering, user interactions, form validation |
| Integration | Vitest + MSW | Key flows | API integration, auth flows, data fetching |
| E2E | Playwright | Critical paths | Login → dashboard → asset → diagram flow, share viewer flow, admin flow |
| Visual | Playwright screenshot | Key pages | Diagram rendering, layout consistency |

### 9.2 Priority Test Cases

**P0 — Must have before launch:**

1. Login → dashboard → view assets → view diagram (complete user flow)
2. Share link viewer (public access, diagram renders correctly)
3. Token refresh when access token expires
4. Admin: create org → pipeline runs → data appears
5. D3 diagram renders correctly with all tree types (BR-024–BR-030)
6. Broken title detection displays correctly (BR-032–BR-036)

**P1 — Before beta:**

7. All auth flows (register, verify, forgot password, MFA)
8. Asset search, filtering, pagination
9. Entity normalization trigger and result display
10. Share link creation with permissions and expiry
11. SSE events trigger cache invalidation and UI refresh
12. Mobile responsive layout (diagram, share viewer)

### 9.3 D3 Diagram Testing

The diagram is the hero feature and the hardest to test. Strategy:

```typescript
// Visual regression testing for the diagram
import { test, expect } from '@playwright/test';

test('ownership diagram renders with correct colors', async ({ page }) => {
  // Seed test data with known tree structure
  await page.goto('/assets/test-asset-id/diagram');

  // Wait for D3 to render
  await page.waitForSelector('svg.diagram-svg circle');

  // Verify node colors match BR-031
  const assignmentNode = page.locator('circle[data-type="assignment"]');
  await expect(assignmentNode).toHaveAttribute('fill', '#E53E3E');

  // Screenshot comparison
  await expect(page.locator('.diagram-container')).toHaveScreenshot('ownership-diagram.png');
});
```

---

## Cross-References

- **System Architecture:** `docs/design/02-system-architecture.md` — Section 1 (monorepo), Section 3 (auth), Section 5 (caching), Section 6 (SSE), Section 7 (API principles)
- **API Contracts:** `docs/design/03-api-contracts.md` — All endpoint schemas consumed by frontend
- **Domain Model:** `docs/design/01-domain-model.md` — Enum types, color mappings, business rule constraints
- **Business Rules:** `docs/analysis/07-cross-application-summary.md` — Section 6 (BR-001–BR-065)

---

**Document Status:** Complete  
**Next:** `docs/design/05-ingestion-pipeline.md` (Ingestion pipeline design)
