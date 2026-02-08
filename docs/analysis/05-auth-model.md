# PT-API Authentication & Authorization Model

**Repository:** /tmp/PT-API  
**Analysis Date:** December 2024  

---

## Executive Summary

PT-API implements a **hybrid authentication system** with three authentication flows:

1. **JWT Token Authentication** - Username/password or email verification  
2. **Share Link Authentication** - Public access via unique codes  
3. **OAuth2 Integration** - Slack, Microsoft, Google  

### Security Posture: **MEDIUM-HIGH RISK**

**Critical Issues:**
- 🔴 Command injection in PHP script execution (CVSS 9.8)
- 🔴 Insecure token refresh (no signature verification)
- 🔴 Missing resource-level authorization
- 🔴 Share links grant full org access without expiration
- 🔴 Database credentials stored in plaintext

---

## 1. JWT Token Authentication

### Token Structure

**Algorithm:** HS256 (HMAC SHA-256)  
**Secret:** `process.env.SECRET` || `'p@nt3nt8@60'` ⚠️ Hardcoded fallback  
**Expiry:** 24 hours  

**Payload:**
```javascript
{
  id: user_id,
  orgId: organisation_id,
  org_type: organisation_type,
  subscription: subscribtion_level,
  iat: issued_timestamp,
  expired: expiry_timestamp,
  show_other_companies: 0|1,
  share_code: '' | '<code>'
}
```

### Token Generation (login.js:173-175)

```javascript
const token = jwt.sign(
  { id, orgId, subscription, iat, expired }, 
  config.config.secret, 
  { expiresIn: 86400 }
);
```

### Token Verification (verifyJwtToken.js:11-41)

**Flow:**
1. Extract from `req.headers['x-auth-token']`
2. Verify signature with `jwt.verify()`
3. Database validation: Check user exists and status=0
4. Inject `req.userId`, `req.orgId`, etc.
5. Call `next()` or return 401

**Security Issues:**
- Hardcoded secret fallback value
- No token revocation/blacklist
- No IP binding or device fingerprinting

---

## 2. Password Authentication

### Login Flow (POST /signin)

```javascript
1. Lookup user: WHERE username=? AND status=0
2. Verify password: bcrypt.compareSync(password, hash)
3. Generate JWT (24hr)
4. Return { auth: true, accessToken }
```

### Password Hashing

**Algorithm:** bcrypt  
**Salt Factor:** 8 rounds ⚠️ (recommend 10-12)  

```javascript
password: bcrypt.hashSync(req.body.password, 8)
```

**Missing Controls:**
- ❌ No password complexity requirements
- ❌ No rate limiting (brute force vulnerability)
- ❌ No account lockout
- ❌ No MFA/2FA

---

## 3. Email Verification Login

### Routes
- `POST /verify` - Send code
- `GET /verify/:code/:email` - Verify and login

### Code Generation
```javascript
crypto.randomBytes(3).toString('hex') // 6 hex chars
```

**Expiry:** 1 hour  
**Single use:** Cleared after verification

**Security Issues:**
- 🟡 Short code (16.7M combinations)
- 🟡 Code visible in URL/logs

---

## 4. Password Reset

### Routes
- `POST /forgot_password` - Request reset
- `POST /update_password_via_email` - Reset with token

### Token Generation
```javascript
crypto.randomBytes(20).toString('hex') // 40 hex chars
```

**Expiry:** 1 hour  
**Single use:** ✅ Token cleared after use

---

## 5. Token Refresh

### CRITICAL VULNERABILITY

**Route:** `GET /refresh-token` (login.js:324-365)

**Vulnerable Code:**
```javascript
const base64Payload = token.split('.')[1];
const payload = base64Url.decode(base64Payload);
const decodedPayload = JSON.parse(payload);
// ⚠️ NO signature verification!
```

**Exploit:**
1. Obtain expired JWT
2. Decode payload (base64)
3. Modify payload (change orgId, userId, etc.)
4. Encode modified payload
5. Call /refresh-token
6. Receive new valid token with attacker's payload

**Impact:** Privilege escalation, cross-tenant access, permanent access

---

## 6. Role-Based Access Control

### Roles (db_business.users.type)

| Type | Role | Permissions |
|------|------|-------------|
| '0', '1' | Admin | Full org access |
| '9' | Super Admin | System-wide access |
| Other | User | Limited access |

### Admin Middleware (verifyJwtToken.js:49-60)

```javascript
User.findOne({ where: {user_id, type:'9', status: 0} })
```

### Protected Admin Routes

All `/admin/*` routes require:
- `authJWT.verifyToken`
- `authJWT.isAdmin`

