# PatenTrack3 API Contracts

**Stage B — Architecture Design**  
**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Complete

---

## Table of Contents

1. [Conventions & Common Schemas](#1-conventions--common-schemas)
2. [Authentication Endpoints](#2-authentication-endpoints)
3. [Asset Endpoints](#3-asset-endpoints)
4. [Dashboard & Events Endpoints](#4-dashboard--events-endpoints)
5. [Organization & Company Endpoints](#5-organization--company-endpoints)
6. [Admin Endpoints](#6-admin-endpoints)
7. [Share & Integration Endpoints](#7-share--integration-endpoints)
- [Appendix A: Endpoint Summary](#appendix-a-endpoint-summary)
- [Appendix B: Legacy Endpoint Mapping](#appendix-b-legacy-endpoint-mapping)

---

## 1. Conventions & Common Schemas

### 1.1 OpenAPI Base Info

```yaml
openapi: 3.1.0
info:
  title: PatenTrack API
  version: 1.0.0
  description: Patent intelligence platform API
servers:
  - url: https://api.patentrack.com/api/v1
    description: Production
  - url: https://staging-api.patentrack.com/api/v1
    description: Staging
  - url: http://localhost:3000/api/v1
    description: Local development
```

### 1.2 Authentication

All authenticated requests use httpOnly secure cookies (no localStorage). The API server extracts the JWT from the cookie and sets the PostgreSQL RLS context (`app.current_org_id`) before executing queries.

**Auth Level Notation:**

| Symbol | Level | Description |
|--------|-------|-------------|
| 🔓 | Public | No authentication required |
| 🔑 | Authenticated | Valid access token required (any role) |
| 👑 | Admin | Org Admin (user type 0 or 1) required (BR-048) |
| ⚡ | Super Admin | Super Admin (user type 9) required (BR-049) |

### 1.3 Common Headers

**Request Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Cookie` | For 🔑 👑 ⚡ | Contains `access_token` httpOnly cookie |
| `X-Request-ID` | Optional | UUID for request tracing. Auto-generated if absent. |
| `Accept` | Optional | `application/json` (default) |

**Response Headers:**

| Header | Description |
|--------|-------------|
| `X-Request-ID` | Echo or auto-generated UUID for tracing |
| `X-RateLimit-Limit` | Max requests per window for this role |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |
| `ETag` | Entity tag for cache validation (on cacheable responses) |
| `Cache-Control` | `private, no-cache` for tenant data; `public, max-age=86400` for immutable data |

### 1.4 Common Response Schemas

#### Success — Single Item

```typescript
// Response envelope for single items
interface SingleResponse<T> {
  data: T;
}
```

#### Success — Collection (Paginated)

```typescript
// Cursor-based pagination response
interface PaginatedResponse<T> {
  data: T[];
  cursor: {
    next: string | null;  // Opaque cursor for next page
    hasMore: boolean;
  };
  total: number;          // Total count (may be approximate for 50M+ tables)
}
```

#### Error Response

```typescript
import { z } from 'zod';

const ErrorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    validationErrors: z.array(z.object({
      field: z.string(),
      message: z.string(),
    })).optional(),
  }),
});
```

**HTTP Status Code Mapping:**

| Code | ErrorCode | Usage |
|------|-----------|-------|
| 400 | `BAD_REQUEST` | Malformed request |
| 400 | `VALIDATION_ERROR` | Zod validation failure (includes `validationErrors`) |
| 401 | `UNAUTHORIZED` | Missing or expired token |
| 403 | `FORBIDDEN` | Insufficient permissions / RLS blocked |
| 404 | `NOT_FOUND` | Resource not found (or not visible to this tenant) |
| 409 | `CONFLICT` | Duplicate resource |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Downstream dependency unavailable |

### 1.5 Pagination Convention

All collections that may exceed 100 items use cursor-based pagination:

```typescript
const PaginationParams = z.object({
  cursor: z.string().optional(),     // Opaque cursor from previous response
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),       // Field to sort by (endpoint-specific)
  order: z.enum(['asc', 'desc']).default('desc'),
});
```

### 1.6 Common Filter Patterns

```typescript
// Date range filter (used across multiple endpoints)
const DateRangeFilter = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// UUID parameter
const UuidParam = z.string().uuid();
```

### 1.7 Rate Limiting Tiers

| Role | Limit | Window |
|------|-------|--------|
| ⚡ Super Admin | 1,000 req | 1 minute |
| 👑 Org Admin | 300 req | 1 minute |
| 🔑 Org Member | 100 req | 1 minute |
| 🔓 Share Viewer | 30 req | 1 minute |
| 🔓 Unauthenticated (auth endpoints) | 10 req | 1 minute per IP |

### 1.8 Endpoint Documentation Format

Each endpoint below is documented with:
- **Method & Path**
- **Description**
- **Auth Level** (🔓 🔑 👑 ⚡)
- **Rate Limit Tier**
- **Request** (params, query, body as Zod schemas)
- **Response** (Zod schema)
- **Errors** (specific error cases)
- **Cache Strategy**
- **Business Rules** referenced
- **Legacy Endpoints** replaced

---

## 2. Authentication Endpoints

All auth endpoints use aggressive rate limiting (10 req/min per IP) to prevent brute force attacks (fixing S-13, S-15).

---

### 2.1 POST /api/v1/auth/login

**Description:** Authenticate with email and password. Returns access token via httpOnly cookie.  
**Auth:** 🔓 Public  
**Rate Limit:** 5 req/min per IP (fixing S-15)

**Request Body:**

```typescript
const LoginRequest = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(128),  // Min 12 chars (fixing S-14)
});
```

**Response (200):**

```typescript
const LoginResponse = z.object({
  data: z.object({
    user: z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string(),
      organizationId: z.string().uuid(),
      role: z.enum(['member', 'admin', 'super_admin']),  // BR-048, BR-049
      mfaEnabled: z.boolean(),
    }),
  }),
});
// Sets httpOnly cookies: access_token (15min), refresh_token (7d)
```

**Response (200 — MFA Required):**

```typescript
const LoginMfaResponse = z.object({
  data: z.object({
    mfaRequired: z.literal(true),
    mfaToken: z.string(),  // Temporary token, valid 5 min, used with /auth/mfa/verify
  }),
});
```

**Errors:**
- `401 UNAUTHORIZED` — Invalid credentials
- `429 RATE_LIMITED` — Too many attempts. Includes `Retry-After` header.
- `403 FORBIDDEN` — Account locked (progressive delay: 1s, 5s, 30s, 5min after 10 failures)

**Business Rules:** BR-048 (admin roles), BR-049 (super admin), BR-050 (JWT expiry → 15min), BR-051 (Argon2id hashing)  
**Legacy Endpoints Replaced:** `POST /signin`

---

### 2.2 POST /api/v1/auth/refresh

**Description:** Refresh the access token using the refresh token cookie. Refresh token is rotated on each use.  
**Auth:** 🔑 (refresh token cookie)  
**Rate Limit:** 10 req/min per user

**Request:** No body. Refresh token is read from httpOnly cookie.

**Response (200):**

```typescript
const RefreshResponse = z.object({
  data: z.object({
    expiresAt: z.string().datetime(),  // New access token expiry
  }),
});
// Rotates both cookies: new access_token (15min), new refresh_token (7d)
```

**Errors:**
- `401 UNAUTHORIZED` — Invalid, expired, or already-used refresh token

**Security Notes:**
- Refresh token is validated server-side against Redis store (fixing S-02: token refresh bypass)
- Refresh token is rotated on every use — old token immediately invalidated
- Signature is verified on the refresh token (fixing S-02)

**Business Rules:** BR-050 (token lifecycle), S-02 fix (signature verification), S-29 fix (rotation)  
**Legacy Endpoints Replaced:** `POST /signin/refresh`

---

### 2.3 POST /api/v1/auth/logout

**Description:** Revoke refresh token and clear auth cookies.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard (100 req/min)

**Request:** No body.

**Response (200):**

```typescript
const LogoutResponse = z.object({
  data: z.object({
    success: z.literal(true),
  }),
});
// Clears access_token and refresh_token cookies
// Deletes refresh token from Redis server-side store
```

**Legacy Endpoints Replaced:** None (new — logout was not implemented in legacy)

---

### 2.4 POST /api/v1/auth/register

**Description:** Create a new user account. Sends verification email.  
**Auth:** 🔓 Public  
**Rate Limit:** 3 req/min per IP

**Request Body:**

```typescript
const RegisterRequest = z.object({
  email: z.string().email().max(255),
  password: z.string()
    .min(12)             // Fixing S-14: password complexity
    .max(128)
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  name: z.string().min(1).max(255),
  organizationName: z.string().min(1).max(255).optional(),  // Creates new org if provided
});
```

**Response (201):**

```typescript
const RegisterResponse = z.object({
  data: z.object({
    userId: z.string().uuid(),
    verificationRequired: z.literal(true),
    message: z.string(),  // "Verification email sent"
  }),
});
```

**Business Rules:** BR-051 (Argon2id hashing), BR-052 (email verification)  
**Legacy Endpoints Replaced:** `POST /signup`

---

### 2.5 POST /api/v1/auth/verify-email

**Description:** Verify email with code sent during registration.  
**Auth:** 🔓 Public  
**Rate Limit:** 5 req/min per IP

**Request Body:**

```typescript
const VerifyEmailRequest = z.object({
  email: z.string().email(),
  code: z.string().min(8).max(8),  // 8 alphanumeric chars (fixing S-24: was 6 hex)
});
```

**Response (200):**

```typescript
const VerifyEmailResponse = z.object({
  data: z.object({
    verified: z.literal(true),
  }),
});
```

**Errors:**
- `400 BAD_REQUEST` — Invalid or expired code (1-hour expiry, single use)
- `429 RATE_LIMITED` — Too many attempts

**Business Rules:** BR-052 (verification code: 8 alphanumeric chars, 1hr expiry, single use — upgraded from 6 hex, fixing S-24)  
**Legacy Endpoints Replaced:** `POST /verify`

---

### 2.6 POST /api/v1/auth/forgot-password

**Description:** Request a password reset email.  
**Auth:** 🔓 Public  
**Rate Limit:** 3 req/min per IP

**Request Body:**

```typescript
const ForgotPasswordRequest = z.object({
  email: z.string().email(),
});
```

**Response (200):**

```typescript
// Always returns success (doesn't reveal if email exists)
const ForgotPasswordResponse = z.object({
  data: z.object({
    message: z.literal('If an account exists, a reset email has been sent.'),
  }),
});
```

**Business Rules:** BR-053 (reset token: 40 hex chars, 1hr expiry, single use)  
**Legacy Endpoints Replaced:** `POST /forget`

---

### 2.7 POST /api/v1/auth/reset-password

**Description:** Reset password using token from email.  
**Auth:** 🔓 Public  
**Rate Limit:** 5 req/min per IP

**Request Body:**

```typescript
const ResetPasswordRequest = z.object({
  token: z.string().length(40),  // BR-053: 40 hex chars
  password: z.string()
    .min(12).max(128)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
});
```

**Response (200):**

```typescript
const ResetPasswordResponse = z.object({
  data: z.object({
    success: z.literal(true),
  }),
});
// Invalidates all existing refresh tokens for this user
```

**Business Rules:** BR-053 (reset token lifecycle)  
**Legacy Endpoints Replaced:** `POST /reset`

---

### 2.8 POST /api/v1/auth/oauth/google

**Description:** Authenticate via Google OAuth2 PKCE flow (fixing S-22: tokens no longer in query strings).  
**Auth:** 🔓 Public  
**Rate Limit:** 10 req/min per IP

**Request Body:**

```typescript
const GoogleOAuthRequest = z.object({
  code: z.string(),           // Authorization code from Google
  codeVerifier: z.string(),   // PKCE verifier
  redirectUri: z.string().url(),
});
```

**Response (200):** Same as `LoginResponse` (sets httpOnly cookies).

**Errors:**
- `401 UNAUTHORIZED` — Invalid authorization code
- `409 CONFLICT` — Email already registered with password auth

**Legacy Endpoints Replaced:** `POST /google/signin`

---

### 2.9 POST /api/v1/auth/oauth/microsoft

**Description:** Authenticate via Microsoft OAuth2 PKCE flow.  
**Auth:** 🔓 Public  
**Rate Limit:** 10 req/min per IP

**Request Body:**

```typescript
const MicrosoftOAuthRequest = z.object({
  code: z.string(),
  codeVerifier: z.string(),
  redirectUri: z.string().url(),
});
```

**Response (200):** Same as `LoginResponse`.

**Legacy Endpoints Replaced:** `POST /microsoft/signin`

---

### 2.10 POST /api/v1/auth/mfa/setup

**Description:** Enable TOTP-based 2FA for the authenticated user (fixing S-28).  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Request:** No body.

**Response (200):**

```typescript
const MfaSetupResponse = z.object({
  data: z.object({
    secret: z.string(),        // TOTP secret (base32)
    qrCodeUrl: z.string(),     // otpauth:// URI for QR code rendering
    backupCodes: z.array(z.string()).length(10),  // One-time backup codes
  }),
});
```

**Notes:** Setup is not complete until user confirms with a valid TOTP code via `/auth/mfa/verify`. Mandatory for Super Admin accounts.

**Legacy Endpoints Replaced:** None (new feature — S-28 fix)

---

### 2.11 POST /api/v1/auth/mfa/verify

**Description:** Verify TOTP code during login (when MFA is enabled) or to confirm MFA setup.  
**Auth:** 🔓 Public (uses mfaToken from login response)  
**Rate Limit:** 5 req/min per IP

**Request Body:**

```typescript
const MfaVerifyRequest = z.object({
  mfaToken: z.string(),              // From login response
  code: z.string().length(6),        // TOTP 6-digit code
  isBackupCode: z.boolean().default(false),  // True if using backup code
});
```

**Response (200):** Same as `LoginResponse` (sets httpOnly cookies, completes login).

**Errors:**
- `401 UNAUTHORIZED` — Invalid TOTP code or expired mfaToken
- `429 RATE_LIMITED` — Too many attempts (account locks after 5 failed MFA attempts)

**Legacy Endpoints Replaced:** None (new feature)

---

## 3. Asset Endpoints

Asset endpoints provide access to patent data, bibliographic information, ownership diagrams, and related intelligence. All asset queries are scoped to the authenticated user's organization via RLS.

Legacy system had ~22 asset endpoints with overlapping routes — consolidated to 11 clean endpoints.

---

### 3.1 GET /api/v1/assets

**Description:** List patents/assets in the user's organization. Supports filtering, sorting, and cursor-based pagination.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard (100 req/min)

**Query Parameters:**

```typescript
const ListAssetsQuery = PaginationParams.extend({
  search: z.string().max(255).optional(),           // Full-text search on title, number, assignee
  status: z.enum(['complete', 'broken', 'encumbered', 'all']).default('all'),  // BR-037 dashboard types
  entityId: z.string().uuid().optional(),            // Filter by canonical entity
  cpcCode: z.string().max(20).optional(),            // Filter by CPC classification
  dateFrom: z.string().datetime().optional(),        // Application date range (BR-039: > 1999)
  dateTo: z.string().datetime().optional(),
  conveyanceType: z.enum([
    'assignment', 'employee', 'govern', 'merger', 'namechg',
    'license', 'release', 'security', 'correct', 'missing',
  ]).optional(),                                     // BR-001 through BR-010
  sort: z.enum(['applicationDate', 'grantDate', 'title', 'lastActivity']).default('lastActivity'),
});
```

**Response (200):**

```typescript
const AssetListItem = z.object({
  id: z.string().uuid(),
  grantNumber: z.string().nullable(),
  applicationNumber: z.string(),
  title: z.string(),
  applicationDate: z.string().datetime().nullable(),
  grantDate: z.string().datetime().nullable(),
  currentAssignee: z.string().nullable(),            // Canonical name (BR-019)
  status: z.enum(['complete', 'broken', 'encumbered']),  // BR-037
  assignmentCount: z.number().int(),
  lastActivityDate: z.string().datetime().nullable(),
});

