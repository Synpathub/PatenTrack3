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

## Cross-References

- **Domain Model:** `docs/design/01-domain-model.md` — Schema entities referenced in response schemas
- **System Architecture:** `docs/design/02-system-architecture.md` — Section 3 (Auth), Section 5 (Caching), Section 7 (API Principles)
- **Business Rules:** `docs/analysis/07-cross-application-summary.md` — Section 6 (BR-001 through BR-065)

---

**Document Status:** Part A Complete — Sections 1-4  
**Next:** Part B will add Sections 5 (Organization & Company Endpoints), 6 (Admin Endpoints), 7 (Share & Integration Endpoints), plus Appendix A (Endpoint Summary) and Appendix B (Legacy Mapping)
