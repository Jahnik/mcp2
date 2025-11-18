# OAuth + Privy Authentication Analysis Report

## Overview

This codebase implements a ChatGPT App connector using OAuth 2.1 with PKCE as the authorization framework, Privy.io as the identity provider, and MCP (Model Context Protocol) for tool execution. The architecture follows the topology: **User → Privy → Auth Server → ChatGPT** for initial authorization, and **ChatGPT → Auth Server (OAuth) → MCP Server → Backend → Privy** for tool invocations.

The auth server is a custom OAuth 2.1 Authorization Server that:
1. Delegates user authentication to Privy (supporting email, wallet, Google, Twitter, Discord)
2. Issues RS256-signed JWT access tokens with Privy DIDs as the subject
3. Supports PKCE-only client authentication (no client secrets)
4. Stores Privy tokens alongside OAuth tokens for later exchange when tools need Privy API access

**Key Characteristics**: In-memory storage (not production-ready), no consent UI (auto-approves), single signing key with no rotation, and token introspection endpoint is unprotected.

---

## Components

### OAuth Server Implementation

| File | Description |
|------|-------------|
| `src/server/oauth/authorize.ts` | Authorization endpoint handling OAuth params validation, Privy token verification, and authorization code generation |
| `src/server/oauth/token.ts` | Token endpoint for code exchange, refresh token rotation, and Privy token exchange |
| `src/server/oauth/wellknown.ts` | Discovery endpoints for OAuth metadata, OIDC configuration, and JWKS |
| `src/server/oauth/storage.ts` | In-memory storage for auth codes, tokens, refresh tokens, and registered clients |
| `src/server/oauth/dcr.ts` | Dynamic Client Registration (RFC 7591) |

**Key Functions**:

- **authorize.ts:53-150** - `POST /authorize/complete`: Validates OAuth params, verifies Privy token via `PrivyClient.verifyAuthToken()`, stores authorization code with 30-second expiry
- **token.ts:45-145** - `handleAuthorizationCodeGrant()`: Validates code, performs PKCE check, issues RS256 JWT with claims
- **token.ts:200-260** - `handleRefreshTokenGrant()`: Rotates refresh token, issues new access token
- **token.ts:280-320** - Privy token exchange endpoint for tools needing Privy API access
- **storage.ts:140-160** - `validatePKCE()`: SHA256(code_verifier) == code_challenge validation

### Privy Integration

**Frontend**:

| File | Description |
|------|-------------|
| `src/client/src/main.tsx` | PrivyProvider setup with login methods (email, wallet, Google, Twitter, Discord) |
| `src/client/src/routes/AuthorizePage.tsx` | OAuth authorization UI that triggers Privy login and submits to `/authorize/complete` |

**Backend**:

| File | Description |
|------|-------------|
| `src/server/middleware/privy.ts` | Privy client initialization and `verifyPrivyToken()` middleware |
| `src/server/config.ts` | Central config including Privy app ID/secret |

**Key Functions**:

- **AuthorizePage.tsx:80-130** - `handleAutomaticAuthorization()`: Gets Privy token via `getAccessToken()`, POSTs to `/authorize/complete`
- **privy.ts:25-50** - `verifyPrivyToken()` middleware using `PrivyClient.verifyAuthToken()`
- **authorize.ts:95-105** - Server-side Privy token verification with claims extraction

### MCP Server

| File | Description |
|------|-------------|
| `src/server/mcp/server.ts` | MCP server initialization and singleton management |
| `src/server/mcp/handlers.ts` | HTTP endpoints for MCP JSON-RPC with auth middleware |
| `src/server/mcp/tools.ts` | Tool definitions (`get-items`, `perform-item-action`, `echo`, `extract_intent`) and handlers |
| `src/server/mcp/resources.ts` | Widget resource registration for ChatGPT UI |

**Key Functions**:

- **handlers.ts:25-50** - `POST /mcp` protected by `validateToken(['read'])`
- **tools.ts:200-350** - `handleExtractIntent()`: Exchanges OAuth token for Privy token, calls Protocol API
- **tools.ts:150-180** - `exchangePrivyToken()`: POSTs to `/token/privy/access-token`

### Middleware

| File | Description |
|------|-------------|
| `src/server/middleware/auth.ts` | JWT validation middleware with scope checking and WWW-Authenticate challenges |

**Key Functions**:

- **auth.ts:30-100** - `validateToken(requiredScopes)`: Extracts Bearer token, verifies JWT signature/issuer/audience, checks scopes
- **auth.ts:120-150** - Error handlers returning RFC 6750 compliant responses