const ListAssetsResponse = z.object({
  data: z.array(AssetListItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** `Cache-Control: private, no-cache`. ETag based on org's last ingestion timestamp.  
**Business Rules:** BR-037 (status types), BR-039 (date filter > 1999)  
**Legacy Endpoints Replaced:** `GET /assets/collections/...` (multiple overlapping endpoints)

---

### 3.2 GET /api/v1/assets/:id

**Description:** Get full detail for a single patent/asset including bibliographic data.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Path Parameters:**

```typescript
const AssetIdParam = z.object({
  id: z.string().uuid(),
});
```

**Response (200):**

```typescript
const AssetDetail = z.object({
  id: z.string().uuid(),
  grantNumber: z.string().nullable(),
  applicationNumber: z.string(),
  title: z.string(),
  abstract: z.string().nullable(),
  applicationDate: z.string().datetime().nullable(),
  grantDate: z.string().datetime().nullable(),
  status: z.enum(['complete', 'broken', 'encumbered']),
  // Bibliographic data
  inventors: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
  })),
  currentAssignee: z.object({
    id: z.string().uuid(),
    name: z.string(),                  // Canonical name (BR-019)
    representativeId: z.string().uuid(),
  }).nullable(),
  classifications: z.array(z.object({
    code: z.string(),
    description: z.string().nullable(),
    level: z.enum(['section', 'class', 'subclass', 'group', 'subgroup']),
  })),
  // Summary counts
  assignmentCount: z.number().int(),
  familyMemberCount: z.number().int(),
  citationCount: z.number().int(),
  maintenanceFeeStatus: z.enum(['current', 'expired', 'abandoned']).nullable(),
});

const AssetDetailResponse = z.object({
  data: AssetDetail,
});
```

**Cache Strategy:** ETag based on asset's last update timestamp. Bibliographic data is immutable — long cache for those fields.  
**Business Rules:** BR-019 (canonical names), BR-037 (status)  
**Legacy Endpoints Replaced:** `GET /assets/:asset`

---

### 3.3 GET /api/v1/assets/:id/assignments

**Description:** Get assignment/transaction history for a patent. Ordered chronologically.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const AssignmentListQuery = PaginationParams.extend({
  conveyanceType: z.enum([
    'assignment', 'employee', 'govern', 'merger', 'namechg',
    'license', 'release', 'security', 'correct', 'missing',
  ]).optional(),
});
```

**Response (200):**

```typescript
const AssignmentItem = z.object({
  id: z.string().uuid(),
  rfId: z.string(),                        // USPTO reel-frame ID
  conveyanceText: z.string(),              // Raw conveyance text
  conveyanceType: z.enum([                 // BR-001 through BR-010 classification
    'assignment', 'employee', 'govern', 'merger', 'namechg',
    'license', 'release', 'security', 'correct', 'missing',
  ]),
  isEmployerAssignment: z.boolean(),       // BR-002, BR-023: employer_assign flag
  recordDate: z.string().datetime(),
  executionDate: z.string().datetime().nullable(),
  assignors: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    executionDate: z.string().datetime().nullable(),
  })),
  assignees: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
  })),
  color: z.string(),                       // BR-031: visual color mapping
});

