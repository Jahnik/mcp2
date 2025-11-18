# MCP2 Architecture - Quick Reference Summary

## Directory Structure (Key Files)

```
src/
├── server/
│   ├── index.ts                    # Express app entry point
│   ├── config.ts                   # Config from environment variables
│   ├── oauth/
│   │   ├── authorize.ts            # /authorize, /authorize/complete endpoints
│   │   ├── token.ts                # /token, /token/privy/access-token endpoints
│   │   ├── storage.ts              # In-memory auth codes, tokens, clients
│   │   ├── dcr.ts                  # Dynamic Client Registration
│   │   └── wellknown.ts            # OAuth discovery endpoints
│   ├── mcp/
│   │   ├── server.ts               # MCP server initialization
│   │   ├── tools.ts                # Tool definitions & handlers
│   │   ├── handlers.ts             # HTTP request handlers for /mcp
│   │   └── resources.ts            # Widget resource registration
│   ├── middleware/
│   │   ├── auth.ts                 # OAuth token validation (validateToken)
│   │   └── privy.ts                # Privy token verification
│   └── api/
│       └── backend.ts              # Protocol API integration
│
├── widgets/                        # React widgets for ChatGPT
│   ├── src/
│   │   ├── Echo/                   # Simple echo widget
│   │   ├── IntentDisplay/          # Intent display widget
│   │   ├── ListView/               # List view widget
│   │   ├── shared/
│   │   │   └── IntentList.tsx      # Reusable intent list
│   │   ├── hooks/
│   │   │   ├── useOpenAi.ts        # Access window.openai API
│   │   │   └── useWidgetState.ts   # Persist state
│   │   └── types/
│   │       └── openai.d.ts         # Type defs for window.openai
│   └── vite.config.ts              # Widget build config
│
└── client/                         # React SPA for OAuth UI
```

## Critical Files by Function

### 1. Express Routes
- **Entry:** `/Users/jahnik/index-network/mcp2/src/server/index.ts`
- **OAuth Authorize:** `/Users/jahnik/index-network/mcp2/src/server/oauth/authorize.ts`
  - `GET /authorize` - OAuth UI
  - `POST /authorize` - Receive Privy token, return auth code
  - `POST /authorize/complete` - Non-interactive auth
- **OAuth Token:** `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts`
  - `POST /token` - Exchange auth code for JWT access token
  - `POST /token/privy/access-token` - **Exchange OAuth token for Privy token** (critical for tools)
- **MCP:** `/Users/jahnik/index-network/mcp2/src/server/mcp/handlers.ts`
  - `POST /mcp` - JSON-RPC 2.0 tool calls

### 2. MCP Tools
- **File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/tools.ts`
- **Tools:**
  1. `get-items` - Fetch items from backend
  2. `perform-item-action` - Action on specific item
  3. `echo` - Simple echo tool
  4. **`extract_intent`** - Extract intents from text + files + context
     - Input: fullInputText (required), rawText, conversationHistory, userMemory
     - Process: Exchange token → Call Protocol API `/discover/new` → Return intents
     - Output: `{ intents, filesProcessed, linksProcessed, intentsGenerated }`
     - Widget: `ui://widget/intent-display.html`

### 3. Auth & Token Flow
- **Privy Integration:** `/Users/jahnik/index-network/mcp2/src/server/oauth/authorize.ts`
  - Uses `PrivyClient.verifyAuthToken(token)` to verify Privy JWTs
  - Stores Privy token in auth code for later exchange

- **OAuth Token Storage:** `/Users/jahnik/index-network/mcp2/src/server/oauth/storage.ts`
  - Maps: `accessToken → { privyToken, privyUserId, scopes, expiresAt }`
  - Used by `/token/privy/access-token` to return Privy token to tools

- **Token Validation:** `/Users/jahnik/index-network/mcp2/src/server/middleware/auth.ts`
  - `validateToken(requiredScopes)` - Verify JWT and check scopes
  - Attaches `req.auth = { token, decoded, userId, scopes }`