---

## 7. Resource-Level Authorization

### CRITICAL VULNERABILITY

**Issue:** Endpoints validate user authentication but **NOT** resource ownership

**Examples:**
```javascript
// GET /assets/:asset
[authJWT.verifyToken] // ✅ Checks user logged in
// ❌ Does NOT check if user owns asset

// GET /transactions/:transactionId  
[authJWT.verifyToken] // ✅ Authenticated
// ❌ Can access ANY transaction

// PUT /companies/:companyID
[authJWT.verifyToken, clientDB] // ✅ Connected to org DB
// ❌ Can modify ANY company
```

**Exploitation:**
```javascript
// User from org 1
GET /assets/16123456 // Asset belongs to org 2
// Returns asset data (should be 403)
```

**Impact:** Horizontal privilege escalation across all tenants

---

## 8. Multi-Tenancy Enforcement

### Database Isolation

**Architecture:**
- Central DB: `db_business` (users, orgs)
- Shared data DBs: `db_new_application`, `db_uspto`
- Per-org DBs: `org1_db`, `org2_db`, etc.

### Connection Middleware (clientDBConnection.js)

```javascript
1. Extract req.orgId from JWT
2. Lookup org credentials in db_business.organisation:
   - org_db (database name)
   - org_usr (MySQL username)  
   - org_pass (plaintext ⚠️)
   - org_host (MySQL host)
3. Create Sequelize connection (pooled)
4. Inject req.connection_db
```

**Connection Pool:**
- Max: 5 connections
- Min: 0
- Acquire timeout: 30s
- Idle timeout: 10s

**Cleanup:** Every 2 minutes, close connections idle >5 minutes

### Security Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| Plaintext passwords | 🔴 CRITICAL | DB compromise exposes all orgs |
| No credential validation | 🔴 HIGH | Malicious org_host possible |
| Credentials visible in cache | 🟡 MEDIUM | Memory dumps expose creds |

---

## 9. Share Link System

### Purpose
Public access to assets/dashboards without login

### Tables
- `db_new_application.share` - Share definitions
- `db_new_application.share_link_details` - Access tracking

### Share Code Generation

**Algorithm:** CUID2 (Collision-Resistant Unique ID)  
**Length:** ~24-32 characters  
**Properties:** Cryptographically secure, URL-safe  

### Share Authentication (GET /authenticate/:code/:type)

**CRITICAL VULNERABILITY**

**Flow:**
```
1. Lookup share by code
2. Log IP in share_link_details
3. Find PRIMARY ADMIN user for org
4. Generate JWT with admin user ID
5. Return full access token
```

**Security Issues:**

| Issue | Severity | Impact |
|-------|----------|--------|
| No expiration | 🔴 HIGH | Valid forever |
| No revocation | 🔴 HIGH | Cannot invalidate |
| Full org access | 🔴 CRITICAL | Admin token, not scoped |
| No usage limits | 🟡 MEDIUM | Unlimited access |
| IP logging only | 🟡 MEDIUM | Insufficient tracking |

**Exploit:**
1. Get share code (social engineering)
2. Call /authenticate/:code/:type
3. Receive JWT with admin privileges
4. Access ALL org data (not just shared asset)

---

## 10. PHP Script Execution Bridge

### CRITICAL COMMAND INJECTION

**File:** `helpers/runPhpScript.js:34`

**Vulnerable Code:**
```javascript
const quotedArgs = args.map(arg => `"${arg}"`).join(' ');
const command = `screen -md bash -c '${envVars} php -f ${scriptPath} ${quotedArgs}'`;
exec(command);
```

**Exploit:**
```javascript
// User input: '"; rm -rf / #'
// Results in: php -f script.php ""; rm -rf / #"
```

**Impact:**
- Remote code execution
- Complete system compromise
- Data exfiltration

**Affected Endpoints:** 15+ endpoints including:
- POST /companies/
- DELETE /companies/
- POST /admin/customers
- GET /admin/customers/:id/create_tree

### Environment Variables Passed

**Credentials exposed to PHP scripts:**
```javascript
DB_HOST, DB_USER, DB_PASSWORD, // Master credentials
AWS_ACCESS_KEY_ID, AWS_SECRET_KEY, // Full S3 access
```

**Visibility:** Via shell environment (`ps aux`, `/proc`)

---

## 11. External Service Auth

### Slack API
- Token: `process.env.SLACK_ADMIN_TOKEN`
- Storage: Environment variables ✅
- Rotation: ❌ Not implemented