const AssignmentListResponse = z.object({
  data: z.array(AssignmentItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** ETag based on org's last assignment ingestion.  
**Business Rules:** BR-001–BR-012 (classification), BR-023 (employer flag), BR-031 (colors)  
**Legacy Endpoints Replaced:** Part of `GET /assets/:asset` (embedded data)

---

### 3.4 GET /api/v1/assets/:id/family

**Description:** Get patent family members from EPO data.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const FamilyMember = z.object({
  id: z.string().uuid(),
  applicationNumber: z.string(),
  publicationNumber: z.string().nullable(),
  country: z.string().length(2),           // ISO country code
  kind: z.string().nullable(),             // Document kind code
  title: z.string().nullable(),
  filingDate: z.string().datetime().nullable(),
  publicationDate: z.string().datetime().nullable(),
});

const FamilyResponse = z.object({
  data: z.array(FamilyMember),
});
```

**Cache Strategy:** ETag. Family data changes infrequently — `Cache-Control: private, max-age=3600`.  
**Business Rules:** BR-057 (EPO OAuth2 for data retrieval)  
**Legacy Endpoints Replaced:** `GET /family/:applicationNumber`, `GET /family/epo/grant/:grantDocNumber`, `GET /family/list/:grantNumber`

---

### 3.5 GET /api/v1/assets/:id/cpc

**Description:** Get CPC (Cooperative Patent Classification) codes for an asset with hierarchy.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const CpcClassification = z.object({
  code: z.string(),
  level: z.enum(['section', 'class', 'subclass', 'group', 'subgroup']),
  description: z.string().nullable(),
  parentCode: z.string().nullable(),
});

const CpcResponse = z.object({
  data: z.array(CpcClassification),
});
```

**Cache Strategy:** `Cache-Control: private, max-age=86400`. CPC data changes monthly (BR-056).  
**Business Rules:** BR-056 (monthly CPC refresh)  
**Legacy Endpoints Replaced:** `POST /assets/cpc`

---

### 3.6 GET /api/v1/assets/:id/maintenance

**Description:** Get maintenance fee events for a patent.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const MaintenanceFeeEvent = z.object({
  id: z.string().uuid(),
  eventCode: z.string(),
  eventDate: z.string().datetime(),
  description: z.string().nullable(),
  feeWindow: z.enum(['3.5_year', '7.5_year', '11.5_year']).nullable(),
  status: z.enum(['paid', 'due', 'surcharge', 'expired']),
});

const MaintenanceResponse = z.object({
  data: z.array(MaintenanceFeeEvent),
});
```

**Cache Strategy:** ETag. Updated weekly with maintenance fee ingestion.  
**Legacy Endpoints Replaced:** `POST /events/filed_assets_events`, `GET /events/tabs/:tabID/companies/:companyID/...`

---

### 3.7 GET /api/v1/assets/:id/citations

**Description:** Get citation data for a patent (cites and cited-by).  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const Citation = z.object({
  id: z.string().uuid(),
  citedPatentNumber: z.string(),
  citedPatentTitle: z.string().nullable(),
  citedAssignee: z.string().nullable(),
  direction: z.enum(['cites', 'cited_by']),
});

const CitationResponse = z.object({
  data: z.array(Citation),
  totalCites: z.number().int(),
  totalCitedBy: z.number().int(),
});
```

**Cache Strategy:** ETag. Citation data is immutable after ingestion.  
**Legacy Endpoints Replaced:** `GET /assets/:patentNumber/:type/outsource`, `POST /citation`

---

### 3.8 GET /api/v1/assets/:id/diagram

**Description:** Get the ownership diagram JSON data for D3 rendering (the "hero feature").  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const DiagramNode = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    'employee', 'purchase', 'sale', 'merger_in', 'merger_out',
    'security_out', 'security_in', 'release_out', 'release_in',
    'namechg', 'govern', 'correct', 'missing', 'other',
  ]),                                      // BR-024 through BR-030
  tab: z.number().int().min(0).max(3),     // BR-024–BR-030 tab assignment
  color: z.string(),                       // BR-031 color mapping
  parent: z.string().nullable(),
});

const DiagramLink = z.object({
  source: z.string(),
  target: z.string(),
  rfId: z.string(),
  conveyanceType: z.string(),
  recordDate: z.string().datetime(),
});

const DiagramResponse = z.object({
  data: z.object({
    nodes: z.array(DiagramNode),
    links: z.array(DiagramLink),
    rootEntity: z.string(),
    isBrokenTitle: z.boolean(),            // BR-032–BR-036
  }),
});
```

**Cache Strategy:** Cached in Redis as `org:{id}:tree:{assetId}`. Invalidated on new assignment ingestion.  
**Business Rules:** BR-024–BR-031 (tree types, tabs, colors), BR-032–BR-036 (broken title)  
**Legacy Endpoints Replaced:** `generate_json.php` output served via `GET /assets/:asset`

---

### 3.9 GET /api/v1/assets/:id/pdf

**Description:** Get a signed URL to download the assignment PDF from S3 (fixing S-09: no more public bucket).  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const PdfResponse = z.object({
  data: z.object({
    url: z.string().url(),      // Pre-signed S3 URL, expires in 15 minutes
    expiresAt: z.string().datetime(),
  }),
});
```

**Errors:**
- `404 NOT_FOUND` — No PDF available for this assignment

**Security:** Signed URL expires in 15 minutes. Private S3 bucket — no public access (fixing S-09).  
**Legacy Endpoints Replaced:** Direct public S3 bucket access

---

### 3.10 GET /api/v1/assets/search

**Description:** Full-text search across patents in the organization.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const SearchAssetsQuery = PaginationParams.extend({
  q: z.string().min(1).max(255),           // Search query
  fields: z.array(z.enum([
    'title', 'number', 'assignee', 'inventor', 'conveyanceText',
  ])).default(['title', 'number', 'assignee']),
});
```

**Response (200):**

```typescript
const SearchResult = z.object({
  id: z.string().uuid(),
  grantNumber: z.string().nullable(),
  applicationNumber: z.string(),
  title: z.string(),
  matchField: z.string(),                  // Which field matched
  matchSnippet: z.string(),                // Highlighted snippet
  score: z.number(),                       // Relevance score
});