### 4. Widgets
- **Widget Types:** `/Users/jahnik/index-network/mcp2/src/widgets/src/types/openai.d.ts`
  - `window.openai.toolOutput` - Data from tool
  - `window.openai.widgetState` - Persisted state
  - `window.openai.callTool()` - Call another tool
  - `window.openai.sendFollowUpMessage()` - Send message to ChatGPT

- **Hooks:**
  - `useOpenAi()` - Read `window.openai.toolOutput`, subscribe to updates
  - `useWidgetState<T>()` - Read/write persisted widget state

- **Example Widget:** `/Users/jahnik/index-network/mcp2/src/widgets/src/IntentDisplay/IntentDisplay.tsx`
  - Reads `toolOutput.structuredContent.intents`
  - Filters removed intents
  - Renders intent list with summary

## Token Exchange Flow (Critical for Tools)

```
ChatGPT
  ↓ (calls extract_intent with Bearer {oauth_token})
MCP Tool Handler
  ↓ (exchanges token)
POST /token/privy/access-token
  ↓ (returns Privy token)
Tool Handler
  ↓ (calls Protocol API with Privy token)
Protocol API /discover/new
  ↓ (returns intents)
Tool Handler
  ↓ (returns structured response)
ChatGPT Widget
  ↓ (renders with window.openai.toolOutput)
User sees IntentDisplay widget
```

## Configuration (Environment Variables)

```bash
PRIVY_APP_ID=...              # Privy app ID
PRIVY_APP_SECRET=...          # Privy app secret
SERVER_BASE_URL=...           # Server URL (e.g., http://localhost:3002)
PORT=3002                     # Server port
NODE_ENV=development          # development or production
JWT_PRIVATE_KEY=...           # RSA private key (base64)
JWT_PUBLIC_KEY=...            # RSA public key (base64)
PROTOCOL_API_URL=...          # Protocol API URL
PROTOCOL_API_TIMEOUT_MS=60000 # Timeout
EXTRACT_INTENT_SECTION_CHAR_LIMIT=5000
EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT=2000
```

## Type Examples

### Tool Input (Zod Schema)
```typescript
// extract_intent input
{
  fullInputText: string;
  rawText?: string;
  conversationHistory?: string;
  userMemory?: string;
}
```

### Tool Output
```typescript
{
  content: [{ type: 'text'; text: string }];
  structuredContent: {
    intents: Array<{ id, payload, summary?, createdAt }>;
    filesProcessed: number;
    linksProcessed: number;
    intentsGenerated: number;
  };
  _meta: { 'openai/toolInvocation/invoked': string };
}
```

### Token Response
```typescript
// POST /token/privy/access-token returns:
{
  privyAccessToken: string;
  expiresAt: number;
  userId: string;
  scope: string[];
}
```

## For `discover_connections` Implementation

1. **Copy pattern from `extract_intent`** in `tools.ts`
2. **Define Zod schema** for input validation
3. **Create handler function** that:
   - Validates auth and input
   - Exchanges OAuth token for Privy token
   - Calls Protocol API endpoint (e.g., `/discover/connections`)
   - Returns structured response with connections data
4. **Register tool** in `registerTools()` with widget metadata
5. **Create React widget** in `src/widgets/src/DiscoverConnections/`
6. **Register widget resource** in `resources.ts`

## Build & Run

```bash
# Development
bun run dev                    # Run server (watch mode)
bun run dev:widgets           # Build widgets (watch mode)
bun run dev:all               # Both (concurrent)

# Production
bun run build                 # Build all
bun run start                 # Run production server
```

## Scope Required for Tools

- `read` - Basic tool execution
- `privy:token:exchange` - Exchange OAuth token for Privy token (required for Protocol API calls)

Scopes are added in `/authorize` and stored in token for later validation.

---

**Full details in:** `/Users/jahnik/index-network/mcp2/ARCHITECTURE.md`
