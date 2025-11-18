# Auth & Identity Implementation Report

## 1. Components and Responsibilities

| Component | Location | Responsibility | Interfaces |
|-----------|----------|----------------|------------|
| **Express Server** | `src/server/index.ts` | Main HTTP server, routes all OAuth2/MCP endpoints | HTTP endpoints |
| **OAuth Authorization** | `src/server/oauth/authorize.ts` | Authorization code generation, Privy token verification | `GET/POST /authorize`, `POST /authorize/complete` |
| **OAuth Token** | `src/server/oauth/token.ts` | Token exchange, JWT issuance, refresh tokens, Privy token exchange | `POST /token`, `POST /token/introspect`, `POST /token/privy/access-token` |
| **OAuth Storage** | `src/server/oauth/storage.ts` | In-memory storage for codes, tokens, clients | Internal functions |
| **OAuth Discovery** | `src/server/oauth/wellknown.ts` | OAuth2/OIDC metadata, JWKS | `GET /.well-known/*` |
| **Dynamic Client Registration** | `src/server/oauth/dcr.ts` | Register OAuth clients dynamically | `POST /register` |
| **JWT Auth Middleware** | `src/server/middleware/auth.ts` | Validate OAuth access tokens (JWT) | Express middleware |
| **Privy Auth Middleware** | `src/server/middleware/privy.ts` | Validate Privy tokens | Express middleware |
| **MCP Server** | `src/server/mcp/server.ts` | MCP protocol initialization | Internal |
| **MCP Handlers** | `src/server/mcp/handlers.ts` | HTTP endpoint for MCP calls | `POST/GET /mcp` |
| **MCP Tools** | `src/server/mcp/tools.ts` | Tool implementations including `extract_intent` | JSON-RPC tool calls |
| **Client App** | `src/client/` | React authorization UI with Privy | Web frontend |
| **Widgets** | `src/widgets/` | ChatGPT embedded UI components | Embedded in ChatGPT |

---

## 2. Identity Model

### Canonical User Identifier

**Privy DID (Decentralized Identifier)** is the canonical user ID throughout the system.

**Format**: `did:privy:<uuid>` (e.g., `did:privy:cm1234abcd5678efgh`)

### Identity Storage

**No database schema exists.** All identity data is held transiently in memory via in-memory Maps in `src/server/oauth/storage.ts`:

```typescript
// Line 64-68
const authorizationCodes = new Map<string, AuthorizationCode>();
const registeredClients = new Map<string, RegisteredClient>();
const tokens = new Map<string, TokenData>();
const refreshTokens = new Map<string, RefreshTokenData>();
```

### Identity Relationships

- **Internal user ID**: None defined - system uses Privy DID directly
- **Privy user ID**: Primary identifier (`userId` field in all structures)
- **Wallets/addresses**: Managed by Privy, not stored locally
- **Emails**: Managed by Privy, not stored locally

### Session User Abstractions

**Express Request Augmentation for OAuth tokens** (`src/server/middleware/auth.ts:10-22`):
```typescript
declare global {
  namespace Express {
    interface Request {
      auth?: {
        token: string;           // raw JWT
        decoded: jwt.JwtPayload; // decoded claims
        userId: string;          // Privy DID from 'sub' claim
        scopes: string[];        // parsed from 'scope' claim
      };
    }
  }
}
```

**Express Request Augmentation for Privy tokens** (`src/server/middleware/privy.ts:10-20`):
```typescript
declare global {
  namespace Express {
    interface Request {
      privyUser?: {
        userId: string;  // Privy DID
        appId: string;   // Privy app ID
      };
    }
  }
}
```

---

## 3. Privy Integration Details

### Privy SDK Initialization

**Server-side** (`src/server/middleware/privy.ts:23-26`):
```typescript
import { PrivyClient } from '@privy-io/server-auth';

const privyClient = new PrivyClient(
  config.privy.appId,
  config.privy.appSecret
);
```