const SearchResponse = z.object({
  data: z.array(SearchResult),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** Not cached (dynamic query results).  
**Legacy Endpoints Replaced:** `POST /assets/search_assets`

---

### 3.11 POST /api/v1/assets/validate

**Description:** Validate patent numbers and check their status in the system.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier (300 req/min)

**Request Body:**

```typescript
const ValidateAssetsRequest = z.object({
  patentNumbers: z.array(z.string()).min(1).max(100),
});
```

**Response (200):**

```typescript
const ValidationResult = z.object({
  patentNumber: z.string(),
  found: z.boolean(),
  grantNumber: z.string().nullable(),
  applicationNumber: z.string().nullable(),
  status: z.enum(['complete', 'broken', 'encumbered', 'not_found']),
});

const ValidateResponse = z.object({
  data: z.array(ValidationResult),
  totalFound: z.number().int(),
  totalNotFound: z.number().int(),
});
```

**Legacy Endpoints Replaced:** `POST /admin/validate`

---

## 4. Dashboard & Events Endpoints

Dashboard endpoints serve pre-computed organization-level intelligence (ownership trees, broken title analysis, summary metrics). These are the most-used endpoints — every login hits the dashboard summary.

Legacy system had ~13 dashboard + ~16 event endpoints with inconsistent naming — consolidated to 9 clean endpoints.

---

### 4.1 GET /api/v1/dashboards/summary

**Description:** Get organization-level dashboard metrics (the landing page data). This is the most frequently called endpoint — must return <200ms.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const DashboardSummary = z.object({
  data: z.object({
    // BR-043: Summary metrics
    totalAssets: z.number().int(),
    totalEntities: z.number().int(),
    totalCompanies: z.number().int(),
    totalTransactions: z.number().int(),
    totalEmployees: z.number().int(),
    totalParties: z.number().int(),
    totalActivities: z.number().int(),
    totalArrows: z.number().int(),
    // BR-037: Dashboard type breakdown
    completeChains: z.number().int(),      // type 0
    brokenChains: z.number().int(),        // type 1
    encumbrances: z.number().int(),        // type 18
    lawFirmInvolved: z.number().int(),     // type 20
    bankInvolved: z.number().int(),        // types 30, 33, 35, 36
    // Activity breakdown (BR-038: activities 11,12,13,16 grouped as 5)
    activityBreakdown: z.record(z.string(), z.number().int()),
    // Data freshness
    lastIngestionDate: z.string().datetime().nullable(),
    lastPipelineRun: z.string().datetime().nullable(),
  }),
});
```

**Cache Strategy:** Redis key `org:{id}:dashboard`. Invalidated only by new assignment ingestion for this org. Target: served from cache >95% of requests.  
**Business Rules:** BR-037 (dashboard type codes), BR-038 (activity grouping 11,12,13,16 → 5), BR-042 (org-level summary uses company_id=0), BR-043 (summary metric fields)  
**Legacy Endpoints Replaced:** `POST /dashboards/parties`, `POST /dashboards/kpi`, `POST /dashboards/counts` (3 endpoints → 1)

---

### 4.2 GET /api/v1/dashboards/trees

**Description:** List ownership trees for the organization, grouped by tab.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const TreesQuery = PaginationParams.extend({
  tab: z.number().int().min(0).max(3).optional(),  // BR-024–BR-030: tab filter
  // Tab 0: Employee assignments
  // Tab 1: Purchases, sales, mergers
  // Tab 2: Security, releases
  // Tab 3: Administrative (namechg, govern, correct, missing, other)
  treeType: z.number().int().min(0).max(13).optional(),  // BR-024–BR-030: specific type
});
```

**Response (200):**

```typescript
const TreeSummary = z.object({
  id: z.string().uuid(),
  entityName: z.string(),                  // Canonical entity name
  treeType: z.number().int().min(0).max(13),  // BR-024–BR-030
  tab: z.number().int().min(0).max(3),
  assetCount: z.number().int(),
  brokenTitleCount: z.number().int(),
  lastActivityDate: z.string().datetime().nullable(),
  color: z.string(),                       // BR-031
});

const TreesResponse = z.object({
  data: z.array(TreeSummary),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** Redis. Invalidated on new assignments for this org.  
**Business Rules:** BR-024–BR-031 (tree types 0-13, tabs 0-3, colors)  
**Legacy Endpoints Replaced:** `GET /events/tabs/:tabID` (multiple tab-specific endpoints → 1 with filter)

---

### 4.3 GET /api/v1/dashboards/trees/:treeId

**Description:** Get detailed ownership tree with full entity and asset breakdown.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const TreeDetail = z.object({
  data: z.object({
    id: z.string().uuid(),
    entityName: z.string(),
    treeType: z.number().int(),
    tab: z.number().int(),
    color: z.string(),
    assets: z.array(z.object({
      id: z.string().uuid(),
      grantNumber: z.string().nullable(),
      applicationNumber: z.string(),
      title: z.string(),
      status: z.enum(['complete', 'broken', 'encumbered']),
    })),
    // Aggregated transaction data for this tree
    transactionSummary: z.object({
      totalAssignments: z.number().int(),
      totalAssignors: z.number().int(),
      totalAssignees: z.number().int(),
      dateRange: z.object({
        earliest: z.string().datetime(),
        latest: z.string().datetime(),
      }),
    }),
  }),
});
```

**Legacy Endpoints Replaced:** `GET /events/tabs/:tabID/companies/:companyID/...`

---

### 4.4 GET /api/v1/dashboards/broken-titles

**Description:** List all assets with broken title chains in the organization.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const BrokenTitlesQuery = PaginationParams.extend({
  entityId: z.string().uuid().optional(),   // Filter by canonical entity
});
```

**Response (200):**

```typescript
const BrokenTitleItem = z.object({
  assetId: z.string().uuid(),
  grantNumber: z.string().nullable(),
  applicationNumber: z.string(),
  title: z.string(),
  currentAssignee: z.string().nullable(),
  chainBreakPoint: z.string().nullable(),   // Where the chain breaks
  missingLink: z.object({                   // BR-033: what's missing
    fromEntity: z.string(),
    toEntity: z.string(),
    gapDescription: z.string(),
  }).nullable(),
});

const BrokenTitlesResponse = z.object({
  data: z.array(BrokenTitleItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Business Rules:** BR-032 (broken = no continuous chain inventor→owner), BR-033 (chain continuity rule), BR-034 (employee assignments as chain starters), BR-035 (complete chain w/o employee start = broken), BR-036 (stored as dashboard_items.type=1)  
**Legacy Endpoints Replaced:** Part of dashboard items filtered by type=1

---

### 4.5 GET /api/v1/dashboards/timeline

**Description:** Get transaction timeline for the organization, showing chronological assignment activity.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const TimelineQuery = PaginationParams.extend({
  entityId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  conveyanceType: z.enum([
    'assignment', 'employee', 'govern', 'merger', 'namechg',
    'license', 'release', 'security', 'correct', 'missing',
  ]).optional(),
});
```

**Response (200):**

```typescript
const TimelineEntry = z.object({
  id: z.string().uuid(),
  rfId: z.string(),
  recordDate: z.string().datetime(),
  conveyanceType: z.string(),
  conveyanceText: z.string(),
  color: z.string(),                       // BR-031
  assignor: z.string(),
  assignee: z.string(),
  assetCount: z.number().int(),            // Patents in this transaction
});

const TimelineResponse = z.object({
  data: z.array(TimelineEntry),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** Redis. Invalidated on new assignments.  
**Legacy Endpoints Replaced:** `POST /dashboards/timeline`

---

### 4.6 GET /api/v1/dashboards/cpc-wordcloud

**Description:** Get CPC classification distribution for the organization (word cloud visualization data).  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const CpcWordcloudQuery = z.object({
  level: z.enum(['section', 'class', 'subclass']).default('subclass'),
  year: z.number().int().optional(),       // Filter by year
});
```

**Response (200):**

```typescript
const CpcWordcloudItem = z.object({
  code: z.string(),
  description: z.string().nullable(),
  count: z.number().int(),                 // Number of patents with this CPC
  weight: z.number(),                      // Normalized 0-1 for visualization
});

const CpcWordcloudResponse = z.object({
  data: z.array(CpcWordcloudItem),
});
```

**Cache Strategy:** Redis key `org:{id}:cpc-wordcloud:{level}:{year}`. Monthly TTL (matches CPC refresh).  
**Business Rules:** BR-056 (CPC data refresh cycle)  
**Legacy Endpoints Replaced:** `POST /assets/cpc`, `POST /assets/cpc/:year/:cpcCode`

---

### 4.7 GET /api/v1/events

**Description:** Unified event feed for the organization. Combines assignment events, maintenance events, and system events.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const EventsQuery = PaginationParams.extend({
  type: z.enum(['assignment', 'maintenance', 'pipeline', 'all']).default('all'),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});
```

**Response (200):**

```typescript
const EventItem = z.object({
  id: z.string().uuid(),
  type: z.enum(['assignment', 'maintenance', 'pipeline']),
  date: z.string().datetime(),
  title: z.string(),
  description: z.string(),
  assetId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

const EventsResponse = z.object({
  data: z.array(EventItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Legacy Endpoints Replaced:** `GET /events/tabs/:tabID` (multiple tab endpoints consolidated)

---

### 4.8 GET /api/v1/events/maintenance

**Description:** Maintenance fee events — abandoned, expired, and upcoming fees.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const MaintenanceEventsQuery = PaginationParams.extend({
  status: z.enum(['paid', 'due', 'surcharge', 'expired', 'all']).default('all'),
  feeWindow: z.enum(['3.5_year', '7.5_year', '11.5_year', 'all']).default('all'),
});
```

**Response (200):**

```typescript
const MaintenanceEventItem = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  grantNumber: z.string(),
  title: z.string(),
  eventCode: z.string(),
  eventDate: z.string().datetime(),
  feeWindow: z.enum(['3.5_year', '7.5_year', '11.5_year']),
  status: z.enum(['paid', 'due', 'surcharge', 'expired']),
  dueDate: z.string().datetime().nullable(),
});

const MaintenanceEventsResponse = z.object({
  data: z.array(MaintenanceEventItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** ETag. Updated weekly with maintenance fee ingestion.  
**Legacy Endpoints Replaced:** `POST /events/abandoned/maintainence/assets`

---

### 4.9 GET /api/v1/events/assignments

**Description:** Recent assignment/transaction events for the organization.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const RecentAssignmentsQuery = PaginationParams.extend({
  days: z.number().int().min(1).max(365).default(30),  // Lookback window
});
```

**Response (200):**

```typescript
const RecentAssignment = z.object({
  id: z.string().uuid(),
  rfId: z.string(),
  recordDate: z.string().datetime(),
  conveyanceType: z.string(),
  conveyanceText: z.string(),
  assignorName: z.string(),
  assigneeName: z.string(),
  affectedAssets: z.number().int(),
  color: z.string(),                       // BR-031
});

const RecentAssignmentsResponse = z.object({
  data: z.array(RecentAssignment),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Cache Strategy:** Redis. Short TTL (5 min) since this is recent-activity focused.  
**Legacy Endpoints Replaced:** Part of event tabs system

---

## 5. Organization & Company Endpoints

Organization endpoints manage tenants, their users, entities (canonical company names), and subsidiary companies. All queries are scoped by RLS to the authenticated user's organization.

Legacy system scattered org management across customer CRUD, entity normalization, and company tree operations — consolidated to 12 clean endpoints.

---

### 5.1 GET /api/v1/organizations/:orgId

**Description:** Get organization details and configuration.  
**Auth:** 🔑 Authenticated (must be member of this org; RLS enforced)  
**Rate Limit:** Standard (100 req/min)

**Path Parameters:**

```typescript
const OrgIdParam = z.object({
  orgId: z.string().uuid(),
});
```

**Response (200):**

```typescript
const OrganizationDetail = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    environmentMode: z.enum([
      'PRO', 'KPI', 'DASHBOARD', 'SAMPLE', 'SAMPLE-1', 'STANDARD',
    ]),                                    // BR-061
    logoUrl: z.string().url().nullable(),
    domain: z.string().nullable(),
    createdAt: z.string().datetime(),
    settings: z.object({
      darkMode: z.boolean(),               // BR-064
      slackConnected: z.boolean(),
      teamsConnected: z.boolean(),
      googleDriveConnected: z.boolean(),
    }),
    userCount: z.number().int(),
    entityCount: z.number().int(),
    assetCount: z.number().int(),
  }),
});
```

**Cache Strategy:** Redis key `org:{id}:detail`. Invalidated on org settings change.  
**Business Rules:** BR-061 (environment modes), BR-064 (dark mode)  
**Legacy Endpoints Replaced:** `GET /customers/:id`

---

### 5.2 PATCH /api/v1/organizations/:orgId

**Description:** Update organization settings.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier (300 req/min)

**Request Body:**

```typescript
const UpdateOrgRequest = z.object({
  name: z.string().min(1).max(255).optional(),
  environmentMode: z.enum([
    'PRO', 'KPI', 'DASHBOARD', 'SAMPLE', 'SAMPLE-1', 'STANDARD',
  ]).optional(),
  settings: z.object({
    darkMode: z.boolean().optional(),
  }).optional(),
});
```

**Response (200):** Same as `OrganizationDetail`.

**Side Effects:** Invalidates `org:{id}:detail` and `org:{id}:dashboard` caches.  
**Legacy Endpoints Replaced:** `PUT /customers/:id`

---

### 5.3 GET /api/v1/organizations/:orgId/entities

**Description:** List canonical entities (company names) in the organization, derived from Levenshtein name normalization.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const EntitiesQuery = PaginationParams.extend({
  search: z.string().max(255).optional(),
});
```

**Response (200):**

```typescript
const EntityItem = z.object({
  id: z.string().uuid(),
  canonicalName: z.string(),               // BR-019: highest occurrence count
  representativeId: z.string().uuid(),
  aliasCount: z.number().int(),
  assetCount: z.number().int(),
  lastActivityDate: z.string().datetime().nullable(),
});

const EntitiesResponse = z.object({
  data: z.array(EntityItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Business Rules:** BR-013–BR-020 (name normalization: suffix removal, Levenshtein grouping, canonical selection)  
**Legacy Endpoints Replaced:** `GET /admin/customers/:id/entities`

---

### 5.4 GET /api/v1/organizations/:orgId/entities/:entityId

**Description:** Get entity detail with all name variants and associated patents.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Response (200):**

```typescript
const EntityDetail = z.object({
  data: z.object({
    id: z.string().uuid(),
    canonicalName: z.string(),
    aliases: z.array(z.object({
      name: z.string(),
      occurrenceCount: z.number().int(),
      levenshteinDistance: z.number().int(),  // BR-018
    })),
    assets: z.array(z.object({
      id: z.string().uuid(),
      grantNumber: z.string().nullable(),
      applicationNumber: z.string(),
      title: z.string(),
      relationship: z.enum(['assignee', 'assignor', 'both']),
    })),
    totalAssets: z.number().int(),
  }),
});
```

**Business Rules:** BR-018 (Levenshtein threshold 3-5), BR-019 (canonical = highest count), BR-020 (sort by word count descending)  
**Legacy Endpoints Replaced:** Part of entity views in PT-Admin

---

### 5.5 POST /api/v1/organizations/:orgId/entities/normalize

**Description:** Trigger re-normalization of entity names for the organization. Runs the Levenshtein grouping pipeline asynchronously.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier. Max 1 concurrent normalization per org.

**Request Body:**

```typescript
const NormalizeRequest = z.object({
  threshold: z.number().int().min(1).max(10).default(5),  // BR-018
  dryRun: z.boolean().default(false),
});
```

**Response (202 — Accepted):**

```typescript
const NormalizeResponse = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    status: z.literal('queued'),
    estimatedDuration: z.string().nullable(),
  }),
});
```

**Async:** Background job via BullMQ. Monitor via SSE or admin ingestion status.  
**Business Rules:** BR-013–BR-020 (full normalization pipeline)  
**Legacy Endpoints Replaced:** `POST /admin/normalize`

---

### 5.6 GET /api/v1/organizations/:orgId/companies

**Description:** List companies/subsidiaries in the organization's monitored portfolio.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard

**Query Parameters:**

```typescript
const CompaniesQuery = PaginationParams.extend({
  search: z.string().max(255).optional(),
});
```

**Response (200):**

```typescript
const CompanyItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
  assetCount: z.number().int(),
  entityId: z.string().uuid().nullable(),
});