### Sessions & Cookies

**None used**. The system is stateless for ChatGPT:
- No session cookies set by the auth server
- Authorization codes and tokens stored in-memory keyed by their values
- Privy manages its own session on the frontend via `@privy-io/react-auth`

---

## Flows

### Flow 1: User Connects ChatGPT App for the First Time

1. **ChatGPT initiates OAuth** → `GET /authorize?response_type=code&client_id=chatgpt-connector&redirect_uri=https://chatgpt.com/...&scope=read&state=...&code_challenge=...&code_challenge_method=S256`
   - `index.ts:95` routes to `authorize.ts` GET handler
   - Validates `client_id` and `redirect_uri` against registered client (`storage.ts:180-200`)
   - Returns React SPA which loads `AuthorizePage.tsx`

2. **Frontend extracts OAuth params** from URL
   - `AuthorizePage.tsx:35-50` parses query string

3. **User authenticates with Privy**
   - `AuthorizePage.tsx:65` triggers `login()` from `usePrivy()` hook
   - Privy SDK handles authentication flow (email, wallet, social)

4. **On Privy success**, frontend gets access token
   - `AuthorizePage.tsx:85-90` calls `await getAccessToken()`
   - Returns Privy JWT access token

5. **Frontend submits authorization** → `POST /authorize/complete`
   - `AuthorizePage.tsx:100-120` sends:
     ```json
     {
       "client_id": "chatgpt-connector",
       "redirect_uri": "https://chatgpt.com/...",
       "scope": "read",
       "code_challenge": "...",
       "code_challenge_method": "S256",
       "state": "...",
       "privy_user_id": "did:privy:cm1234...",
       "privy_token": "eyJ...",
       "user_consent": true
     }
     ```

6. **Server verifies Privy token**
   - `authorize.ts:90-105` calls `privyClient.verifyAuthToken(privy_token)`
   - Validates `privy_user_id` matches token claims

7. **Server generates authorization code**
   - `authorize.ts:110-130` calls `storeAuthorizationCode()` (`storage.ts:60-90`)
   - Stores: client_id, privy_user_id, privy_token, privy_claims, scopes + `privy:token:exchange`, code_challenge, redirect_uri
   - 30-second expiration
   - Returns `{ code, redirect_uri }`

8. **Frontend redirects to ChatGPT**
   - `AuthorizePage.tsx:125-130` redirects to `redirect_uri?code={code}&state={state}`

9. **ChatGPT exchanges code for tokens** → `POST /token`
   - `token.ts:25-40` routes to `handleAuthorizationCodeGrant()`
   - Payload: `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`

10. **Server validates and issues tokens**
    - `token.ts:50-80` retrieves auth code from storage
    - Validates: not used, not expired, client_id matches, redirect_uri matches
    - `token.ts:85-95` calls `validatePKCE(code_verifier, code_challenge)` (`storage.ts:140-160`)
    - Marks code as used (`storage.ts:100-110`)
    - `token.ts:100-130` issues JWT:
      ```javascript
      jwt.sign({
        sub: privyUserId,  // "did:privy:cm1234..."
        scope: scopes.join(' '),
        aud: config.server.baseUrl,
        client_id: clientId
      }, config.jwt.privateKey, {
        algorithm: 'RS256',
        expiresIn: '1h',
        issuer: config.jwt.issuer,
        keyid: 'key-1'
      })
      ```
    - Issues refresh token (30-day TTL)
    - Stores tokens with Privy token (`storage.ts:115-135`)
    - Returns: `{ access_token, refresh_token, token_type: "Bearer", expires_in: 3600 }`

### Flow 2: ChatGPT Calls MCP Tool with Valid Token

1. **ChatGPT sends tool call** → `POST /mcp`
   - Headers: `Authorization: Bearer {access_token}`
   - Body: `{ "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "extract_intent", "arguments": {...} }, "id": "..." }`

2. **Auth middleware validates token**
   - `handlers.ts:25` applies `validateToken(['read'])`
   - `auth.ts:35-50` extracts Bearer token from header
   - `auth.ts:55-75` verifies JWT:
     ```javascript
     jwt.verify(token, config.jwt.publicKey, {
       algorithms: ['RS256'],
       issuer: config.jwt.issuer,
       audience: config.server.baseUrl
     })
     ```
   - `auth.ts:80-90` extracts scopes, checks required scopes present
   - Attaches `req.auth = { token, decoded, userId, scopes }`