**Client-side** (`src/client/src/main.tsx:6-27`):
```typescript
import { PrivyProvider } from '@privy-io/react-auth';

<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID}
  config={{
    loginMethods: ['email', 'wallet', 'google', 'twitter', 'discord'],
    appearance: { theme: 'light', accentColor: '#676FFF' },
    embeddedWallets: { createOnLogin: 'users-without-wallets' },
  }}
>
```

### Environment Variables

- `PRIVY_APP_ID` - Server Privy app ID
- `PRIVY_APP_SECRET` - Server Privy app secret
- `VITE_PRIVY_APP_ID` - Client Privy app ID

### Privy Token Verification

**Server-side verification** (`src/server/middleware/privy.ts:34-85`):
```typescript
export const verifyPrivyToken = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  const verifiedClaims = await privyClient.verifyAuthToken(token);
  // verifiedClaims contains: userId, appId, [other claims]

  req.privyUser = {
    userId: verifiedClaims.userId,
    appId: verifiedClaims.appId
  };
};
```

**Authorization endpoint verification** (`src/server/oauth/authorize.ts:275-291`):
```typescript
const privyResponse = await privyClient.verifyAuthToken(privy_token);

if (!privyResponse || privyResponse.userId !== privy_user_id) {
  return res.status(401).json({
    error: 'invalid_grant',
    error_description: 'Privy token verification failed'
  });
}
```

**Fallback verification for non-interactive flow** (`src/server/oauth/authorize.ts:136-166`):
```typescript
let verifiedClaims: PrivyClaims;
try {
  verifiedClaims = await privyClient.verifyAuthToken(privy_token);
} catch (error) {
  if (fallback_token) {
    try {
      verifiedClaims = await privyClient.verifyAuthToken(fallback_token);
    } catch {
      return res.status(401).json({...});
    }
  } else {
    return res.status(401).json({...});
  }
}
```

### Privy API Calls

**Server-to-server Privy API** (`src/server/middleware/privy.ts:88-125`):
```typescript
async function callPrivyAPI(endpoint: string, method = 'GET', body?: any) {
  const credentials = Buffer.from(`${config.privy.appId}:${config.privy.appSecret}`)
    .toString('base64');

  const response = await fetch(`https://auth.privy.io/api/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Basic ${credentials}`,
      'privy-app-id': config.privy.appId,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