const CompaniesResponse = z.object({
  data: z.array(CompanyItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Legacy Endpoints Replaced:** `GET /companies`

---

### 5.7 POST /api/v1/organizations/:orgId/companies

**Description:** Add a company to the organization's monitored portfolio. Triggers enrichment (logo, domain) asynchronously.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const AddCompanyRequest = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().max(255).optional(),
});
```

**Response (201):**

```typescript
const AddCompanyResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    enrichmentJobId: z.string().uuid().nullable(),
  }),
});
```

**Side Effects:** Queues enrichment job (logo via RiteKit, domain via Clearbit — keys from secrets manager, fixing S-05).  
**Legacy Endpoints Replaced:** `POST /companies`

---

### 5.8 DELETE /api/v1/organizations/:orgId/companies/:companyId

**Description:** Remove a company from the monitored portfolio. Soft delete.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):**

```typescript
const DeleteCompanyResponse = z.object({
  data: z.object({ success: z.literal(true) }),
});
```

**Legacy Endpoints Replaced:** `DELETE /companies/:id`

---

### 5.9 GET /api/v1/organizations/:orgId/users

**Description:** List users in the organization.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):**

```typescript
const OrgUserItem = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['member', 'admin']),       // BR-048
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const OrgUsersResponse = z.object({
  data: z.array(OrgUserItem),
  total: z.number().int(),
});
```

**Business Rules:** BR-048 (admin type 0/1)  
**Legacy Endpoints Replaced:** Part of customer management in PT-Admin

---

### 5.10 POST /api/v1/organizations/:orgId/users

**Description:** Invite a user to the organization. Sends invitation email.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const InviteUserRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['member', 'admin']).default('member'),
});
```

**Response (201):**

```typescript
const InviteUserResponse = z.object({
  data: z.object({
    userId: z.string().uuid(),
    invitationSent: z.boolean(),
  }),
});
```

**Legacy Endpoints Replaced:** Part of customer management in PT-Admin

---

### 5.11 PATCH /api/v1/organizations/:orgId/users/:userId

**Description:** Update a user's role within the organization.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const UpdateUserRoleRequest = z.object({
  role: z.enum(['member', 'admin']),
});
```

**Response (200):** Same as `OrgUserItem`.

**Business Rules:** BR-048 (role types)  
**Legacy Endpoints Replaced:** Part of customer management

---

### 5.12 DELETE /api/v1/organizations/:orgId/users/:userId

**Description:** Remove a user from the organization. Revokes all tokens.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):**

```typescript
const RemoveUserResponse = z.object({
  data: z.object({ success: z.literal(true) }),
});
```

**Side Effects:** Invalidates all refresh tokens for this user. Clears session cache.  
**Legacy Endpoints Replaced:** Part of customer management

---

## 6. Admin Endpoints

Admin endpoints are restricted to Super Admin (type 9) users. These provide system-wide operations: managing all organizations, triggering pipelines, monitoring ingestion, and data quality fixes. These endpoints bypass RLS (super admin has cross-tenant access).

---

### 6.1 GET /api/v1/admin/organizations

**Description:** List all organizations in the system (super admin view).  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier (1000 req/min)

**Query Parameters:**

```typescript
const AdminOrgsQuery = PaginationParams.extend({
  search: z.string().max(255).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});
```

**Response (200):**

```typescript
const AdminOrgItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  environmentMode: z.string(),
  userCount: z.number().int(),
  assetCount: z.number().int(),
  lastPipelineRun: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  status: z.enum(['active', 'inactive']),
});

const AdminOrgsResponse = z.object({
  data: z.array(AdminOrgItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Legacy Endpoints Replaced:** `GET /admin/customers`

---

### 6.2 POST /api/v1/admin/organizations

**Description:** Create a new organization and provision it. Queues the initial data pipeline asynchronously. Replaces the legacy PHP pipeline trigger (eliminating S-01 command injection).  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Request Body:**

```typescript
const CreateOrgRequest = z.object({
  name: z.string().min(1).max(255),
  environmentMode: z.enum([
    'PRO', 'KPI', 'DASHBOARD', 'SAMPLE', 'SAMPLE-1', 'STANDARD',
  ]).default('PRO'),                       // BR-061
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(255),
  companies: z.array(z.string()).optional(),
});
```

**Response (201):**

```typescript
const CreateOrgResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    adminUserId: z.string().uuid(),
    pipelineJobId: z.string().uuid(),
    status: z.literal('provisioning'),
  }),
});
```

**Side Effects:** Creates org with RLS policies, creates admin user, sends invitation, queues initial pipeline (BR-060).  
**Business Rules:** BR-060 (pipeline execution), BR-061 (environment modes)  
**Legacy Endpoints Replaced:** `POST /admin/customers`

---

### 6.3 GET /api/v1/admin/organizations/:orgId

**Description:** Admin view of a specific organization with detailed status.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Response (200):**

```typescript
const AdminOrgDetail = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    environmentMode: z.string(),
    status: z.enum(['active', 'inactive', 'provisioning']),
    users: z.array(z.object({
      id: z.string().uuid(),
      email: z.string(),
      name: z.string(),
      role: z.string(),
      lastLoginAt: z.string().datetime().nullable(),
    })),
    lastPipelineRun: z.string().datetime().nullable(),
    pipelineStatus: z.enum(['idle', 'running', 'failed']),
    assetCount: z.number().int(),
    entityCount: z.number().int(),
    transactionCount: z.number().int(),
    brokenTitleCount: z.number().int(),
    activeShareLinks: z.number().int(),
    createdAt: z.string().datetime(),
  }),
});
```

**Legacy Endpoints Replaced:** `GET /admin/customers/:id`

---

### 6.4 POST /api/v1/admin/organizations/:orgId/rebuild-tree

**Description:** Trigger ownership tree rebuild for a specific organization.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier. Max 1 concurrent rebuild per org.

**Response (202 — Accepted):**

```typescript
const RebuildTreeResponse = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    status: z.literal('queued'),
  }),
});
```

**Business Rules:** BR-024–BR-030 (tree types), BR-031 (color mappings)  
**Legacy Endpoints Replaced:** `GET /admin/customers/:id/create_tree`

---

### 6.5 POST /api/v1/admin/organizations/:orgId/rebuild-pipeline

**Description:** Run the full 8-step pipeline for an organization. Supports restarting from a specific step.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier. Max 1 concurrent pipeline per org.

**Request Body:**

```typescript
const RebuildPipelineRequest = z.object({
  startFromStep: z.enum([
    'classify', 'flag', 'tree', 'timeline',
    'broken_title', 'dashboard', 'summary', 'generate_json',
  ]).default('classify'),
});
```

**Response (202 — Accepted):**

```typescript
const RebuildPipelineResponse = z.object({
  data: z.object({
    pipelineId: z.string().uuid(),
    steps: z.array(z.string()),
    status: z.literal('queued'),
    estimatedDuration: z.string().nullable(),
  }),
});
```

**Business Rules:** BR-060 (pipeline order: classify → flag → [tree, timeline] → broken_title → [dashboard, summary] → generate_json)  
**Legacy Endpoints Replaced:** Customer pipeline via PHP exec (S-01 eliminated)

---

### 6.6 GET /api/v1/admin/transactions

**Description:** Review transactions system-wide (cross-tenant). For data quality review.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Query Parameters:**

```typescript
const AdminTransactionsQuery = PaginationParams.extend({
  orgId: z.string().uuid().optional(),
  conveyanceType: z.enum([
    'assignment', 'employee', 'govern', 'merger', 'namechg',
    'license', 'release', 'security', 'correct', 'missing',
  ]).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  flagged: z.boolean().optional(),
});
```

**Response (200):**

```typescript
const AdminTransactionItem = z.object({
  id: z.string().uuid(),
  rfId: z.string(),
  orgId: z.string().uuid(),
  orgName: z.string(),
  conveyanceType: z.string(),
  conveyanceText: z.string(),
  recordDate: z.string().datetime(),
  assignorName: z.string(),
  assigneeName: z.string(),
  affectedAssets: z.number().int(),
});

const AdminTransactionsResponse = z.object({
  data: z.array(AdminTransactionItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Legacy Endpoints Replaced:** `GET /admin/transactions`

---

### 6.7 POST /api/v1/admin/fix-items

**Description:** Apply data quality fixes — resolve flagged data inconsistencies.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Request Body:**

```typescript
const FixItemsRequest = z.object({
  orgId: z.string().uuid(),
  fixType: z.enum(['reclass', 'renormalize', 'rebuild_dashboard', 'fix_broken_chain']),
  targetIds: z.array(z.string().uuid()).optional(),  // Specific items to fix, or all if omitted
});
```

**Response (202 — Accepted):**

```typescript
const FixItemsResponse = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    fixType: z.string(),
    itemCount: z.number().int(),
    status: z.literal('queued'),
  }),
});
```

**Legacy Endpoints Replaced:** `POST /admin/fix_items`

---

### 6.8 GET /api/v1/admin/ingestion/status

**Description:** Get overall ingestion pipeline status — last successful run per data source, current running jobs, error summary.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Response (200):**

```typescript
const IngestionStatusResponse = z.object({
  data: z.object({
    sources: z.array(z.object({
      name: z.string(),                    // e.g., 'assignments', 'grants', 'applications'
      schedule: z.string(),                // e.g., 'daily', 'weekly-tue', 'monthly'
      lastSuccessAt: z.string().datetime().nullable(),
      lastFailureAt: z.string().datetime().nullable(),
      lastError: z.string().nullable(),
      status: z.enum(['healthy', 'stale', 'failing']),
      nextRunAt: z.string().datetime().nullable(),
    })),
    activeJobs: z.number().int(),
    failedJobsLast24h: z.number().int(),
    queueDepth: z.number().int(),
  }),
});
```

**Business Rules:** BR-054–BR-059 (ingestion schedules and rules)  
**Legacy Endpoints Replaced:** None (new — replaces manual monitoring)

---

### 6.9 GET /api/v1/admin/ingestion/jobs

**Description:** List ingestion jobs with filtering. Powered by BullMQ.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Query Parameters:**

```typescript
const IngestionJobsQuery = PaginationParams.extend({
  status: z.enum(['waiting', 'active', 'completed', 'failed', 'all']).default('all'),
  jobType: z.string().optional(),          // e.g., 'ingest:assignments', 'pipeline:org:*'
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});
```

**Response (200):**

```typescript
const IngestionJobItem = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(['waiting', 'active', 'completed', 'failed', 'delayed']),
  progress: z.number().min(0).max(100),
  data: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  failedReason: z.string().nullable(),
  attemptsMade: z.number().int(),
  duration: z.number().int().nullable(),   // milliseconds
});