3. **Handler routes to tool**
   - `handlers.ts:35-45` calls `handleMCPRequest(mcpServer, request, { auth: req.auth })`

4. **Tool handler executes** (e.g., `extract_intent`)
   - `tools.ts:200-210` validates auth present
   - `tools.ts:220-240` exchanges OAuth token for Privy token:
     ```javascript
     const privyToken = await exchangePrivyToken(auth.token);
     ```
   - `tools.ts:150-180` `exchangePrivyToken()` POSTs to `/token/privy/access-token`

5. **Privy token exchange endpoint**
   - `token.ts:280-320` validates OAuth token has `privy:token:exchange` scope
   - Retrieves stored Privy token from `tokens` map
   - Returns: `{ privyAccessToken, expiresAt, userId, scope }`

6. **Tool calls Protocol API**
   - `tools.ts:260-300` POSTs to `{PROTOCOL_API_URL}/discover/new`
   - Headers: `Authorization: Bearer {privyToken}`
   - Payload: `{ payload: "User text + context" }`

7. **Tool returns result**
   - `tools.ts:310-340` formats response for ChatGPT widget

### Flow 3: Token Refresh

1. **ChatGPT sends refresh request** → `POST /token`
   - Body: `grant_type=refresh_token`, `refresh_token=...`, `client_id=chatgpt-connector`

2. **Server validates refresh token**
   - `token.ts:200-220` retrieves from `refreshTokens` map
   - Validates: exists, not expired, client_id matches

3. **Server rotates tokens**
   - `token.ts:225-250` deletes old refresh token
   - Issues new access token with same claims
   - Generates new refresh token (30-day TTL)
   - Stores both with original Privy token

4. **Returns new tokens**
   - `{ access_token, refresh_token, token_type: "Bearer", expires_in: 3600 }`

### Flow 4: User Logs Out / Revokes Access

**Not implemented**. There is:
- No logout endpoint
- No token revocation endpoint
- No way for users to revoke OAuth access

The only invalidation mechanism is token expiration (1 hour for access, 30 days for refresh).

### Flow 5: Privy User Changes

**Not implemented**. The system:
- Uses Privy DID as the canonical user identifier
- Does not maintain a user database
- Does not sync with Privy user changes
- Tokens contain the Privy DID at time of issuance; changes won't propagate until token refresh

---

## Configuration

### Environment Variables

| Variable | Location Read | Purpose | Default/Required |
|----------|---------------|---------|------------------|
| `PRIVY_APP_ID` | `config.ts:15` | Server-side Privy app ID | **Required** |
| `PRIVY_APP_SECRET` | `config.ts:16` | Server-side Privy app secret | **Required** |
| `VITE_PRIVY_APP_ID` | `main.tsx:8` | Client-side Privy app ID | **Required** |
| `SERVER_BASE_URL` | `config.ts:20` | OAuth issuer & audience | Default: `http://localhost:3002` |
| `JWT_PRIVATE_KEY` | `config.ts:25` | Base64-encoded RS256 private key | **Required** |
| `JWT_PUBLIC_KEY` | `config.ts:26` | Base64-encoded RS256 public key | **Required** |
| `PROTOCOL_API_URL` | `config.ts:45` | Index backend API URL | **Required for extract_intent** |
| `PROTOCOL_API_TIMEOUT_MS` | `config.ts:46` | Protocol API timeout | Default: `60000` |
| `PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS` | `config.ts:47` | Token exchange timeout | Default: `10000` |
| `PORT` | `config.ts:18` | Server port | Default: `3002` |
| `NODE_ENV` | `config.ts:19` | Environment mode | Default: `development` |

### Missing Variable Behavior

- **Missing Privy credentials**: Server fails to start (PrivyClient constructor throws)
- **Missing JWT keys**: JWT operations fail at runtime with cryptographic errors
- **Missing SERVER_BASE_URL**: Uses localhost default, breaks production
- **Missing PROTOCOL_API_URL**: `extract_intent` tool fails with connection error

---

## Failure Modes

### Authorization Endpoint Failures

