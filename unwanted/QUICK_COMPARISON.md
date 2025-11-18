# Quick Reference: OAuth Implementation Differences

## At a Glance

| Feature | mcp2 | mcp | ChatGPT Compatible? |
|---------|------|-----|-------------------|
| **Token Type** | JWT (RS256) | Opaque random | mcp2 YES, mcp NO |
| **Token Self-Validating** | Yes | No | Required: Yes |
| **JWKS Endpoint** | ✓ /.well-known/jwks.json | ✗ Missing | Required: Yes |
| **Introspection Endpoint** | ✓ POST /token/introspect | ✗ Missing | Required: Yes |
| **Issuer Validation** | ✓ In JWT & middleware | ✗ Not validated | Recommended |
| **Audience Validation** | ✓ In JWT & middleware | ✗ Not validated | Recommended |
| **PKCE** | Mandatory | Optional | Required |
| **OAuth Metadata Location** | /.well-known/oauth-authorization-server | N/A | Standard RFC 8414 |
| **Privy Token Exchange** | /token/privy/access-token | /privy/access-token | Either works |

---

## Why mcp Fails with ChatGPT

### The Chain of Failures:

```
ChatGPT OAuth Flow:
  1. User authenticates
  2. OAuth token received: ✓
  3. ChatGPT fetches /.well-known/jwks.json: ✗ 404
  4. ChatGPT tries token validation: ✗ No JWKS, can't validate
  5. ChatGPT makes introspection request: ✗ 404 endpoint not found
  6. ChatGPT gives up: "connection problem"
```

### What mcp2 Avoids:

```
mcp2 OAuth Flow:
  1. User authenticates
  2. OAuth token received: JWT with signature ✓
  3. ChatGPT fetches /.well-known/jwks.json: ✓ Gets public key
  4. ChatGPT validates token signature: ✓ Valid
  5. ChatGPT makes MCP request: ✓
  6. Server validates JWT: ✓
  7. Tools execute: ✓
```

---

## Token Format Comparison