const IngestionJobsResponse = z.object({
  data: z.array(IngestionJobItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Legacy Endpoints Replaced:** None (new — BullMQ dashboard API)

---

### 6.10 POST /api/v1/admin/ingestion/jobs/:jobId/retry

**Description:** Retry a failed ingestion job.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Response (200):**

```typescript
const RetryJobResponse = z.object({
  data: z.object({
    jobId: z.string(),
    status: z.literal('waiting'),
    message: z.string(),
  }),
});
```

**Errors:**
- `404 NOT_FOUND` — Job not found
- `409 CONFLICT` — Job is not in a failed state

**Legacy Endpoints Replaced:** None (new feature)

---

### 6.11 GET /api/v1/admin/ingestion/freshness

**Description:** Data freshness report — how current each data source is.  
**Auth:** ⚡ Super Admin  
**Rate Limit:** Super Admin tier

**Response (200):**

```typescript
const FreshnessItem = z.object({
  source: z.string(),
  expectedFrequency: z.string(),           // 'daily', 'weekly', 'monthly'
  lastDataDate: z.string().datetime().nullable(),  // Most recent data point
  lastIngestionDate: z.string().datetime().nullable(),
  staleDays: z.number().int(),
  status: z.enum(['fresh', 'stale', 'critical']),
  recordCount: z.number().int(),           // Total records from this source
});

const FreshnessResponse = z.object({
  data: z.array(FreshnessItem),
});
```

**Business Rules:** BR-054 (daily assignments), BR-055 (weekly biblio), BR-056 (monthly CPC)  
**Legacy Endpoints Replaced:** None (new feature)

---

## 7. Share & Integration Endpoints

Share endpoints manage public share links for the ownership diagram (the "hero feature"). The legacy system had critical vulnerabilities where share links granted full admin access (S-03, BR-045) and never expired (S-21, BR-046). The new design scopes shares to specific assets with configurable expiry.

Integration endpoints manage third-party connections (Slack, Teams, Google Drive).

---

### 7.1 POST /api/v1/shares

**Description:** Create a share link scoped to specific assets. Returns a share code for the public URL.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const CreateShareRequest = z.object({
  name: z.string().min(1).max(255),        // Descriptive name for management
  assetIds: z.array(z.string().uuid()).min(1).max(100),  // Scoped to these assets ONLY
  expiresIn: z.enum([
    '1h', '24h', '7d', '30d', '90d', 'never',
  ]).default('30d'),                       // Fixing BR-046: configurable expiry
  maxUses: z.number().int().min(1).max(10000).nullable().default(null),  // Usage limit
  allowDiagram: z.boolean().default(true),
  allowAssetList: z.boolean().default(true),
  allowConnections: z.boolean().default(false),
});
```

**Response (201):**

```typescript
const CreateShareResponse = z.object({
  data: z.object({
    id: z.string().uuid(),
    code: z.string(),                      // BR-044: CUID2 (24-32 chars)
    url: z.string().url(),                 // Full share URL
    expiresAt: z.string().datetime().nullable(),
    maxUses: z.number().int().nullable(),
    permissions: z.object({
      diagram: z.boolean(),
      assetList: z.boolean(),
      connections: z.boolean(),
    }),
  }),
});
```

**Security:** Share code generates a scoped read-only token — NOT an admin JWT (fixing S-03, BR-045). Token is limited to the specified assets and permissions.  
**Business Rules:** BR-044 (CUID2 code), BR-045 (scoped, not admin — SECURITY FIX), BR-046 (expiry — SECURITY FIX), BR-047 (IP logging)  
**Legacy Endpoints Replaced:** `POST /share`

---

### 7.2 GET /api/v1/shares

**Description:** List share links for the organization.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):**

```typescript
const ShareItem = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  url: z.string().url(),
  assetCount: z.number().int(),
  expiresAt: z.string().datetime().nullable(),
  maxUses: z.number().int().nullable(),
  currentUses: z.number().int(),
  isActive: z.boolean(),                   // False if expired or max uses reached
  createdAt: z.string().datetime(),
  lastAccessedAt: z.string().datetime().nullable(),
});

const SharesResponse = z.object({
  data: z.array(ShareItem),
  total: z.number().int(),
});
```

**Legacy Endpoints Replaced:** Part of share management in PT-App

---

### 7.3 PATCH /api/v1/shares/:shareId

**Description:** Update share link settings (expiry, assets, permissions).  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const UpdateShareRequest = z.object({
  name: z.string().min(1).max(255).optional(),
  assetIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  expiresIn: z.enum(['1h', '24h', '7d', '30d', '90d', 'never']).optional(),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
  allowDiagram: z.boolean().optional(),
  allowAssetList: z.boolean().optional(),
  allowConnections: z.boolean().optional(),
});
```

**Response (200):** Same as `ShareItem`.

**Legacy Endpoints Replaced:** None (new — shares were immutable in legacy)

---

### 7.4 DELETE /api/v1/shares/:shareId

**Description:** Revoke a share link immediately.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):**

```typescript
const RevokeShareResponse = z.object({
  data: z.object({ success: z.literal(true) }),
});
```

**Security:** Immediately invalidates the share token. Any outstanding share URLs will return 404. Fixing S-21 (shares were permanent in legacy).  
**Legacy Endpoints Replaced:** None (new — revocation was impossible in legacy)

---

### 7.5 GET /api/v1/shared/:code

**Description:** Public endpoint — get shared organization info and list of allowed assets. This is the entry point for share link viewers.  
**Auth:** 🔓 Public  
**Rate Limit:** Share Viewer tier (30 req/min)

**Path Parameters:**

```typescript
const ShareCodeParam = z.object({
  code: z.string().min(20).max(40),        // BR-044: CUID2
});
```

**Response (200):**

```typescript
const SharedOrgInfo = z.object({
  data: z.object({
    organizationName: z.string(),
    logoUrl: z.string().url().nullable(),
    permissions: z.object({
      diagram: z.boolean(),
      assetList: z.boolean(),
      connections: z.boolean(),
    }),
    assetCount: z.number().int(),          // Number of shared assets
  }),
});
```

**Errors:**
- `404 NOT_FOUND` — Invalid, expired, or revoked share code
- `410 GONE` — Share link has reached max usage limit

**Side Effects:** Logs IP address and access time (BR-047).  
**Business Rules:** BR-044 (CUID2 code), BR-047 (IP logging), BR-063 (URL pattern)  
**Legacy Endpoints Replaced:** `GET /share/illustrate/show/:code`

---

### 7.6 GET /api/v1/shared/:code/assets

**Description:** Public endpoint — list assets included in this share link.  
**Auth:** 🔓 Public  
**Rate Limit:** Share Viewer tier

**Query Parameters:**

```typescript
const SharedAssetsQuery = PaginationParams;
```

**Response (200):**