| Failure | Handling Location | HTTP Status | Error Response | Logged |
|---------|-------------------|-------------|----------------|--------|
| Missing `client_id` | `authorize.ts:60-65` | Redirect | `error=invalid_request&error_description=Missing client_id` | No |
| Invalid `client_id` | `authorize.ts:70-75` | Redirect | `error=invalid_request&error_description=Unknown client_id` | No |
| Missing `redirect_uri` | `authorize.ts:80-85` | Redirect | `error=invalid_request&error_description=Missing redirect_uri` | No |
| Invalid `redirect_uri` | `storage.ts:185-195` | Redirect | `error=invalid_request&error_description=Invalid redirect_uri` | No |
| Missing `code_challenge` | `authorize.ts:90-95` | Redirect | `error=invalid_request&error_description=PKCE required` | No |
| Invalid `code_challenge_method` | `authorize.ts:95-100` | Redirect | `error=invalid_request&error_description=Only S256 supported` | No |
| Invalid Privy token | `authorize.ts:105-110` | 400 | `{"error":"invalid_request","error_description":"Invalid Privy token"}` | Yes |
| Privy user ID mismatch | `authorize.ts:112-117` | 400 | `{"error":"invalid_request","error_description":"Privy user ID does not match token claims"}` | No |

### Token Endpoint Failures

| Failure | Handling Location | HTTP Status | Error Response | Logged |
|---------|-------------------|-------------|----------------|--------|
| Invalid `grant_type` | `token.ts:30-35` | 400 | `{"error":"unsupported_grant_type"}` | No |
| Missing `code` | `token.ts:55-60` | 400 | `{"error":"invalid_request","error_description":"Missing code"}` | No |
| Unknown `code` | `token.ts:65-70` | 400 | `{"error":"invalid_grant","error_description":"Invalid authorization code"}` | No |
| Used `code` | `token.ts:72-77` | 400 | `{"error":"invalid_grant","error_description":"Authorization code already used"}` | No |
| Expired `code` | `token.ts:79-84` | 400 | `{"error":"invalid_grant","error_description":"Authorization code expired"}` | No |
| `client_id` mismatch | `token.ts:86-91` | 400 | `{"error":"invalid_grant","error_description":"Client ID mismatch"}` | No |
| Invalid PKCE verifier | `token.ts:93-98` | 400 | `{"error":"invalid_grant","error_description":"Invalid code verifier"}` | No |
| Invalid refresh token | `token.ts:210-215` | 400 | `{"error":"invalid_grant","error_description":"Invalid refresh token"}` | No |
| Expired refresh token | `token.ts:217-222` | 400 | `{"error":"invalid_grant","error_description":"Refresh token expired"}` | No |

### MCP Endpoint Failures

| Failure | Handling Location | HTTP Status | Error Response | Logged |
|---------|-------------------|-------------|----------------|--------|
| Missing Authorization header | `auth.ts:40-45` | 401 | `{"error":"invalid_request"}` + WWW-Authenticate header | No |
| Invalid Bearer format | `auth.ts:47-52` | 401 | `{"error":"invalid_token"}` + WWW-Authenticate header | No |
| Invalid JWT signature | `auth.ts:60-70` | 401 | `{"error":"invalid_token"}` + WWW-Authenticate header | No |
| Expired JWT | `auth.ts:72-77` | 401 | `{"error":"invalid_token","error_description":"Token expired"}` + WWW-Authenticate header | No |
| Invalid issuer/audience | `auth.ts:79-84` | 401 | `{"error":"invalid_token"}` + WWW-Authenticate header | No |
| Missing required scope | `auth.ts:86-91` | 403 | `{"error":"insufficient_scope","error_description":"..."}` + WWW-Authenticate header | No |
| Tool auth check failure | `tools.ts:205-210` | 200 | `{"content":[{"type":"text","text":"Authentication required."}],"isError":true}` | No |

### Privy Token Exchange Failures

| Failure | Handling Location | HTTP Status | Error Response | Logged |
|---------|-------------------|-------------|----------------|--------|
| Token not found in storage | `token.ts:295-300` | 404 | `{"error":"token_not_found"}` | No |
| Missing `privy:token:exchange` scope | `token.ts:285-290` | 403 | `{"error":"insufficient_scope"}` | No |

### Backend/Protocol API Failures

| Failure | Handling Location | HTTP Status | Error Response | Logged |
|---------|-------------------|-------------|----------------|--------|
| Privy token exchange timeout | `tools.ts:165-170` | 200 | `{"content":[{"type":"text","text":"Failed to exchange Privy token"}],"isError":true}` | Yes |
| Protocol API error | `tools.ts:280-290` | 200 | `{"content":[{"type":"text","text":"Failed to extract intent: ..."}],"isError":true}` | Yes |
| Protocol API timeout | `tools.ts:285-295` | 200 | `{"content":[{"type":"text","text":"Protocol API timeout"}],"isError":true}` | Yes |