### mcp2 JWT Token Example:
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xIn0.
eyJzdWIiOiJkaWQ6cHJpdnk6WXBrNTBZM3p0WjI5dloyNXNiMjVwYm1WZlkyOXQiLCJzY29wZSI6InJlYWQgd3JpdGUgcHJvZmlsZSBwcml2eTp0b2tlbjpleGNoYW5nZSIsImF1ZCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzAwMiIsImNsaWVudF9pZCI6ImNoYXRncHQtY29ubmVjdG9yIiwiaXNzIjoiaHR0cDovL2xvY2FsaG9zdDozMDAyIiwiZXhwIjoxNzMxNDQ1NjYwLCJpYXQiOjE3MzE0NDIwNjB9.
<RSA_SIGNATURE>
```

**Can be validated without server**: Yes
- Signature proves it came from server
- Issuer proves correct server created it
- Audience proves it's for this service
- Expiration prevents replay attacks

### mcp Opaque Token Example:
```
Q3d4WkVXdlJqaVZFMmM5TjFBQllUZ0tQVkJBRWdGNWFUZExGV1ZITVhWTFMyZFlabWRGYVU5UE1FRlE=
```

**Cannot be validated without server**: Always requires database lookup
- No signature
- No issuer claim
- No expiration field in token itself
- If server restarts, all tokens in-memory map are lost

---

## Endpoint Comparison

### Authorization Endpoints

| Endpoint | mcp2 | mcp | Status |
|----------|------|-----|--------|
| GET /authorize | Express route | Function | mcp2 clearer |
| POST /authorize | Express route | Function | mcp2 clearer |
| POST /register | Express route (DCR RFC 7591) | Function | mcp2 standard |
| GET /.well-known/oauth-authorization-server | ✓ Implemented | Function-based | mcp2 RFC 8414 |
| GET /.well-known/jwks.json | ✓ Implemented | ✗ Missing | **CRITICAL** |
| POST /token/introspect | ✓ Implemented | ✗ Missing | **CRITICAL** |
| POST /token | ✓ Returns JWT | ✓ Returns opaque | Different approach |
| POST /mcp | Requires JWT validation | Requires opaque lookup | Both work if auth works |

---

## Authentication Middleware Comparison

### mcp2 validateToken():
```typescript
jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  issuer: serverUrl,        // ← Checked
  audience: serverUrl,      // ← Checked - CRITICAL
})
```
- Cryptographically validates signature
- No database lookup needed
- Works when server is busy or slow
- Works offline if key is cached

### mcp authenticatePrivy():
```typescript
validateAccessToken(token)  // ← Just a Map lookup
```
- Looks up token in memory
- No cryptographic validation
- Requires server availability
- Vulnerable to replay if token leaked
- Lost if server restarts

---

## Configuration Differences

### mcp2 (Centralized):
```typescript
// src/server/config.ts
export const config = {
  privy: { appId, appSecret },
  server: { baseUrl, port, nodeEnv },
  jwt: { privateKey, publicKey, issuer, algorithm, expiresIn },
  oauth: { endpoints... },
  intentExtraction: { ...params },
};
```

### mcp (Distributed):
```typescript
// Environment variables read throughout:
// src/privy.ts
// src/oauth.ts
// src/server.ts
// src/auth.ts
```

**mcp2 advantage**: Single source of truth, easier to maintain

---

## Which Should You Use?

### Use mcp2 if:
- ChatGPT integration is priority
- You want industry-standard OAuth
- You want token validation without server calls
- You want better security (JWT signatures)
- You're doing production deployment

### Use mcp if:
- You only need internal MCP tools
- You don't care about ChatGPT compatibility
- You have a single, always-online server
- You prefer simpler token lookup mechanism
- You're still in development/testing

---

## Specific File Locations

### Critical Files in mcp2:
- `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts` - JWT issuance (line 236-275)
- `/Users/jahnik/index-network/mcp2/src/server/oauth/wellknown.ts` - JWKS endpoint (line 84-104)
- `/Users/jahnik/index-network/mcp2/src/server/middleware/auth.ts` - JWT validation (line 27-82)

### Critical Files in mcp:
- `/Users/jahnik/index-network/mcp/src/oauth.ts` - Opaque token issuance (line 549-593)
- `/Users/jahnik/index-network/mcp/src/auth.ts` - Opaque validation (line 36-103)
- `/Users/jahnik/index-network/mcp/src/server.ts` - Missing JWKS (no line found)

---

## The Fix: What mcp Needs

To make mcp work with ChatGPT:

1. **Add JWKS endpoint** (~50 lines)
   - Location: Expose public key in JWK format
   - File: `src/server.ts` or new `src/jwks.ts`
   - Route: `GET /.well-known/jwks.json`

2. **Convert tokens to JWT** (~100 lines)
   - Replace `randomBytes(32).toString('base64url')`
   - With `jwt.sign({...}, privateKey, {issuer, expiresIn, ...})`
   - Add `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` env vars

3. **Add introspection endpoint** (~30 lines)
   - Route: `POST /token/introspect`
   - Return: `{active, sub, scope, client_id, exp, iss, aud}`

4. **Update metadata** (~3 lines)
   - Add `jwks_uri: "${issuer}/.well-known/jwks.json"`
   - To: `authorizationServerMetadata()`

**Total effort**: ~180 lines of code changes

---

## Testing Each Implementation

### For mcp2:
```bash
# Check JWKS
curl http://localhost:3002/.well-known/jwks.json
# Should return: { "keys": [{ "kty": "RSA", ... }] }

# Check token format
# OAuth flow returns JWT starting with "eyJ"

# Check validation works
curl -H "Authorization: Bearer <JWT>" http://localhost:3002/mcp -d '{...}'
# Should work
```

### For mcp:
```bash
# Check JWKS
curl http://localhost:3002/.well-known/jwks.json
# Returns: 404 Not Found ✗

# Check token format
# OAuth flow returns: "Q3d4...JIg==" (opaque, no structure)

# Check if token is JWT
echo "Q3d4...JIg==" | base64 -d
# Not valid JSON (unlike JWT payload)
```

---

## Summary

**mcp2**: Production-ready, ChatGPT compatible, industry-standard OAuth
**mcp**: Development-friendly, custom tokens, requires server for validation

For ChatGPT integration, **use mcp2**.