```typescript
const SharedAssetItem = z.object({
  id: z.string().uuid(),
  grantNumber: z.string().nullable(),
  applicationNumber: z.string(),
  title: z.string(),
  status: z.enum(['complete', 'broken', 'encumbered']),
  currentAssignee: z.string().nullable(),
});

const SharedAssetsResponse = z.object({
  data: z.array(SharedAssetItem),
  cursor: z.object({
    next: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  total: z.number().int(),
});
```

**Security:** Only returns assets explicitly included in the share link. RLS not used — share token contains asset ID allowlist.  
**Legacy Endpoints Replaced:** `GET /share/:code/:type`

---

### 7.7 GET /api/v1/shared/:code/assets/:assetId/diagram

**Description:** Public endpoint — get ownership diagram JSON for a shared asset. This is the "hero feature" public view.  
**Auth:** 🔓 Public  
**Rate Limit:** Share Viewer tier

**Response (200):** Same as `DiagramResponse` from Section 3.8.

**Errors:**
- `403 FORBIDDEN` — Asset not included in this share link, or diagram permission not granted
- `404 NOT_FOUND` — Invalid share code or asset

**Business Rules:** BR-024–BR-031 (tree/diagram data), BR-045 (scoped access — only allowed assets)  
**Legacy Endpoints Replaced:** `GET /share/illustration/:asset/:code`

---

### 7.8 GET /api/v1/shared/:code/assets/:assetId/connections

**Description:** Public endpoint — get assignment connection data for popup display.  
**Auth:** 🔓 Public  
**Rate Limit:** Share Viewer tier

**Response (200):**

```typescript
const ConnectionData = z.object({
  data: z.object({
    rfId: z.string(),
    conveyanceText: z.string(),
    conveyanceType: z.string(),
    recordDate: z.string().datetime(),
    executionDate: z.string().datetime().nullable(),
    assignors: z.array(z.object({
      name: z.string(),
    })),
    assignees: z.array(z.object({
      name: z.string(),
    })),
    color: z.string(),
  }),
});
```

**Errors:**
- `403 FORBIDDEN` — Connections permission not granted on this share link

**Legacy Endpoints Replaced:** `GET /connection/:popuptop`

---

### 7.9 POST /api/v1/integrations/slack/connect

**Description:** Connect a Slack workspace to the organization using OAuth2.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const SlackConnectRequest = z.object({
  code: z.string(),                        // Slack OAuth2 authorization code
  redirectUri: z.string().url(),
});
```

**Response (200):**

```typescript
const SlackConnectResponse = z.object({
  data: z.object({
    connected: z.literal(true),
    workspaceName: z.string(),
    channelCount: z.number().int(),
  }),
});
```

**Security:** Slack tokens stored encrypted in database, never exposed to client.  
**Legacy Endpoints Replaced:** Slack integration setup

---

### 7.10 DELETE /api/v1/integrations/slack

**Description:** Disconnect Slack workspace.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):**

```typescript
const DisconnectResponse = z.object({
  data: z.object({ success: z.literal(true) }),
});
```

**Side Effects:** Revokes Slack OAuth token.  
**Legacy Endpoints Replaced:** None (new — disconnect was not implemented)

---

### 7.11 POST /api/v1/integrations/slack/notify

**Description:** Send a notification to the connected Slack channel.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard. Max 10 notifications/hour per org.

**Request Body:**

```typescript
const SlackNotifyRequest = z.object({
  channel: z.string(),
  message: z.string().max(4000),
  assetIds: z.array(z.string().uuid()).optional(),  // Link to specific assets
});
```

**Response (200):**

```typescript
const SlackNotifyResponse = z.object({
  data: z.object({
    sent: z.literal(true),
    timestamp: z.string(),
  }),
});
```

**Legacy Endpoints Replaced:** Slack notification trigger

---

### 7.12 POST /api/v1/integrations/google-drive/connect

**Description:** Connect Google Drive using OAuth2 PKCE (fixing S-22: tokens not in query strings).  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const GoogleDriveConnectRequest = z.object({
  code: z.string(),
  codeVerifier: z.string(),
  redirectUri: z.string().url(),
});
```

**Response (200):**

```typescript
const GoogleDriveConnectResponse = z.object({
  data: z.object({
    connected: z.literal(true),
    email: z.string().email(),
  }),
});
```

**Legacy Endpoints Replaced:** Google integration

---

### 7.13 POST /api/v1/integrations/google-drive/export

**Description:** Export patent data to a Google Sheet.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** Standard. Max 5 exports/hour per user.

**Request Body:**

```typescript
const GoogleExportRequest = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(1000),
  includeFields: z.array(z.enum([
    'bibliographic', 'assignments', 'maintenance', 'cpc', 'family',
  ])).default(['bibliographic', 'assignments']),
  sheetName: z.string().max(100).default('PatenTrack Export'),
});
```

**Response (202 — Accepted):**

```typescript
const GoogleExportResponse = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    status: z.literal('processing'),
    estimatedRows: z.number().int(),
  }),
});
```

**Async:** Export runs in background. Completion notification via SSE.  
**Legacy Endpoints Replaced:** `POST /google/create_sheet`

---

### 7.14 POST /api/v1/integrations/teams/connect

**Description:** Connect Microsoft Teams.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Request Body:**

```typescript
const TeamsConnectRequest = z.object({
  code: z.string(),
  codeVerifier: z.string(),
  redirectUri: z.string().url(),
});
```

**Response (200):**

```typescript
const TeamsConnectResponse = z.object({
  data: z.object({
    connected: z.literal(true),
    tenantName: z.string(),
  }),
});
```

**Legacy Endpoints Replaced:** Teams integration

---

### 7.15 DELETE /api/v1/integrations/teams

**Description:** Disconnect Microsoft Teams.  
**Auth:** 👑 Admin  
**Rate Limit:** Admin tier

**Response (200):** Same as `DisconnectResponse`.

**Legacy Endpoints Replaced:** None (new)

---

### 7.16 GET /api/v1/events/stream

**Description:** Server-Sent Events (SSE) stream for real-time notifications. Authenticated, filtered by user's organization.  
**Auth:** 🔑 Authenticated  
**Rate Limit:** 1 connection per user

**Query Parameters:**

```typescript
const SseQuery = z.object({
  lastEventId: z.string().optional(),      // Resume from last received event
});
```

**Response (200 — text/event-stream):**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: ingestion-progress
id: evt_abc123
data: {"jobId":"...","step":"classify","progress":45}

event: new-assignments
id: evt_def456
data: {"orgId":"...","count":12,"refreshNeeded":true}

event: dashboard-refresh
id: evt_ghi789
data: {"orgId":"...","dataType":"tree"}