---

## Gaps / Uncertainties

### Critical Issues for Test Design

1. **In-memory storage**: All tokens stored in JavaScript Maps. Server restart clears all auth state. Cannot test persistence or horizontal scaling. Tests must account for this.

2. **No token revocation**: Cannot test logout or revocation flows. Only expiration-based invalidation exists.

3. **Unprotected introspection**: `POST /token/introspect` has no authentication. Any party with a token can introspect it. Need to test for information disclosure.

4. **Privy token lifetime not validated**: When exchanging OAuth token for Privy token (`token.ts:295-310`), the stored Privy token's expiration is not checked. Could return expired Privy tokens. Need to test this edge case.

5. **Fallback token purpose unclear**: `authorize.ts:45-50` accepts `fallback_token` parameter. Usage undocumented. Potential security issue if it bypasses normal flow.

6. **No consent UI**: Despite accepting `user_consent` parameter, no consent screen is shown. Auto-approves after Privy auth. Cannot test consent denial flows.

7. **Single key ID**: Hardcoded `kid: 'key-1'` (`token.ts:125`). No key rotation mechanism. Cannot test key rotation scenarios.

8. **Scope auto-addition**: `privy:token:exchange` is always added to authorization codes (`authorize.ts:115-120`), even if not requested. Tests should verify this behavior and that clients cannot override it.

9. **Widget dead code**: `IntentDisplay.tsx` references `/api/intents/:id` endpoint that doesn't exist. Tests should account for this being non-functional.

10. **Missing OIDC features**: `/.well-known/openid-configuration` exists but no `id_token` is issued. OIDC clients will fail. Need negative tests for this.

### Ambiguous Behaviors

1. **Redirect URI validation strictness**: `storage.ts:185-195` does exact string match. Unclear if trailing slashes, query params, or fragments are normalized. Need boundary tests.

2. **Scope parsing edge cases**: `auth.ts:85` splits on space. Empty string, multiple spaces, or leading/trailing spaces behavior unclear.

3. **Error redirect vs JSON response**: Some errors redirect with query params (`authorize.ts:65-70`), others return JSON (`authorize.ts:107-110`). Logic for choosing which is implicit.

4. **CORS configuration**: Not visible in provided code. Unclear if cross-origin requests from ChatGPT work correctly. Need to test CORS headers.

5. **State parameter validation**: State is passed through but not validated by server. Unclear if empty or missing state is allowed.

### Test Coverage Requirements

For comprehensive end-to-end tests, the following must be covered:

**Happy Paths**:
- Complete OAuth flow from ChatGPT initiation to token usage
- Refresh token rotation
- All MCP tools with valid auth
- Privy token exchange for tools

**Edge Cases**:
- Boundary values for all parameters
- Expired tokens at each stage (code, access, refresh, Privy)
- Single-use authorization code enforcement
- PKCE with various code_verifier lengths
- Scope combinations and requirements

**Failure Modes**:
- All error responses in tables above
- Invalid/malformed JWTs
- Missing/malformed Authorization headers
- Privy authentication failures
- Network failures to Protocol API

**Security Tests**:
- Token introspection information disclosure
- Replay attacks with used authorization codes
- Cross-client token usage attempts
- Invalid redirect_uri attacks
- PKCE bypass attempts

**Not Testable Due to Gaps**:
- Token revocation
- Key rotation
- Consent denial
- Database persistence
- Horizontal scaling

---

## File Reference Summary

### OAuth Server
- `src/server/oauth/authorize.ts` - Authorization endpoint
- `src/server/oauth/token.ts` - Token endpoint
- `src/server/oauth/wellknown.ts` - Discovery endpoints
- `src/server/oauth/storage.ts` - In-memory storage
- `src/server/oauth/dcr.ts` - Dynamic client registration

### Middleware
- `src/server/middleware/auth.ts` - JWT validation
- `src/server/middleware/privy.ts` - Privy client

### MCP
- `src/server/mcp/server.ts` - MCP server init
- `src/server/mcp/handlers.ts` - HTTP handlers
- `src/server/mcp/tools.ts` - Tool implementations
- `src/server/mcp/resources.ts` - Widget resources

### Frontend
- `src/client/src/main.tsx` - Privy provider setup
- `src/client/src/routes/AuthorizePage.tsx` - Auth UI

### Config
- `src/server/config.ts` - Central configuration
- `src/server/index.ts` - Express server setup