export async function getPrivyUser(userId: string) {
  return callPrivyAPI(`/users/${userId}`);
}
```

### Login Flow

1. User visits `/authorize` with OAuth params
2. React client renders `AuthorizePage.tsx`
3. Client calls `login()` from `usePrivy()` hook (Line 88)
4. Privy SDK handles OAuth/Web3 login
5. On `authenticated` state, client calls `getAccessToken()` (Line 43)
6. Client POSTs to `/authorize/complete` with Privy token

---

## 4. OAuth / OIDC / Token Issuing

### Discovery / Metadata

**OAuth Authorization Server Metadata** (`src/server/oauth/wellknown.ts:59-70`):

`GET /.well-known/oauth-authorization-server`

```typescript
{
  issuer: config.server.baseUrl,
  authorization_endpoint: `${baseUrl}/authorize`,
  token_endpoint: `${baseUrl}/token`,
  jwks_uri: `${baseUrl}/.well-known/jwks.json`,
  registration_endpoint: `${baseUrl}/register`,
  scopes_supported: ['read', 'write', 'profile', 'privy:token:exchange'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none']
}
```

**Protected Resource Metadata** (`src/server/oauth/wellknown.ts:72-82`):

`GET /.well-known/oauth-protected-resource`

```typescript
{
  resource: config.server.baseUrl,
  authorization_servers: [config.server.baseUrl],
  scopes_supported: ['read', 'write', 'profile', 'privy:token:exchange'],
  bearer_methods_supported: ['header']
}
```

**JWKS** (`src/server/oauth/wellknown.ts:84-106`):

`GET /.well-known/jwks.json`

```typescript
const publicKeyJwk = await jose.exportJWK(
  await jose.importSPKI(config.jwt.publicKey, 'RS256')
);

{
  keys: [{
    ...publicKeyJwk,
    kid: 'key-1',
    alg: 'RS256',
    use: 'sig'
  }]
}
```

### Authorization Endpoint

**GET /authorize** (`src/server/oauth/authorize.ts:28-98`)

Input parameters:
- `response_type` (required, must be `code`)
- `client_id` (required)
- `redirect_uri` (required)
- `scope` (optional)
- `state` (required)
- `code_challenge` (required)
- `code_challenge_method` (required, must be `S256`)

Logic:
1. Validates all required params present
2. Validates `code_challenge_method` is `S256`
3. Validates client exists via `validateClientAndRedirectUri()`
4. Returns React UI for Privy login

**POST /authorize/complete** (`src/server/oauth/authorize.ts:103-233`)

Input parameters:
- `state`, `privy_token`, `fallback_token` (optional)
- `client_id`, `redirect_uri`, `scope`
- `code_challenge`, `code_challenge_method`

Logic:
1. Verifies Privy token (with fallback support)
2. Validates client and redirect URI
3. Validates PKCE params
4. Validates requested scopes
5. **Always adds `privy:token:exchange` scope** (Line 177-182)
6. Stores authorization code with Privy token and claims (Line 196-207):
```typescript
const { code } = storeAuthorizationCode({
  clientId: client_id,
  privyUserId: verifiedClaims.userId,
  privyToken: privy_token,
  privyClaims: verifiedClaims,
  scopes: finalScopes,
  codeChallenge: code_challenge,
  codeChallengeMethod: code_challenge_method,
  redirectUri: redirect_uri,
  expiresAt: new Date(Date.now() + 30000) // 30 seconds
});
```
7. Returns `{ code, redirect_uri, state }`

**POST /authorize** (browser-based) (`src/server/oauth/authorize.ts:236-371`)

Same flow but with explicit consent handling and browser redirect.

### Token Endpoint

**POST /token** (`src/server/oauth/token.ts:25-58`)

Routes to:
- `authorization_code` grant
- `refresh_token` grant

#### Authorization Code Grant

(`src/server/oauth/token.ts:61-163`)

Input:
- `code`, `code_verifier`, `client_id`, `redirect_uri`

Logic:
1. Retrieves auth code from storage
2. Validates code exists and not used
3. Validates code not expired
4. Validates `client_id` matches
5. Validates PKCE: `SHA256(code_verifier) == code_challenge`
6. Marks code as used
7. Issues JWT access token
8. Creates and stores refresh token
9. Deletes auth code
10. Returns tokens

**Token issuance** (`src/server/oauth/token.ts:236-278`):
```typescript
function issueAccessToken(
  privyUserId: string,
  scopes: string[],
  clientId: string,
  audience: string
): string {
  return jwt.sign(
    {
      sub: privyUserId,           // Privy DID
      scope: scopes.join(' '),    // space-separated
      aud: audience,              // config.server.baseUrl
      client_id: clientId
    },
    config.jwt.privateKey,
    {
      algorithm: 'RS256',
      issuer: config.jwt.issuer,  // config.server.baseUrl
      expiresIn: '1h',
      keyid: 'key-1'
    }
  );
}
```

**Token storage** includes Privy token for later exchange (Line 149-155):
```typescript
storeToken(accessToken, {
  clientId: client_id,
  privyUserId: codeData.privyUserId,
  privyToken: codeData.privyToken,  // Privy token stored here
  scopes: codeData.scopes,
  expiresAt: new Date(decoded.exp! * 1000)
});
```

#### Refresh Token Grant

(`src/server/oauth/token.ts:166-233`)

Logic:
1. Validates refresh token exists
2. Validates `client_id` matches
3. Validates not expired
4. **Rotates refresh tokens** (deletes old, creates new)
5. Issues new JWT access token
6. Returns new tokens

#### Token Introspection

(`src/server/oauth/token.ts:280-323`)

`POST /token/introspect`

Returns decoded token claims or `{ active: false }`.

### Privy Token Exchange Endpoint

**POST /token/privy/access-token** (`src/server/oauth/token.ts:326-379`)

**Requires**: `privy:token:exchange` scope in OAuth access token

Logic:
1. Middleware validates OAuth token has required scope
2. Looks up token data in storage
3. Returns stored Privy token:
```typescript
{
  privyAccessToken: tokenData.privyToken,
  expiresAt: tokenData.expiresAt.toISOString(),
  userId: tokenData.privyUserId,
  scope: tokenData.scopes.join(' ')
}
```

### Token Claims Summary

**Access Token (JWT)**:
- `sub`: Privy DID (e.g., `did:privy:cm1234...`)
- `scope`: space-separated scopes (e.g., `read write privy:token:exchange`)
- `aud`: server base URL
- `client_id`: OAuth client ID
- `iss`: server base URL
- `iat`, `exp`: timestamps
- `kid`: `key-1` (in header)

**No ID token is issued** - this is OAuth2 only, not OpenID Connect.

### JWKS / Signing

**Key configuration** (`src/server/config.ts:29-35`):
```typescript
jwt: {
  privateKey: Buffer.from(getEnvVar('JWT_PRIVATE_KEY'), 'base64').toString('utf-8'),
  publicKey: Buffer.from(getEnvVar('JWT_PUBLIC_KEY'), 'base64').toString('utf-8'),
  issuer: SERVER_BASE_URL,
  algorithm: 'RS256' as const,
  expiresIn: '1h'
}
```

- Keys stored as base64-encoded PEM in environment variables
- Single key with `kid: 'key-1'`
- No key rotation mechanism implemented

---

## 5. Session Management and Cookies

### Session Creation

**No server-side sessions are created.** Authentication state is maintained through:
1. Privy SDK on client (manages its own session/cookies)
2. JWT access tokens (stateless)
3. In-memory token storage (server-side for refresh/exchange)

### Cookie Settings

**No cookies are set by this server.** The Privy SDK manages its own cookies on the client.

### Session → User Resolution

For MCP endpoints, user resolution happens via JWT middleware (`src/server/middleware/auth.ts:27-86`):

```typescript
export const validateToken = (requiredScopes?: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: ['RS256'],
      issuer: config.jwt.issuer,
      audience: config.server.baseUrl
    }) as jwt.JwtPayload;

    const scopes = decoded.scope?.split(' ') || [];

    req.auth = {
      token,
      decoded,
      userId: decoded.sub!,  // Privy DID
      scopes
    };
  };
};
```

---

## 6. MCP / Tools / API Auth Enforcement

### MCP Server

**Tool definitions** in `src/server/mcp/tools.ts:45-147`:

| Tool | Description | Requires Auth |
|------|-------------|---------------|
| `get-items` | View user items | Yes |
| `perform-item-action` | Perform action on item | Yes |
| `echo` | Echo text | No |
| `extract_intent` | Extract user intents | Yes |

**Handler routing** (`src/server/mcp/handlers.ts:17-60`):

```typescript
router.post('/mcp', validateToken(['read']), async (req, res) => {
  const auth = req.auth!;
  const result = await handleMCPRequest(server, req.body, { auth });
  res.json(result);
});
```

### Authorization Header Processing

**JWT validation middleware** at `src/server/middleware/auth.ts:27-86`:

1. Extracts Bearer token from `Authorization` header
2. Verifies JWT signature using `jsonwebtoken` library
3. Validates issuer: `config.jwt.issuer`
4. Validates audience: `config.server.baseUrl`
5. Parses scopes from `scope` claim
6. Checks required scopes if specified
7. Attaches `req.auth` object

### Token → User Mapping

User ID (Privy DID) extracted from JWT `sub` claim and attached to `req.auth.userId`.

### Authorization Decisions

**Scope checks** (`src/server/middleware/auth.ts:66-75`):
```typescript
if (requiredScopes && requiredScopes.length > 0) {
  const hasRequiredScopes = requiredScopes.every(
    required => scopes.includes(required)
  );

  if (!hasRequiredScopes) {
    return sendInsufficientScopeError(res, requiredScopes);
  }
}
```

**Tool-level auth checks** (`src/server/mcp/tools.ts:182-196`):
```typescript
async function handleGetItems(args: unknown, auth?: AuthContext) {
  if (!auth?.userId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        })
      }]
    };
  }
  // ...
}
```

### Unprotected Endpoints

The following endpoints have no auth:
- `GET /health` - intentional
- `GET /` - intentional
- `GET /widgets/*` - static assets
- All `/.well-known/*` endpoints - intentional per OAuth spec
- `POST /register` - intentional per DCR spec
- `GET/POST /authorize` - intentional (user authenticates during flow)
- `POST /token` - intentional (validates via code/PKCE)
- `POST /token/introspect` - **POTENTIALLY SENSITIVE** - allows introspecting any token

---

## 7. Frontend / Widget Auth Usage

### Client App (Authorization UI)

`src/client/src/routes/AuthorizePage.tsx`

**Uses Privy SDK directly**:
```typescript
const {
  login,
  authenticated,
  user,
  getAccessToken
} = usePrivy();
```

**Auth flow**:
1. Calls `login()` to trigger Privy OAuth
2. On authenticated, calls `getAccessToken()` to get Privy token
3. POSTs token to server's `/authorize/complete`
4. Redirects to ChatGPT with auth code

**Does NOT**:
- Store tokens in localStorage/sessionStorage
- Make direct calls to protected endpoints
- Manage bearer tokens directly

### Widgets (ChatGPT embedded)

`src/widgets/`

**Widgets do NOT handle auth directly.** They:
1. Receive tool output via `window.openai.toolOutput`
2. Call other tools via `window.openai.callTool()`
3. Do not have access to bearer tokens
4. Do not call backend endpoints directly

**Exception**: `IntentDisplay.tsx:41-59` makes direct API call:
```typescript
const deleteIntent = async (id: string) => {
  await fetch(`/api/intents/${id}`, {
    method: 'DELETE',
  });
};
```

**NOTE**: This `/api/intents/:id` endpoint is not implemented in the server. This appears to be dead code or placeholder.

---

## 8. Configuration and Environment

### Environment Variables

**Privy** (`.env.example`):
```bash
VITE_PRIVY_APP_ID=your-privy-app-id-here  # Client
PRIVY_APP_ID=your-privy-app-id-here       # Server
PRIVY_APP_SECRET=your-privy-app-secret-here
```

**JWT Signing**:
```bash
JWT_PRIVATE_KEY=your-base64-encoded-private-key
JWT_PUBLIC_KEY=your-base64-encoded-public-key
```

**OAuth/OIDC**:
```bash
SERVER_BASE_URL=http://localhost:3002  # Used as issuer and audience
```

**All config wired in** `src/server/config.ts`

### Per-Environment Differences

**Production checks**:
- `src/server/oauth/dcr.ts:60-66`: HTTPS required for redirect_uris
```typescript
if (isProduction()) {
  const hasInsecureUri = redirect_uris.some(
    (uri: string) => !uri.startsWith('https://')
  );
  if (hasInsecureUri) {
    return res.status(400).json({...});
  }
}
```

- `src/server/config.ts:65-66`:
```typescript
export const isProduction = () => config.server.nodeEnv === 'production';
export const isDevelopment = () => config.server.nodeEnv === 'development';
```

---

## 9. Special Cases, Edge Paths, and "Weird" Code

### Fallback Token Verification

`src/server/oauth/authorize.ts:136-166`

The `/authorize/complete` endpoint accepts an optional `fallback_token`:
```typescript
let verifiedClaims: PrivyClaims;
try {
  verifiedClaims = await privyClient.verifyAuthToken(privy_token);
} catch (error) {
  if (fallback_token) {
    try {
      verifiedClaims = await privyClient.verifyAuthToken(fallback_token);
      // Use fallback_token as the stored token
    } catch {
      return res.status(401).json({...});
    }
  }
}
```

**Note**: The fallback token becomes the stored token if primary fails. Purpose unclear.

### Static Client Pre-registration

`src/server/oauth/storage.ts:11-15`

```typescript
const STATIC_CLIENT_ID = 'chatgpt-connector';
const STATIC_REDIRECT_URIS = [
  'https://chat.openai.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector_platform_oauth_redirect',
];
```

This client is always available without DCR.

### Automatic Scope Addition

`src/server/oauth/authorize.ts:177-182` and Line 311-317

```typescript
// Always include privy:token:exchange for MCP
if (!finalScopes.includes('privy:token:exchange')) {
  finalScopes.push('privy:token:exchange');
}
```

**All authorization flows add this scope automatically** even if not requested.

### Dead Code: Widget API Call

`src/widgets/src/IntentDisplay/IntentDisplay.tsx:41-59`

```typescript
const deleteIntent = async (id: string) => {
  await fetch(`/api/intents/${id}`, {
    method: 'DELETE',
  });
};
```

The `/api/intents/:id` endpoint does not exist in the server.

### Token Introspection Without Auth

`src/server/oauth/token.ts:280-323`

`POST /token/introspect` has no authentication requirement. Anyone can introspect tokens if they have the token string.

### In-Memory Storage Warning

`src/server/oauth/storage.ts` uses in-memory Maps. Comment at top:
```typescript
// TODO: Replace with database storage for production
```

This means:
- All tokens lost on server restart
- No horizontal scaling
- No persistence

### Console Logging Tokens

`src/server/oauth/authorize.ts:327`:
```typescript
console.log('Storing authorization code with privy token');
```

Not sensitive data logged, but indicates debug code in auth flow.

### Hardcoded Key ID

Multiple locations use `kid: 'key-1'`:
- `src/server/oauth/token.ts:254`
- `src/server/oauth/wellknown.ts:97`

No key rotation mechanism.

---

## 10. Summary and Open Questions

### Implemented Main Flow

```
1. ChatGPT initiates OAuth → GET /authorize (with PKCE)
2. Server serves React auth UI
3. User authenticates with Privy (email/wallet/social)
4. Client gets Privy access token
5. Client POSTs to /authorize/complete with Privy token
6. Server verifies Privy token, stores auth code WITH Privy token
7. Server returns auth code to client
8. Client redirects to ChatGPT with code
9. ChatGPT exchanges code for tokens → POST /token
10. Server validates PKCE, issues JWT access token
    - JWT sub = Privy DID
    - Stores refresh token WITH Privy token
11. ChatGPT calls MCP tool → POST /mcp with Bearer token
12. Server validates JWT, extracts userId (Privy DID)
13. If tool needs Privy API access:
    a. Tool exchanges OAuth token for Privy token
    b. POSTs to /token/privy/access-token with Bearer {oauth_token}
    c. Server returns stored Privy token
    d. Tool calls Protocol API with Privy token
14. Tool returns result to ChatGPT
```

### Open Questions / Ambiguities

1. **Fallback token purpose**: `/authorize/complete` accepts `fallback_token` but its use case is not documented. When would primary token fail but fallback succeed?

2. **Token introspection security**: `/token/introspect` is unauthenticated. Is this intentional? Could leak token metadata.

3. **Dead widget code**: `IntentDisplay` calls `/api/intents/:id` which doesn't exist. Is this future functionality or dead code?

4. **In-memory storage**: Production deployment would need database replacement. No migration path documented.

5. **Privy token lifetime**: The system stores Privy tokens but doesn't validate their expiration before exchange. If OAuth token lives longer than Privy token, exchange could return expired token.

6. **No user consent UI**: The `/authorize` POST endpoint accepts `user_consent` parameter but doesn't actually display a consent screen - it's auto-approved.

7. **Missing OIDC features**: `.well-known/openid-configuration` exists but no `id_token` is issued. Endpoint may mislead clients expecting full OIDC.

8. **Scope validation asymmetry**: `privy:token:exchange` is auto-added but other scopes are strictly validated. Client could be surprised by unexpected scope in token.

9. **Widget security**: Widgets make `fetch()` calls without auth headers. These would only work if backend endpoints check cookies (none do) or are unprotected.

10. **Key rotation**: Single key with `kid: 'key-1'` and no rotation mechanism. Compromised key requires all token invalidation.

11. **Client secret not used**: `token_endpoint_auth_method: 'none'` - relies entirely on PKCE. No client authentication for refresh token grants.

12. **No revocation endpoint**: No way to revoke tokens except waiting for expiry.