event: pipeline-complete
id: evt_jkl012
data: {"orgId":"...","status":"completed","duration":45000}
```

**Security:** Connection requires valid JWT via cookie. Events filtered to user's org only. Auto-reconnect with `Last-Event-ID` for missed events. Fixing S-16 (legacy WebSocket was unauthenticated).  
**Legacy Endpoints Replaced:** Socket.IO (PT-API, unauthenticated) + Pusher.js (PT-Admin)

---

## Appendix A: Endpoint Summary

Complete list of all API endpoints (70 total — consolidated from 388 legacy endpoints).

| # | Method | Path | Auth | Section |
|---|--------|------|------|---------|
| **Auth (11)** | | | | |
| 1 | POST | `/api/v1/auth/login` | 🔓 | 2.1 |
| 2 | POST | `/api/v1/auth/refresh` | 🔑 | 2.2 |
| 3 | POST | `/api/v1/auth/logout` | 🔑 | 2.3 |
| 4 | POST | `/api/v1/auth/register` | 🔓 | 2.4 |
| 5 | POST | `/api/v1/auth/verify-email` | 🔓 | 2.5 |
| 6 | POST | `/api/v1/auth/forgot-password` | 🔓 | 2.6 |
| 7 | POST | `/api/v1/auth/reset-password` | 🔓 | 2.7 |
| 8 | POST | `/api/v1/auth/oauth/google` | 🔓 | 2.8 |
| 9 | POST | `/api/v1/auth/oauth/microsoft` | 🔓 | 2.9 |
| 10 | POST | `/api/v1/auth/mfa/setup` | 🔑 | 2.10 |
| 11 | POST | `/api/v1/auth/mfa/verify` | 🔓 | 2.11 |
| **Assets (11)** | | | | |
| 12 | GET | `/api/v1/assets` | 🔑 | 3.1 |
| 13 | GET | `/api/v1/assets/:id` | 🔑 | 3.2 |
| 14 | GET | `/api/v1/assets/:id/assignments` | 🔑 | 3.3 |
| 15 | GET | `/api/v1/assets/:id/family` | 🔑 | 3.4 |
| 16 | GET | `/api/v1/assets/:id/cpc` | 🔑 | 3.5 |
| 17 | GET | `/api/v1/assets/:id/maintenance` | 🔑 | 3.6 |
| 18 | GET | `/api/v1/assets/:id/citations` | 🔑 | 3.7 |
| 19 | GET | `/api/v1/assets/:id/diagram` | 🔑 | 3.8 |
| 20 | GET | `/api/v1/assets/:id/pdf` | 🔑 | 3.9 |
| 21 | GET | `/api/v1/assets/search` | 🔑 | 3.10 |
| 22 | POST | `/api/v1/assets/validate` | 👑 | 3.11 |
| **Dashboards & Events (9)** | | | | |
| 23 | GET | `/api/v1/dashboards/summary` | 🔑 | 4.1 |
| 24 | GET | `/api/v1/dashboards/trees` | 🔑 | 4.2 |
| 25 | GET | `/api/v1/dashboards/trees/:treeId` | 🔑 | 4.3 |
| 26 | GET | `/api/v1/dashboards/broken-titles` | 🔑 | 4.4 |
| 27 | GET | `/api/v1/dashboards/timeline` | 🔑 | 4.5 |
| 28 | GET | `/api/v1/dashboards/cpc-wordcloud` | 🔑 | 4.6 |
| 29 | GET | `/api/v1/events` | 🔑 | 4.7 |
| 30 | GET | `/api/v1/events/maintenance` | 🔑 | 4.8 |
| 31 | GET | `/api/v1/events/assignments` | 🔑 | 4.9 |
| **Organizations (12)** | | | | |
| 32 | GET | `/api/v1/organizations/:orgId` | 🔑 | 5.1 |
| 33 | PATCH | `/api/v1/organizations/:orgId` | 👑 | 5.2 |
| 34 | GET | `/api/v1/organizations/:orgId/entities` | 🔑 | 5.3 |
| 35 | GET | `/api/v1/organizations/:orgId/entities/:entityId` | 🔑 | 5.4 |
| 36 | POST | `/api/v1/organizations/:orgId/entities/normalize` | 👑 | 5.5 |
| 37 | GET | `/api/v1/organizations/:orgId/companies` | 🔑 | 5.6 |
| 38 | POST | `/api/v1/organizations/:orgId/companies` | 👑 | 5.7 |
| 39 | DELETE | `/api/v1/organizations/:orgId/companies/:companyId` | 👑 | 5.8 |
| 40 | GET | `/api/v1/organizations/:orgId/users` | 👑 | 5.9 |
| 41 | POST | `/api/v1/organizations/:orgId/users` | 👑 | 5.10 |
| 42 | PATCH | `/api/v1/organizations/:orgId/users/:userId` | 👑 | 5.11 |
| 43 | DELETE | `/api/v1/organizations/:orgId/users/:userId` | 👑 | 5.12 |
| **Admin (11)** | | | | |
| 44 | GET | `/api/v1/admin/organizations` | ⚡ | 6.1 |
| 45 | POST | `/api/v1/admin/organizations` | ⚡ | 6.2 |
| 46 | GET | `/api/v1/admin/organizations/:orgId` | ⚡ | 6.3 |
| 47 | POST | `/api/v1/admin/organizations/:orgId/rebuild-tree` | ⚡ | 6.4 |
| 48 | POST | `/api/v1/admin/organizations/:orgId/rebuild-pipeline` | ⚡ | 6.5 |
| 49 | GET | `/api/v1/admin/transactions` | ⚡ | 6.6 |
| 50 | POST | `/api/v1/admin/fix-items` | ⚡ | 6.7 |
| 51 | GET | `/api/v1/admin/ingestion/status` | ⚡ | 6.8 |
| 52 | GET | `/api/v1/admin/ingestion/jobs` | ⚡ | 6.9 |
| 53 | POST | `/api/v1/admin/ingestion/jobs/:jobId/retry` | ⚡ | 6.10 |
| 54 | GET | `/api/v1/admin/ingestion/freshness` | ⚡ | 6.11 |
| **Share (8)** | | | | |
| 55 | POST | `/api/v1/shares` | 👑 | 7.1 |
| 56 | GET | `/api/v1/shares` | 👑 | 7.2 |
| 57 | PATCH | `/api/v1/shares/:shareId` | 👑 | 7.3 |
| 58 | DELETE | `/api/v1/shares/:shareId` | 👑 | 7.4 |
| 59 | GET | `/api/v1/shared/:code` | 🔓 | 7.5 |
| 60 | GET | `/api/v1/shared/:code/assets` | 🔓 | 7.6 |
| 61 | GET | `/api/v1/shared/:code/assets/:assetId/diagram` | 🔓 | 7.7 |
| 62 | GET | `/api/v1/shared/:code/assets/:assetId/connections` | 🔓 | 7.8 |
| **Integrations (7)** | | | | |
| 63 | POST | `/api/v1/integrations/slack/connect` | 👑 | 7.9 |
| 64 | DELETE | `/api/v1/integrations/slack` | 👑 | 7.10 |
| 65 | POST | `/api/v1/integrations/slack/notify` | 🔑 | 7.11 |
| 66 | POST | `/api/v1/integrations/google-drive/connect` | 👑 | 7.12 |
| 67 | POST | `/api/v1/integrations/google-drive/export` | 🔑 | 7.13 |
| 68 | POST | `/api/v1/integrations/teams/connect` | 👑 | 7.14 |
| 69 | DELETE | `/api/v1/integrations/teams` | 👑 | 7.15 |
| **Real-Time (1)** | | | | |
| 70 | GET | `/api/v1/events/stream` | 🔑 | 7.16 |

**Total: 70 endpoints** (down from 388 legacy endpoints — 82% reduction)

---

## Appendix B: Legacy Endpoint Mapping

Maps key legacy endpoints to their new replacements.

| Legacy Endpoint | Legacy App | New Endpoint | Notes |
|----------------|-----------|-------------|-------|
| `POST /signin` | PT-API | `POST /auth/login` | |
| `POST /signin/refresh` | PT-API | `POST /auth/refresh` | Fixed S-02 (signature verification) |
| `POST /signup` | PT-API | `POST /auth/register` | Added password complexity (S-14) |
| `POST /verify` | PT-API | `POST /auth/verify-email` | Upgraded code length (S-24) |
| `POST /forget` | PT-API | `POST /auth/forgot-password` | |
| `POST /reset` | PT-API | `POST /auth/reset-password` | |
| `POST /google/signin` | PT-API | `POST /auth/oauth/google` | PKCE flow (S-22) |
| `POST /microsoft/signin` | PT-API | `POST /auth/oauth/microsoft` | PKCE flow |
| `GET /assets/collections/...` | PT-API | `GET /assets` | Multiple endpoints → 1 |
| `GET /assets/:asset` | PT-API | `GET /assets/:id` | Clean separation of concerns |
| `POST /assets/search_assets` | PT-API | `GET /assets/search` | GET for idempotent search |
| `GET /family/:applicationNumber` | PT-API | `GET /assets/:id/family` | 3 family endpoints → 1 |
| `GET /family/epo/grant/:num` | PT-API | `GET /assets/:id/family` | Consolidated |
| `GET /family/list/:num` | PT-API | `GET /assets/:id/family` | Consolidated |
| `POST /assets/cpc` | PT-API | `GET /assets/:id/cpc` + `GET /dashboards/cpc-wordcloud` | Split: per-asset vs org-wide |
| `POST /events/filed_assets_events` | PT-API | `GET /assets/:id/maintenance` | |
| `GET /assets/:num/:type/outsource` | PT-API | `GET /assets/:id/citations` | |
| `POST /citation` | PT-API | `GET /assets/:id/citations` | 2 → 1 |
| `POST /dashboards/parties` | PT-API | `GET /dashboards/summary` | 3 dashboard endpoints → 1 |
| `POST /dashboards/kpi` | PT-API | `GET /dashboards/summary` | Consolidated |
| `POST /dashboards/counts` | PT-API | `GET /dashboards/summary` | Consolidated |
| `POST /dashboards/timeline` | PT-API | `GET /dashboards/timeline` | GET for idempotent |
| `GET /events/tabs/:tabID` | PT-API | `GET /dashboards/trees` + `GET /events` | Split: trees vs events |
| `POST /events/abandoned/maintainence/assets` | PT-API | `GET /events/maintenance` | |
| `GET /customers/:id` | PT-API | `GET /organizations/:orgId` | |
| `PUT /customers/:id` | PT-API | `PATCH /organizations/:orgId` | PATCH for partial update |
| `GET /admin/customers/:id/entities` | PT-API | `GET /organizations/:orgId/entities` | |
| `POST /admin/normalize` | PT-API | `POST /organizations/:orgId/entities/normalize` | Async (BullMQ) |
| `GET /companies` | PT-API | `GET /organizations/:orgId/companies` | Scoped to org |
| `POST /companies` | PT-API | `POST /organizations/:orgId/companies` | |
| `DELETE /companies/:id` | PT-API | `DELETE /organizations/:orgId/companies/:companyId` | |
| `GET /admin/customers` | PT-Admin | `GET /admin/organizations` | |
| `POST /admin/customers` | PT-Admin | `POST /admin/organizations` | No more PHP exec (S-01) |
| `GET /admin/customers/:id/create_tree` | PT-Admin | `POST /admin/organizations/:orgId/rebuild-tree` | POST for side-effecting |
| `GET /admin/transactions` | PT-Admin | `GET /admin/transactions` | |
| `POST /admin/fix_items` | PT-Admin | `POST /admin/fix-items` | |
| `POST /admin/validate` | PT-Admin | `POST /assets/validate` | Moved from admin to assets |
| `GET /share/illustrate/show/:code` | PT-Share | `GET /shared/:code` | Scoped token (S-03 fix) |
| `GET /share/:code/:type` | PT-Share | `GET /shared/:code/assets` | |
| `GET /share/illustration/:asset/:code` | PT-Share | `GET /shared/:code/assets/:assetId/diagram` | |
| `GET /connection/:popuptop` | PT-Share | `GET /shared/:code/assets/:assetId/connections` | |
| `POST /share` | PT-API | `POST /shares` | Scoped, expiring (S-03, S-21) |
| `POST /google/create_sheet` | PT-API | `POST /integrations/google-drive/export` | Async |
| Socket.IO (all events) | PT-API | `GET /events/stream` | SSE, authenticated (S-16) |
| Pusher.js (all events) | PT-Admin | `GET /events/stream` | Unified with SSE |
| `exec()` PHP bridge (17 endpoints) | PT-API | **Eliminated** | S-01 fix — no PHP |
| ~200 dead endpoints | PT-API | **Eliminated** | Not reimplemented |

---

## Cross-References

- **Domain Model:** `docs/design/01-domain-model.md` — Schema entities referenced in response schemas
- **System Architecture:** `docs/design/02-system-architecture.md` — Section 3 (Auth), Section 5 (Caching), Section 6 (Real-Time/SSE), Section 7 (API Principles), Section 9 (Security)
- **Business Rules:** `docs/analysis/07-cross-application-summary.md` — Section 6 (BR-001 through BR-065)
- **Security Vulnerabilities:** `docs/analysis/07-cross-application-summary.md` — Section 5 (S-01 through S-30)

---

**Document Status:** Complete  
**Next:** `docs/design/04-frontend-architecture.md` (Frontend architecture)