### Microsoft Graph
- Headers: `x-microsoft-auth-token`, `x-microsoft-refresh-token`
- Source: Client-provided
- Validation: ⚠️ No server-side expiry check

### Google APIs
- Tokens in query strings ❌
- Example: `/documents/profile?access_token=ya29...`
- Risk: Logged in server logs, browser history

### AWS S3
- Credentials: Environment variables ✅
- Shared: Across all orgs ⚠️
- Rotation: ❌ Not implemented

---

## 12. Critical Vulnerabilities Summary

### VULN-001: Command Injection (CVSS 9.8)
**Location:** runPhpScript.js:34  
**Fix:** Use `spawn()` with array args, validate inputs  

### VULN-002: Insecure Token Refresh (CVSS 8.1)
**Location:** login.js:324-365  
**Fix:** Verify signature, implement proper refresh tokens  

### VULN-003: Missing Resource AuthZ (CVSS 7.5)
**Location:** Multiple routes  
**Fix:** Check resource ownership in all endpoints  

### VULN-004: Share Link Full Access (CVSS 8.2)
**Location:** login.js:25-77  
**Fix:** Scope tokens, add expiration, revocation  

### VULN-005: Hardcoded Secret (CVSS 6.5)
**Location:** verifyJwtToken.js:5  
**Fix:** Remove fallback, enforce strong secret  

### VULN-006: Plaintext DB Credentials (CVSS 8.5)
**Location:** db_business.organisation table  
**Fix:** Encrypt at rest, use secrets manager  

---

## 13. Immediate Recommendations

### Priority 1: Critical Fixes

1. **Fix Command Injection**
   ```javascript
   // Replace exec() with spawn()
   const php = spawn('php', ['-f', scriptPath, ...sanitizedArgs], {
     env: { ...process.env, ...envVars }
   });
   ```

2. **Fix Token Refresh**
   ```javascript
   // Add signature verification
   jwt.verify(token, secret, (err, decoded) => {
     if (err) return res.status(401).send('Invalid token');
     // Generate new token
   });
   ```

3. **Add Resource Authorization**
   ```javascript
   // Check ownership before returning resource
   const asset = await req.connection_db.Assets.findOne({ 
     where: { id: req.params.asset }
   });
   if (!asset) return res.status(404).send('Not found');
   ```

4. **Secure Share Links**
   ```javascript
   // Add expiration to share table
   // Scope JWT to shared resource only
   // Implement revocation mechanism
   ```

5. **Encrypt DB Credentials**
   ```javascript
   // Use AES-256 encryption
   // Or migrate to AWS Secrets Manager
   ```

### Priority 2: Security Enhancements

- [ ] Implement CSRF protection
- [ ] Configure CORS whitelist
- [ ] Add rate limiting (login: 5/15min, API: 1000/hour)
- [ ] Implement password policy (12+ chars, complexity)
- [ ] Add account lockout (5 failed attempts)
- [ ] Implement WebSocket authentication
- [ ] Add security event logging
- [ ] Remove hardcoded secret fallback

### Priority 3: Best Practices

- [ ] Implement secrets manager
- [ ] Add RBAC granularity
- [ ] Create admin audit log
- [ ] Implement session management
- [ ] Add MFA/2FA
- [ ] Implement IP binding
- [ ] Add device fingerprinting
- [ ] Create security dashboards

---

## 14. Security Testing Checklist

**Authentication:**
- [ ] Test login with invalid credentials
- [ ] Test token expiration
- [ ] Test token refresh vulnerability
- [ ] Test share link authentication
- [ ] Test password reset flow

**Authorization:**
- [ ] Test resource ownership checks
- [ ] Test cross-tenant access
- [ ] Test admin privilege escalation
- [ ] Test role-based access

**Injection:**
- [ ] Test command injection in PHP scripts
- [ ] Test SQL injection (Sequelize ORM)
- [ ] Test XSS in error messages

**Session Management:**
- [ ] Test concurrent sessions
- [ ] Test session fixation
- [ ] Test logout functionality

**Cryptography:**
- [ ] Verify bcrypt usage
- [ ] Test JWT signature validation
- [ ] Test encryption at rest

---

## Conclusion

The PT-API has a functional authentication system but contains **CRITICAL security vulnerabilities** that require immediate attention:

1. **Command Injection** - Remote code execution possible
2. **Token Refresh Bypass** - Signature not verified
3. **Missing AuthZ** - Horizontal privilege escalation
4. **Insecure Share Links** - Full org access without limits
5. **Plaintext Credentials** - Database passwords unencrypted

**Overall Risk:** **HIGH**  
**Recommended Action:** **Immediate remediation of critical issues**

---

**End of Analysis**
