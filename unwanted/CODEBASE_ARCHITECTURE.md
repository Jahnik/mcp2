# index network mcp2 codebase architecture report

## overview

this codebase implements a **connected chatgpt app** that bridges chatgpt users to the index network protocol via oauth2 and mcp (model context protocol). the core product is an intent extraction system: users can ask chatgpt to analyze text and extract structured "intents" (goals/needs/objectives), which are then sent to the protocol api for processing.

the system consists of three main parts:
1. **backend server**: express-based node.js server handling oauth2 flows, mcp endpoint, and token management
2. **react frontend client**: privy-based authentication ui for the oauth consent flow
3. **react widgets**: standalone components that render inside chatgpt's ui to display tool results

the architecture follows a custom oauth2 authorization server pattern where:
- chatgpt acts as an oauth client
- the server issues jwts containing privy user ids
- mcp tools exchange these jwts back for the original privy tokens to call the protocol api

---

## components

### backend/api

**location**: `src/server/`

**main entrypoint**: [index.ts](src/server/index.ts)

**framework**: express with vite-express for development hmr

**key responsibilities**:
- serve oauth2 discovery endpoints (/.well-known/*)
- handle authorization and token issuance
- expose mcp endpoint for chatgpt tool calls
- serve static widget assets
- proxy to vite dev server in development

**server startup flow**:
1. loads environment config from [config.ts](src/server/config.ts)
2. initializes mcp server and registers tools
3. mounts all routers (wellknown, authorize, token, mcp)
4. in production: serves static dist files
5. in development: uses vite-express for hmr

---

### mcp server & tools

**location**: `src/server/mcp/`

**server initialization**: [server.ts](src/server/mcp/server.ts)

the mcp server is built on `@modelcontextprotocol/sdk` and exposes tools to chatgpt.

#### tools exposed

| tool name | file/function | input schema | output | auth required | side effects |
|-----------|---------------|--------------|--------|---------------|--------------|
| `echo` | [tools.ts:334-368](src/server/mcp/tools.ts#L334-368) `handleEcho` | `{ text: string }` | returns text in widget | no | none |
| `get-items` | [tools.ts:182-257](src/server/mcp/tools.ts#L182-257) `handleGetItems` | `{ filter?: string }` | list of items for widget | yes | calls protocol api `/items` |
| `perform-item-action` | [tools.ts:262-328](src/server/mcp/tools.ts#L262-328) `handlePerformAction` | `{ itemId: string, action: string }` | action result | yes | calls protocol api `/items/{id}/actions` |
| `extract_intent` | [tools.ts:373-467](src/server/mcp/tools.ts#L373-467) `handleExtractIntent` | `{ fullInputText: string, rawText?: string, conversationHistory?: string, userMemory?: string }` | extracted intents for widget | yes | exchanges for privy token, calls protocol api `/discover/new` |

**tool registration**: [tools.ts:41-151](src/server/mcp/tools.ts#L41-151) `registerTools`

**openai metadata annotations** for widgets are set via `_meta` properties:
- `openai/outputTemplate`: uri to widget html
- `openai/toolInvocation/invoking` / `invoked`: loading state messages
- `openai/widgetAccessible`: true
- `openai/resultCanProduceWidget`: true

#### widget resources

**location**: [resources.ts](src/server/mcp/resources.ts)

widgets are registered as mcp resources with uri pattern `ui://widget/{name}.html`. the server:
1. checks for built widget files in `dist/widgets/`
2. generates html that loads js/css from the server's `/widgets/` static route
3. serves html with `text/html+skybridge` mime type

registered widgets:
- `ui://widget/list-view.html` - interactive item list
- `ui://widget/echo.html` - simple text display
- `ui://widget/intent-display.html` - intent analysis results

---

### chatgpt app/config

**mcp http handler**: [handlers.ts](src/server/mcp/handlers.ts)

the mcp endpoint accepts json-rpc over http:
- `POST /mcp` - main tool call endpoint, requires oauth bearer token with `read` scope
- `GET /mcp` - sse endpoint for streaming (optional, not heavily used)

**auth integration**: the `validateToken` middleware extracts `req.auth` containing:
- `token`: raw jwt
- `decoded`: jwt payload
- `userId`: privy did
- `scopes`: string array

this auth context is passed to mcp tool handlers via `extra.auth`.

**static client configuration**: chatgpt is pre-registered in [storage.ts:10-15](src/server/oauth/storage.ts#L10-15):
```typescript
const STATIC_CLIENT_ID = 'chatgpt-connector';
const STATIC_REDIRECT_URIS = [
  'https://chat.openai.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector_platform_oauth_redirect',
];
```

---

### auth/identity

#### identity model

**canonical user identifier**: privy did (e.g., `did:privy:clx...`)

the system does not maintain its own user database. user identity is:
1. established via privy authentication on frontend
2. verified via privy sdk on backend
3. stored temporarily in authorization codes and tokens
4. passed through to protocol api calls

**no organizations/teams/spaces support** - single-user model only.

#### oauth2 implementation

**discovery endpoints** ([wellknown.ts](src/server/oauth/wellknown.ts)):
- `GET /.well-known/oauth-authorization-server` - rfc 8414 metadata
- `GET /.well-known/oauth-protected-resource` - resource metadata
- `GET /.well-known/jwks.json` - public key for jwt verification
- `GET /.well-known/openid-configuration` - oidc metadata (future use)

also mirrored under `/mcp/.well-known/*` for scoped discovery.

**authorization flow** ([authorize.ts](src/server/oauth/authorize.ts)):

1. `GET /authorize` - validates oauth params, passes to react frontend
   - required: `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`
   - frontend handles privy login

2. `POST /authorize/complete` - programmatic completion (main flow)
   - receives: state, privy_token, oauth params
   - verifies privy token via `PrivyClient.verifyAuthToken()`
   - stores authorization code with privy token for later exchange
   - returns redirect url with code

3. `POST /authorize` - alternative browser-based consent (legacy)
   - similar to above but expects `user_consent` boolean

**token endpoint** ([token.ts](src/server/oauth/token.ts)):

1. `POST /token` (grant_type=authorization_code)
   - validates pkce code_verifier
   - issues jwt access token (rs256, 1 hour)
   - issues opaque refresh token (30 days)
   - stores token→privy token mapping for later exchange

2. `POST /token` (grant_type=refresh_token)
   - rotates refresh token
   - issues new access token

3. `POST /token/introspect` - token info (debugging)

4. `POST /token/privy/access-token` - **key endpoint**
   - requires `privy:token:exchange` scope
   - looks up stored privy token by oauth access token
   - returns original privy token for protocol api calls

**jwt claims**:
- `sub`: privy did
- `scope`: space-separated scopes (always includes `privy:token:exchange`)
- `aud`: server base url
- `client_id`: oauth client id
- `iss`: server base url
- `exp`, `iat`: timestamps

**supported scopes**: `['read', 'write', 'profile', 'privy:token:exchange']`

#### auth enforcement

**jwt validation middleware**: [middleware/auth.ts](src/server/middleware/auth.ts) `validateToken`
- extracts bearer token
- verifies jwt signature/expiry/issuer/audience
- checks required scopes
- returns proper www-authenticate headers on failure

**privy token verification**: [middleware/privy.ts](src/server/middleware/privy.ts) `verifyPrivyToken`
- used directly for privy-authenticated requests
- calls `PrivyClient.verifyAuthToken()`

**where auth is enforced**:
- `POST /mcp` - requires `['read']` scope
- `GET /mcp` - requires `['read']` scope
- `POST /token/privy/access-token` - requires `['privy:token:exchange']` scope

---

### data/storage

**location**: [oauth/storage.ts](src/server/oauth/storage.ts)

**storage type**: in-memory maps (no persistent database)

**data stores**:
```typescript
const authorizationCodes = new Map<string, AuthorizationCode>();
const registeredClients = new Map<string, RegisteredClient>();
const tokens = new Map<string, TokenData>();
const refreshTokens = new Map<string, RefreshTokenData>();
```

**key data structures**:

```typescript
interface AuthorizationCode {
  code: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;  // stored for later exchange
  privyClaims?: PrivyClaims;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  expiresAt: number;
  used: boolean;
}

interface TokenData {
  accessToken: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;  // stored for later exchange
  scopes: string[];
  expiresAt: number;
}
```

**cleanup**: auto-cleanup runs every 5 minutes to remove expired codes/tokens.

**limitations**:
- all data lost on server restart
- no horizontal scaling support
- comment explicitly states: "In production, replace with a database (Redis, PostgreSQL, etc.)"

---

### external integrations

#### privy

**purpose**: user authentication and identity

**client libraries**:
- `@privy-io/react-auth` - frontend provider
- `@privy-io/server-auth` - backend verification

**config**:
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET` - app credentials
- `VITE_PRIVY_APP_ID` - frontend app id

**backend usage**:
- `PrivyClient.verifyAuthToken(token)` - verify privy jwt
- returns claims with `userId` (privy did), `appId`

**frontend usage**: [client/src/main.tsx](src/client/src/main.tsx)
- `PrivyProvider` wraps app
- configures login methods: email, wallet, google, twitter, discord
- `getAccessToken()` retrieves privy jwt

#### protocol api

**purpose**: intent extraction and other domain operations

**base url**: `PROTOCOL_API_URL` env var (default: `http://localhost:3000`)

**endpoints called**:

1. `POST /discover/new`
   - called by `extract_intent` tool
   - auth: bearer token (privy token)
   - body: FormData with `payload` field
   - response: `{ intents: [...], filesProcessed, linksProcessed, intentsGenerated }`
   - timeout: configurable via `PROTOCOL_API_TIMEOUT_MS` (default 60s)

2. `GET /items`, `POST /items/{id}/actions` (placeholders)
   - called by `get-items` and `perform-item-action` tools
   - currently marked as "placeholder - replace with actual Protocol API endpoints"

**error handling**:
- timeouts via AbortSignal
- errors logged and returned as tool errors

---

### frontend(s)

#### oauth consent ui

**location**: `src/client/`

**framework**: react with vite, react-router-dom

**pages**:

1. `/authorize` - [AuthorizePage.tsx](src/client/src/routes/AuthorizePage.tsx)
   - validates oauth params from query string
   - shows "sign in with privy" button if not authenticated
   - auto-completes authorization once authenticated
   - sends privy token to `/authorize/complete`
   - redirects to chatgpt with authorization code

2. `/error` - [ErrorPage.tsx](src/client/src/routes/ErrorPage.tsx)
   - displays oauth errors with return button

**privy configuration** ([main.tsx](src/client/src/main.tsx)):
- login methods: email, wallet, google, twitter, discord
- creates embedded wallets for users without wallets
- light theme

#### chatgpt widgets

**location**: `src/widgets/`

**framework**: react (bundled standalone, not externalized)

**build**: [vite.config.ts](src/widgets/vite.config.ts) - library mode, es modules

**widgets**:

1. **ListView** ([ListView.tsx](src/widgets/src/ListView/ListView.tsx))
   - displays list of items from `get-items` tool
   - supports selection and actions via `callTool`
   - persists state via `useWidgetState`

2. **Echo** ([Echo.tsx](src/widgets/src/Echo/Echo.tsx))
   - displays echoed text
   - shows timestamp
   - supports light/dark theme

3. **IntentDisplay** ([IntentDisplay.tsx](src/widgets/src/IntentDisplay/IntentDisplay.tsx))
   - displays extracted intents from `extract_intent` tool
   - shows processing stats (files, links)
   - supports removing intents (calls `/api/intents/{id}`)

**openai api integration**: [useOpenAi.ts](src/widgets/src/hooks/useOpenAi.ts)
- uses `useSyncExternalStore` to subscribe to `window.openai`
- provides methods: `callTool`, `sendMessage`, `openLink`, `requestDisplayMode`
- receives: `toolOutput`, `toolInput`, `theme`, `displayMode`

**type definitions**: [openai.d.ts](src/widgets/src/types/openai.d.ts)

---

### background jobs (none)

**no background jobs/workers; all behavior is request-driven.**

the only recurring operation is the in-memory cleanup interval (every 5 minutes) in [storage.ts:87-109](src/server/oauth/storage.ts#L87-109).

---

## flows

### flow 1: connect app (oauth)

1. **chatgpt initiates oauth** → `GET /authorize?client_id=chatgpt-connector&redirect_uri=...&code_challenge=...&code_challenge_method=S256&scope=read&state=...`

2. **server validates params** → [authorize.ts:28-96](src/server/oauth/authorize.ts#L28-96)
   - checks response_type=code
   - validates client_id against registered clients
   - validates redirect_uri

3. **react frontend loads** → user sees "sign in with privy" button

4. **user authenticates with privy** → `usePrivy().login()`
   - privy modal opens
   - user chooses method (email, google, wallet, etc.)
   - privy returns access token

5. **frontend calls authorize/complete** → `POST /authorize/complete`
   - body: `{ state, privy_token, client_id, redirect_uri, scope, code_challenge, code_challenge_method }`

6. **server verifies privy token** → [authorize.ts:137-165](src/server/oauth/authorize.ts#L137-165)
   - calls `privyClient.verifyAuthToken(privy_token)`
   - extracts `privyClaims.userId`

7. **server stores authorization code** → [storage.ts:112-120](src/server/oauth/storage.ts#L112-120)
   - includes privy token for later exchange
   - expires in 30 seconds

8. **server returns redirect url** → `{ code, redirect_uri, state }`

9. **frontend redirects to chatgpt** → `window.location.href = redirect_uri`

10. **chatgpt exchanges code for tokens** → `POST /token`
    - body: `{ grant_type: authorization_code, code, code_verifier, client_id, redirect_uri }`

11. **server validates and issues tokens** → [token.ts:61-164](src/server/oauth/token.ts#L61-164)
    - validates pkce
    - issues jwt access token (1 hour)
    - issues refresh token (30 days)
    - stores token→privy token mapping

12. **chatgpt receives tokens** → `{ access_token, refresh_token, token_type: Bearer, expires_in, scope }`

### flow 2: call tool from chatgpt

1. **chatgpt sends mcp request** → `POST /mcp`
   - headers: `Authorization: Bearer <access_token>`
   - body: `{ jsonrpc: "2.0", method: "tools/call", params: { name: "extract_intent", arguments: {...} }, id: "..." }`

2. **server validates token** → [middleware/auth.ts:27-82](src/server/middleware/auth.ts#L27-82)
   - verifies jwt signature
   - checks audience, issuer, expiry
   - extracts scopes
   - attaches `req.auth`

3. **mcp handler processes request** → [handlers.ts:17-57](src/server/mcp/handlers.ts#L17-57)
   - passes `extra.auth` to tool handler

4. **tool handler executes** → [tools.ts:373-467](src/server/mcp/tools.ts#L373-467) for `extract_intent`
   - validates auth present
   - validates input with zod

5. **tool exchanges for privy token** → `POST /token/privy/access-token`
   - [tools.ts:472-493](src/server/mcp/tools.ts#L472-493) `exchangePrivyToken`
   - server looks up stored privy token

6. **tool calls protocol api** → `POST ${PROTOCOL_API_URL}/discover/new`
   - auth: `Bearer <privy_token>`
   - body: FormData with payload

7. **tool returns result** → `{ content: [...], structuredContent: {...}, _meta: {...} }`

8. **chatgpt renders widget** → loads html from `ui://widget/intent-display.html`

### flow 3: refresh tokens

1. **chatgpt token expires** → 401 from `/mcp`

2. **chatgpt refreshes** → `POST /token`
   - body: `{ grant_type: refresh_token, refresh_token, client_id }`

3. **server rotates tokens** → [token.ts:166-234](src/server/oauth/token.ts#L166-234)
   - deletes old refresh token
   - issues new access and refresh tokens
   - preserves privy token association

---

## configuration

### environment variables

**required**:
- `PRIVY_APP_ID` - privy app id
- `PRIVY_APP_SECRET` - privy app secret
- `SERVER_BASE_URL` - e.g., `http://localhost:3002`
- `JWT_PRIVATE_KEY` - base64-encoded rsa private key
- `JWT_PUBLIC_KEY` - base64-encoded rsa public key
- `PROTOCOL_API_URL` - protocol api base url

**optional**:
- `PORT` - server port (default: 3002)
- `NODE_ENV` - development/production
- `VITE_PRIVY_APP_ID` - frontend privy app id
- `PROTOCOL_API_TIMEOUT_MS` - api timeout (default: 60000)
- `PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS` - exchange timeout (default: 10000)
- `EXTRACT_INTENT_SECTION_CHAR_LIMIT` - truncation limit (default: 5000)
- `EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT` - instruction limit (default: 2000)

### scripts

```json
{
  "dev": "bun --watch src/server/index.ts",
  "dev:widgets": "vite build --config src/widgets/vite.config.ts --watch",
  "dev:all": "concurrently \"bun run dev:widgets\" \"sleep 2 && bun run dev\"",
  "build": "bun run build:client && bun run build:widgets && bun run build:server",
  "build:client": "vite build --config src/client/vite.config.ts",
  "build:widgets": "vite build --config src/widgets/vite.config.ts",
  "build:server": "tsc -p tsconfig.server.json",
  "start": "NODE_ENV=production bun dist/server/index.js",
  "test:e2e-auth": "bun --bun vitest run --config vitest.e2e.auth.config.ts"
}
```

### deployment

**dockerfile**: [Dockerfile](Dockerfile)
- multi-stage build with bun
- builds client, widgets, server
- runs production server on port 3002
- healthcheck against `/health`

**assumptions**:
- single service deployment
- requires all env vars set externally
- no kubernetes/docker-compose provided
- compatible with any platform supporting bun (or node)

---

## testing and quality

### test structure

**location**: `tests/e2e/auth/`

**framework**: vitest with custom configuration [vitest.e2e.auth.config.ts](vitest.e2e.auth.config.ts)

**test categories**:

1. **flows/** - happy path tests
   - [flow_connect_app.spec.ts](tests/e2e/auth/flows/flow_connect_app.spec.ts) - oauth flow
   - [flow_tool_usage.spec.ts](tests/e2e/auth/flows/flow_tool_usage.spec.ts) - tool calls
   - [flow_refresh_tokens.spec.ts](tests/e2e/auth/flows/flow_refresh_tokens.spec.ts) - token refresh

2. **errors/** - error condition tests
   - [errors_authorize.spec.ts](tests/e2e/auth/errors/errors_authorize.spec.ts)
   - [errors_token.spec.ts](tests/e2e/auth/errors/errors_token.spec.ts)
   - [errors_mcp.spec.ts](tests/e2e/auth/errors/errors_mcp.spec.ts)

3. **security/** - security tests
   - [security_introspection.spec.ts](tests/e2e/auth/security/security_introspection.spec.ts)
   - [security_privy_exchange.spec.ts](tests/e2e/auth/security/security_privy_exchange.spec.ts)

### test infrastructure

**helpers** (`tests/e2e/auth/helpers/`):

- [setup.ts](tests/e2e/auth/helpers/setup.ts) - beforeAll/afterAll hooks
- [server-bootstrap.ts](tests/e2e/auth/helpers/server-bootstrap.ts) - starts test server
- [fake-privy.ts](tests/e2e/auth/helpers/fake-privy.ts) - mocks privy verification
- [fake-protocol-api.ts](tests/e2e/auth/helpers/fake-protocol-api.ts) - mocks protocol api
- [flow-helpers.ts](tests/e2e/auth/helpers/flow-helpers.ts) - reusable test functions
- [crypto.ts](tests/e2e/auth/helpers/crypto.ts) - pkce generation, jwt decoding

**key helper functions**:
- `runFullOauthFlow()` - complete oauth flow
- `callMcpWithAccessToken()` - call mcp tools
- `exchangeForPrivyToken()` - token exchange
- `setRouteResponse()` / `setRouteError()` - configure fake api responses

### test coverage

**well-covered**:
- oauth authorization flow
- token issuance and refresh
- pkce validation
- mcp tool calls
- privy token exchange
- error conditions (invalid tokens, missing params)
- input validation

**not covered**:
- frontend react components (no jest/rtl tests)
- widget rendering in chatgpt
- actual privy auth (mocked)
- actual protocol api (mocked)
- production deployment

### ci

no ci configuration found in repo. tests run manually via:
```bash
bun run test:e2e-auth
```

---

## limitations and future work

### known limitations

1. **in-memory storage** ([storage.ts:4](src/server/oauth/storage.ts#L4))
   - all tokens/codes lost on restart
   - no horizontal scaling
   - explicitly needs database for production

2. **placeholder api endpoints** ([backend.ts:52-78](src/server/api/backend.ts#L52-78))
   - `getItems`, `performAction`, `getUserProfile` are stubs
   - not connected to actual protocol api endpoints

3. **no token revocation**
   - no endpoint to revoke access/refresh tokens
   - users cannot disconnect the app

4. **no multi-org support**
   - single user identity only
   - no team/organization concepts

5. **no rate limiting**
   - no protection against abuse
   - no request throttling

6. **static oauth client only**
   - dcr endpoint exists but not typically used
   - chatgpt-connector is hardcoded

7. **widget remove intent api**
   - `DELETE /api/intents/{id}` referenced but not implemented
   - will 404 in production

### architectural constraints

1. **privy token passthrough**
   - system stores privy tokens in memory
   - tokens could expire between storage and use
   - no refresh mechanism for privy tokens

2. **single service deployment**
   - frontend and backend tightly coupled
   - widgets bundled into server
   - no microservices architecture

3. **jwt-only auth**
   - no opaque token alternative
   - tokens contain user identity (privacy consideration)

### production readiness

**required for production**:
- [ ] persistent storage (redis/postgres)
- [ ] token revocation endpoints
- [ ] rate limiting
- [ ] https enforcement (currently only checked for redirect_uris)
- [ ] monitoring/alerting
- [ ] ci/cd pipeline

---

## uncertainties

### ambiguous areas

1. **widget /api/intents/{id} endpoint**
   - [IntentDisplay.tsx:41-44](src/widgets/src/IntentDisplay/IntentDisplay.tsx#L41-44) calls `DELETE /api/intents/{id}`
   - no such route exists in server code
   - will fail silently or 404

2. **get-items/perform-action protocol api**
   - [backend.ts:54-71](src/server/api/backend.ts#L54-71) are placeholders
   - unclear if protocol api actually has these endpoints
   - may not work in production

3. **privy token expiry**
   - stored privy tokens may expire
   - no handling for expired privy tokens during exchange
   - could cause silent failures in tool calls

4. **widget state persistence**
   - `useWidgetState` hook referenced but implementation not clear
   - depends on chatgpt's `window.openai.setWidgetState`

5. **dynamic client registration use case**
   - dcr endpoint implemented ([dcr.ts](src/server/oauth/dcr.ts))
   - unclear if chatgpt uses it or only static client

6. **protocol api contract**
   - only `/discover/new` clearly documented
   - other endpoints inferred from placeholder code

### files to investigate for clarity

- protocol api documentation (external)
- chatgpt connected apps sdk documentation
- privy token lifecycle documentation

---

## appendix: file index

### server
- [src/server/index.ts](src/server/index.ts) - main entrypoint
- [src/server/config.ts](src/server/config.ts) - configuration
- [src/server/mcp/server.ts](src/server/mcp/server.ts) - mcp initialization
- [src/server/mcp/tools.ts](src/server/mcp/tools.ts) - tool definitions
- [src/server/mcp/handlers.ts](src/server/mcp/handlers.ts) - http handler
- [src/server/mcp/resources.ts](src/server/mcp/resources.ts) - widget resources
- [src/server/oauth/wellknown.ts](src/server/oauth/wellknown.ts) - discovery
- [src/server/oauth/authorize.ts](src/server/oauth/authorize.ts) - authorization
- [src/server/oauth/token.ts](src/server/oauth/token.ts) - token issuance
- [src/server/oauth/dcr.ts](src/server/oauth/dcr.ts) - client registration
- [src/server/oauth/storage.ts](src/server/oauth/storage.ts) - data storage
- [src/server/middleware/auth.ts](src/server/middleware/auth.ts) - jwt validation
- [src/server/middleware/privy.ts](src/server/middleware/privy.ts) - privy verification
- [src/server/api/backend.ts](src/server/api/backend.ts) - protocol api client

### client
- [src/client/src/main.tsx](src/client/src/main.tsx) - entrypoint with privy provider
- [src/client/src/App.tsx](src/client/src/App.tsx) - router
- [src/client/src/routes/AuthorizePage.tsx](src/client/src/routes/AuthorizePage.tsx) - oauth ui
- [src/client/src/routes/ErrorPage.tsx](src/client/src/routes/ErrorPage.tsx) - error display

### widgets
- [src/widgets/src/ListView/ListView.tsx](src/widgets/src/ListView/ListView.tsx)
- [src/widgets/src/Echo/Echo.tsx](src/widgets/src/Echo/Echo.tsx)
- [src/widgets/src/IntentDisplay/IntentDisplay.tsx](src/widgets/src/IntentDisplay/IntentDisplay.tsx)
- [src/widgets/src/hooks/useOpenAi.ts](src/widgets/src/hooks/useOpenAi.ts)
- [src/widgets/src/shared/IntentList.tsx](src/widgets/src/shared/IntentList.tsx)
- [src/widgets/src/types/openai.d.ts](src/widgets/src/types/openai.d.ts)

### tests
- [vitest.e2e.auth.config.ts](vitest.e2e.auth.config.ts)
- [tests/e2e/auth/helpers/setup.ts](tests/e2e/auth/helpers/setup.ts)
- [tests/e2e/auth/flows/flow_connect_app.spec.ts](tests/e2e/auth/flows/flow_connect_app.spec.ts)
- [tests/e2e/auth/flows/flow_tool_usage.spec.ts](tests/e2e/auth/flows/flow_tool_usage.spec.ts)
