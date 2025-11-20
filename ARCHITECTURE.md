# MCP2 Repository - Complete Architecture Analysis

## Executive Summary

The mcp2 repository is a **ChatGPT App with OAuth2 bridge** that integrates:
- **Express server** for OAuth2, MCP protocol, and widget serving
- **Privy.io** for authentication and user identity management
- **MCP (Model Context Protocol)** for tool exposure
- **React widgets** that run in ChatGPT iframes
- **Protocol API** backend for intent extraction and data access

The architecture enables ChatGPT to authenticate users via Privy, exchange tokens, call MCP tools, and display interactive UI widgets.

---

## 1. EXPRESS SERVER LAYOUT

### Main Entry Point: `/Users/jahnik/index-network/mcp2/src/server/index.ts`

```typescript
// Express app with middleware for OAuth, MCP, widget serving
app.use(cors());
app.use(express.json());

// Routes:
app.get('/health')                          // Health check
app.get('/')                                // Landing page
app.use('/widgets', express.static(...))    // Widget assets (JS/CSS)
app.use('/.well-known', wellKnownRouter)    // OAuth discovery (GET /.well-known/oauth-authorization-server)
app.post('/register')                       // OAuth Dynamic Client Registration
app.use('/authorize', authorizeRouter)      // OAuth authorization endpoints
app.use('/token', tokenRouter)              // OAuth token endpoints
app.use('/mcp', mcpRouter)                  // MCP protocol endpoints
```

### OAuth Routes

#### `/authorize` - Authorization Endpoint
**File:** `/Users/jahnik/index-network/mcp2/src/server/oauth/authorize.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/authorize` | GET | Serve OAuth UI to frontend (passes through to React app) |
| `/authorize` | POST | Receive consent from frontend with Privy token; returns auth code |
| `/authorize/complete` | POST | Non-interactive flow for ChatGPT to complete auth with Privy token |

**Key Implementation:**
```typescript
// POST /authorize receives:
{
  client_id: string;
  redirect_uri: string;
  scope: string;  // Space-separated
  state: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  privy_user_id: string;
  privy_token: string;      // JWT from Privy frontend
  user_consent: boolean;
}

// Returns:
{
  redirect_uri: string;     // With auth code appended
  code: string;            // Authorization code
  state?: string;
}
```

**Auth Flow:**
1. Receives Privy JWT from frontend
2. Verifies with `privyClient.verifyAuthToken(privy_token)` 
3. Stores auth code with Privy token + verified claims
4. Returns code for exchange at `/token` endpoint

#### `/token` - Token Endpoint
**File:** `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts`

| Endpoint | Method | Grant Type | Purpose |
|----------|--------|-----------|---------|
| `/token` | POST | `authorization_code` | Exchange auth code for access token + refresh token |
| `/token` | POST | `refresh_token` | Refresh expired access tokens |
| `/token/introspect` | POST | - | Token validation (debug endpoint) |
| `/token/privy/access-token` | POST | - | **Exchange OAuth token for Privy token** (for MCP tools) |

**Key Implementation - Token Exchange:**
```typescript
// POST /token with grant_type=authorization_code
{
  grant_type: 'authorization_code';
  code: string;
  code_verifier: string;      // PKCE
  client_id: string;
  redirect_uri?: string;
  resource?: string;          // OAuth resource audience
}

// Returns:
{
  access_token: string;       // JWT signed with server's private key
  refresh_token: string;      // Opaque refresh token
  token_type: 'Bearer';
  expires_in: number;         // Seconds (3600)
  scope: string;
}
```

**Critical: Privy Token Exchange Endpoint**
```typescript
// POST /token/privy/access-token
// Requires: Bearer {oauth_access_token}
// Requires scope: 'privy:token:exchange'

// Returns:
{
  privyAccessToken: string;   // Original Privy token from auth code
  expiresAt: number;
  userId: string;             // Privy user ID
  scope: string[];
}
```

**Why this matters for `discover_connections`:**
- MCP tools receive OAuth access token from ChatGPT
- `extract_intent` tool calls `/token/privy/access-token` to exchange it
- Gets original Privy token to call Protocol API (`/discover/new`)
- Protocol API requires Privy bearer token in `Authorization: Bearer {privyToken}` header

#### `/mcp` - MCP Protocol Endpoint
**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/handlers.ts`

```typescript
// POST /mcp - Main MCP JSON-RPC endpoint
// Requires: Bearer {oauth_access_token} with 'read' scope
// Body: JSON-RPC 2.0 request
{
  jsonrpc: '2.0';
  method: 'tools/list' | 'tools/call' | 'resources/list' | 'resources/read';
  params: { ... };
  id: string | number;
}

// Response: JSON-RPC 2.0 response with result or error
```

---

## 2. MCP TOOLS SYSTEM

### Tool Registration and Definition
**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/tools.ts`

Four tools are registered:

#### Tool 1: `get-items` (Read-only)
```typescript
// Schema
{
  filter?: string;  // Optional filter
}

// Output
{
  content: [{ type: 'text'; text: string }];
  structuredContent: {
    items: Array<{
      id: string;
      title: string;
      description: string;
      actionable: boolean;
      metadata: Record<string, any>;
    }>;
  };
  _meta: {
    'openai/toolInvocation/invoked': string;
  };
}

// Widget: 'ui://widget/list-view.html'
```

#### Tool 2: `perform-item-action`
```typescript
// Schema
{
  itemId: string;   // Required
  action: string;   // Required (e.g., 'approve', 'reject', 'archive')
}

// Output
{
  content: [{ type: 'text'; text: string }];
  structuredContent: {
    success: boolean;
    itemId: string;
    action: string;
    result: any;
  };
  _meta: { timestamp: string };
}
```

#### Tool 3: `echo`
```typescript
// Schema
{
  text: string;  // Required
}

// Output
{
  content: [{ type: 'text'; text: string }];
  structuredContent: {
    text: string;
  };
}

// Widget: 'ui://widget/echo.html'
```

#### Tool 4: `extract_intent` (Main Feature)
**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/tools.ts` - Lines 373-467

```typescript
// Input Schema (Zod)
interface ExtractIntentInput {
  fullInputText: string;              // Required - main instruction
  rawText?: string;                   // Optional - file content
  conversationHistory?: string;       // Optional - conversation context
  userMemory?: string;                // Optional - user memory/context
}

// Processing (handleExtractIntent):
1. Validate OAuth token has 'privy:token:exchange' scope
2. Exchange OAuth token for Privy token:
   POST /token/privy/access-token with Bearer {oauthToken}
3. Truncate input sections:
   - fullInputText: max 2000 chars (config.intentExtraction.instructionCharLimit)
   - rawText, conversationHistory, userMemory: max 5000 chars each
4. Build FormData payload and POST to Protocol API:
   POST {PROTOCOL_API_URL}/discover/new
   Headers: { Authorization: Bearer {privyToken} }
   Body: FormData with 'payload' field
5. Parse JSON response from Protocol API

// Output Schema
{
  content: [{ type: 'text'; text: string }];
  structuredContent: {
    intents: Intent[];              // Protocol API response
    filesProcessed: number;
    linksProcessed: number;
    intentsGenerated: number;
  };
  _meta: {
    'openai/toolInvocation/invoked': string;
  };
}

// Widget: 'ui://widget/intent-display.html'
```

**Key Code Pattern (extract_intent):**
```typescript
async function handleExtractIntent(args: any, auth: any) {
  // 1. Validate auth
  if (!auth || !auth.userId) {
    return { content: [...], isError: true };
  }

  // 2. Validate input
  const parseResult = ExtractIntentSchema.safeParse(args);
  if (!parseResult.success) return error;

  // 3. CRITICAL: Exchange OAuth for Privy token
  const privyToken = await exchangePrivyToken(auth.token);
  
  // 4. Build payload with truncation
  const payload = [
    truncate(fullInputText, 2000),
    rawText ? `=== File Content ===\n${truncate(rawText, 5000)}` : '',
    conversationHistory ? `=== Conversation ===\n${truncate(conversationHistory, 5000)}` : '',
    userMemory ? `=== Context ===\n${truncate(userMemory, 5000)}` : '',
  ].filter(Boolean).join('\n\n');

  // 5. Call Protocol API
  const formData = new FormData();
  formData.append('payload', payload);
  
  const response = await fetch(`${PROTOCOL_API_URL}/discover/new`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${privyToken}` },
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  // 6. Return structured response for widget
  const data = await response.json();
  return {
    content: [...],
    structuredContent: {
      intents: data.intents,
      filesProcessed: data.filesProcessed || 0,
      linksProcessed: data.linksProcessed || 0,
      intentsGenerated: data.intentsGenerated,
    },
  };
}

// Helper: Exchange token
async function exchangePrivyToken(oauthToken: string): Promise<string> {
  const response = await fetch(`${SERVER_BASE_URL}/token/privy/access-token`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${oauthToken}` },
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) throw new Error(`Exchange failed: ${response.status}`);
  
  const data = await response.json();
  return data.privyAccessToken;
}
```

### MCP Server Initialization
**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/server.ts`

```typescript
export async function initializeMCPServer(): Promise<Server> {
  mcpServer = new Server({
    name: 'chatgpt-app-mcp-server',
    version: '1.0.0',
  }, {
    capabilities: { tools: {}, resources: {} }
  });

  // 1. Register widget resources (HTML templates)
  await registerWidgetResources(mcpServer);
  
  // 2. Register tool definitions and handlers
  registerTools(mcpServer);
  
  return mcpServer;
}

// Called during Express startup:
// await initializeMCPServer();
```

---

## 3. AUTHENTICATION & PRIVY INTEGRATION

### Privy Client Setup
**File:** `/Users/jahnik/index-network/mcp2/src/server/oauth/authorize.ts`

```typescript
import { PrivyClient } from '@privy-io/server-auth';

const privyClient = new PrivyClient(
  config.privy.appId,       // from PRIVY_APP_ID env
  config.privy.appSecret    // from PRIVY_APP_SECRET env
);

// Used to verify tokens from frontend:
const privyClaims = await privyClient.verifyAuthToken(privy_token);
// Returns: { userId: string; appId: string; [key: string]: any }
```

### Privy Token Verification
**File:** `/Users/jahnik/index-network/mcp2/src/server/middleware/privy.ts`

```typescript
export async function verifyPrivyToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return 401;

  const token = authHeader.substring(7);
  
  try {
    const claims = await privyClient.verifyAuthToken(token);
    
    // Attach to request
    req.privyUser = {
      userId: claims.userId,   // Privy DID (e.g., "did:privy:...")
      appId: claims.appId,
    };
    
    next();
  } catch (error) {
    return 401;
  }
}
```

### OAuth Token Validation (for MCP requests)
**File:** `/Users/jahnik/index-network/mcp2/src/server/middleware/auth.ts`

```typescript
export function validateToken(requiredScopes: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendAuthChallenge(res, requiredScopes);  // 401 + WWW-Authenticate header
    }

    const token = authHeader.substring(7);
    
    // Verify JWT (signed with server's private key)
    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: ['RS256'],
      issuer: config.server.baseUrl,
      audience: config.server.baseUrl,
    });

    // Extract scopes
    const tokenScopes = decoded.scope ? decoded.scope.split(' ') : [];
    
    // Check required scopes
    if (requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every(scope => tokenScopes.includes(scope));
      if (!hasAllScopes) {
        return sendInsufficientScopeError(res, requiredScopes);  // 403
      }
    }

    // Attach auth info
    req.auth = {
      token,
      decoded,
      userId: decoded.sub as string,  // Privy DID
      scopes: tokenScopes,
    };

    next();
  };
}
```

### Token Storage
**File:** `/Users/jahnik/index-network/mcp2/src/server/oauth/storage.ts`

```typescript
// Stores connection between OAuth access token and Privy token
interface TokenData {
  accessToken: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;     // The original Privy token from auth code
  scopes: string[];
  expiresAt: number;
}

// Lookup function:
export function getToken(accessToken: string): TokenData | undefined {
  return tokens.get(accessToken);
}

// Usage in /token/privy/access-token:
const tokenData = getToken(oauthToken);  // From Authorization header
return { privyAccessToken: tokenData.privyToken, ... };
```

### Configuration
**File:** `/Users/jahnik/index-network/mcp2/src/server/config.ts`

```typescript
export const config = {
  privy: {
    appId: string;           // from PRIVY_APP_ID
    appSecret: string;       // from PRIVY_APP_SECRET
  },

  server: {
    baseUrl: string;         // from SERVER_BASE_URL
    port: number;            // default 3002
    nodeEnv: string;
  },

  jwt: {
    privateKey: string;      // from JWT_PRIVATE_KEY (base64)
    publicKey: string;       // from JWT_PUBLIC_KEY (base64)
    issuer: string;          // = baseUrl
    algorithm: 'RS256';
    expiresIn: '1h';
  },

  oauth: {
    scopesSupported: ['read', 'write', 'profile', 'privy:token:exchange'];
  },

  intentExtraction: {
    protocolApiUrl: string;  // from PROTOCOL_API_URL
    protocolApiTimeoutMs: number;
    privyTokenExchangeTimeoutMs: number;
    sectionCharLimit: number;           // 5000
    instructionCharLimit: number;       // 2000
  },
};
```

---

## 4. WIDGET SYSTEM

### Widget Directory Structure
```
src/widgets/
├── vite.config.ts                    # Widget build config
├── src/
│   ├── Echo/
│   │   ├── Echo.tsx                 # Component
│   │   ├── index.tsx                # Entry point
│   │   └── styles.css
│   ├── IntentDisplay/
│   │   ├── IntentDisplay.tsx
│   │   ├── index.tsx
│   │   └── styles.css
│   ├── ListView/
│   │   ├── ListView.tsx
│   │   ├── index.tsx
│   │   └── styles.css
│   ├── shared/
│   │   └── IntentList.tsx            # Reusable intent list component
│   ├── hooks/
│   │   ├── useOpenAi.ts              # Access window.openai API
│   │   └── useWidgetState.ts         # Persist state across turns
│   └── types/
│       └── openai.d.ts               # Type definitions for window.openai
```

### Build Output
```
dist/widgets/
├── echo.js
├── intent-display.js
├── list-view.js
├── mcp2.css                          # Shared styles
├── useOpenAi-{hash}.js               # Shared hook
└── ... (other chunks)
```

### Widget Serving
**File:** `/Users/jahnik/index-network/mcp2/src/server/index.ts` - Lines 61-67

```typescript
// Serve widget assets with cache headers
app.use('/widgets', express.static(path.join(process.cwd(), 'dist/widgets'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// URL: http://localhost:3002/widgets/echo.js
//      http://localhost:3002/widgets/mcp2.css
```

### Widget Resource Registration
**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/resources.ts`

**MCP Resources (listed via `resources/list`):**
```typescript
[
  {
    uri: 'ui://widget/list-view.html',
    name: 'ListView Widget',
    description: 'Interactive list view with actions',
    mimeType: 'text/html+skybridge',
  },
  {
    uri: 'ui://widget/echo.html',
    name: 'Echo Widget',
    description: 'Simple echo widget that displays text',
    mimeType: 'text/html+skybridge',
  },
  {
    uri: 'ui://widget/intent-display.html',
    name: 'IntentDisplay Widget',
    description: 'Displays extracted intents with archive/delete actions',
    mimeType: 'text/html+skybridge',
  },
]
```

**Resource Content (via `resources/read`):**
```typescript
// GET ui://widget/intent-display.html returns:
{
  uri: 'ui://widget/intent-display.html',
  mimeType: 'text/html+skybridge',
  text: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" crossorigin href="http://localhost:3002/widgets/mcp2.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" crossorigin src="http://localhost:3002/widgets/intent-display.js"></script>
  </body>
</html>
  `,
  _meta: {
    'openai/outputTemplate': 'ui://widget/intent-display.html',
    'openai/toolInvocation/invoking': 'Analyzing intents...',
    'openai/toolInvocation/invoked': 'Intents analyzed',
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true,
  },
}
```

### window.openai API
**File:** `/Users/jahnik/index-network/mcp2/src/widgets/src/types/openai.d.ts`

```typescript
interface WindowOpenAI {
  // Input data from tool output
  toolOutput: {
    structuredContent?: any;        // Main data for widget
    content?: Array<{ type: string; text: string }>;
    _meta?: Record<string, any>;
    [key: string]: any;
  };

  toolInput: Record<string, any>;    // Original tool arguments

  // State management
  widgetState: any;                  // Persisted state (survives conversation turns)
  setWidgetState: (state: any) => void;

  // Display settings
  theme: 'light' | 'dark';
  displayMode: 'inline' | 'pip' | 'fullscreen';
  locale: string;

  // Methods to interact with ChatGPT
  callTool: (name: string, args: Record<string, any>) => Promise<any>;
  sendFollowUpMessage: (params: { prompt: string }) => void;
  openExternal: (params: { href: string }) => void;
  requestDisplayMode: (params: { mode: 'inline' | 'pip' | 'fullscreen' }) => void;
}

declare global {
  interface Window {
    openai: WindowOpenAI;
  }
}
```

### useOpenAi Hook
**File:** `/Users/jahnik/index-network/mcp2/src/widgets/src/hooks/useOpenAi.ts`

```typescript
export function useOpenAi() {
  // Subscribe to 'openai:set_globals' event for reactive updates
  const globals = useSyncExternalStore(
    (onChange) => {
      window.addEventListener('openai:set_globals', onChange);
      return () => window.removeEventListener('openai:set_globals', onChange);
    },
    () => window.openai?.toolOutput,
    () => ({})
  );

  return {
    ...globals,  // toolOutput, toolInput, theme, displayMode, etc.
    
    // Convenience methods
    callTool: (name: string, args: Record<string, any>) =>
      window.openai.callTool(name, args),
    
    sendMessage: (prompt: string) =>
      window.openai.sendFollowUpMessage({ prompt }),
    
    openLink: (href: string) =>
      window.openai.openExternal({ href }),
    
    requestFullscreen: () =>
      window.openai.requestDisplayMode({ mode: 'fullscreen' }),
  };
}
```

### useWidgetState Hook
**File:** `/Users/jahnik/index-network/mcp2/src/widgets/src/hooks/useWidgetState.ts`

```typescript
export function useWidgetState<T>(initialState: () => T) {
  const [state, setState] = useState<T>(
    () => window.openai.widgetState ?? initialState()
  );

  const setWidgetState = useCallback((updater: T | ((prev: T) => T)) => {
    setState((prev) => {
      const newState = typeof updater === 'function' 
        ? (updater as (prev: T) => T)(prev) 
        : updater;
      
      window.openai.setWidgetState(newState);
      return newState;
    });
  }, []);

  return [state, setWidgetState] as const;
}

// Usage in ListView:
const [widgetState, setWidgetState] = useWidgetState<WidgetState>(() => ({
  selectedId: null,
  loading: false,
  loadingItemId: null,
}));
```

---

## 5. INTENT DISPLAY WIDGET (PRIMARY EXAMPLE)

### Component: IntentDisplay
**File:** `/Users/jahnik/index-network/mcp2/src/widgets/src/IntentDisplay/IntentDisplay.tsx`

```typescript
interface Intent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
}

interface IntentData {
  intents: Intent[];
  filesProcessed?: number;
  linksProcessed?: number;
  intentsGenerated: number;
}

export function IntentDisplay() {
  const toolOutput = useOpenAi();
  const [removedIntentIds, setRemovedIntentIds] = useState<Set<string>>(new Set());
  const [removingIntentIds, setRemovingIntentIds] = useState<Set<string>>(new Set());

  // Extract data from multiple possible sources (ChatGPT flattens structuredContent)
  const data = (
    toolOutput?.structuredContent ||
    toolOutput?.result?.structuredContent ||
    toolOutput
  ) as IntentData | null;

  const visibleIntents = data?.intents?.filter(
    intent => !removedIntentIds.has(intent.id)
  ) || [];

  const handleRemoveIntent = async (intent: Intent) => {
    try {
      setRemovingIntentIds(prev => new Set(prev).add(intent.id));
      
      const response = await fetch(`/api/intents/${intent.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Failed to remove intent');
      setRemovedIntentIds(prev => new Set(prev).add(intent.id));
    } catch (error) {
      console.error('Error removing intent:', error);
      alert('Failed to remove intent. Please try again.');
    } finally {
      setRemovingIntentIds(prev => {
        const next = new Set(prev);
        next.delete(intent.id);
        return next;
      });
    }
  };

  // Render
  if (!data || visibleIntents.length === 0) {
    return (
      <div className="intent-widget">
        <div className="intent-empty">
          {removedIntentIds.size > 0 ? 'All intents removed.' : 'No intents detected.'}
        </div>
      </div>
    );
  }

  const { filesProcessed = 0, linksProcessed = 0, intentsGenerated } = data;

  return (
    <div className="intent-widget">
      {(filesProcessed > 0 || linksProcessed > 0) && (
        <div className="intent-summary">
          Generated {intentsGenerated} intent(s) from {filesProcessed} file(s) and {linksProcessed} link(s)
        </div>
      )}
      
      <IntentList
        intents={visibleIntents}
        isLoading={false}
        emptyMessage="No intents detected."
        onRemoveIntent={handleRemoveIntent}
        removingIntentIds={removingIntentIds}
      />
    </div>
  );
}
```

### IntentList Component
**File:** `/Users/jahnik/index-network/mcp2/src/widgets/src/shared/IntentList.tsx`

```typescript
interface BaseIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: 'file' | 'link' | 'integration';
  sourceId?: string;
  sourceName?: string;
  sourceValue?: string | null;
  sourceMeta?: string | null;
}

export default function IntentList<T extends BaseIntent>({
  intents,
  isLoading = false,
  emptyMessage = 'No intents yet',
  onArchiveIntent,
  onRemoveIntent,
  onOpenIntentSource,
  newIntentIds = new Set(),
  selectedIntentIds = new Set(),
  removingIntentIds = new Set(),
  className = '',
}) {
  if (isLoading) {
    return <div className="spinner">Loading...</div>;
  }

  if (intents.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="intent-list">
      {intents.map((intent) => {
        const summary = (intent.summary?.trim().length ? intent.summary : intent.payload).trim();
        const isFresh = newIntentIds.has(intent.id);
        const isSelected = selectedIntentIds.has(intent.id);
        const canOpenSource = intent.sourceType === 'link' && intent.sourceValue?.startsWith('http');

        return (
          <div key={intent.id} className={`intent-item ${isFresh ? 'fresh' : ''} ${isSelected ? 'selected' : ''}`}>
            <div className="intent-summary">{summary}</div>
            {onRemoveIntent && (
              <button onClick={() => onRemoveIntent(intent)} disabled={removingIntentIds.has(intent.id)}>
                Remove
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## 6. OAUTH TOKEN FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                        CHATGPT                              │
└─────────────────────────────────────────────────────────────┘
                           │
                    (Initiates OAuth)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP2 SERVER (/authorize)                       │
│                                                              │
│  1. Get Privy token from frontend                           │
│  2. Verify with PrivyClient.verifyAuthToken()              │
│  3. Store authorization code with Privy token              │
│  4. Return code for exchange                               │
└─────────────────────────────────────────────────────────────┘
                           │
                    (Auth code)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP2 SERVER (/token)                           │
│                                                              │
│  1. Receive auth code + PKCE verifier                       │
│  2. Validate PKCE challenge                                │
│  3. Sign JWT access token (RS256)                          │
│  4. Store: accessToken -> { privyToken, userId, scopes }   │
│  5. Return access_token, refresh_token, expires_in         │
└─────────────────────────────────────────────────────────────┘
                           │
              (OAuth access token)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           CHATGPT CALLS extract_intent TOOL                │
│                                                              │
│  Tool Input:                                               │
│  {                                                          │
│    fullInputText: "...",                                   │
│    rawText?: "...",                                        │
│    conversationHistory?: "..."                             │
│  }                                                          │
│                                                              │
│  Auth: Bearer {oauth_access_token}                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         MCP2 SERVER (extract_intent handler)               │
│                                                              │
│  1. Validate OAuth token has 'privy:token:exchange' scope   │
│  2. POST /token/privy/access-token                         │
│     Headers: Authorization: Bearer {oauth_access_token}    │
│     Returns: { privyAccessToken: "..." }                   │
│  3. Build FormData payload                                 │
│  4. POST {PROTOCOL_API_URL}/discover/new                   │
│     Headers: Authorization: Bearer {privyToken}            │
│     Body: FormData { payload: "..." }                      │
│  5. Return intents in structuredContent                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            PROTOCOL API (/discover/new)                    │
│                                                              │
│  1. Verify Privy bearer token                              │
│  2. Extract intents from payload                           │
│  3. Return: { intents, filesProcessed, intentsGenerated }  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│         CHATGPT - Render IntentDisplay Widget              │
│                                                              │
│  window.openai.toolOutput = {                              │
│    structuredContent: {                                    │
│      intents: [...],                                       │
│      filesProcessed: n,                                    │
│      intentsGenerated: m                                   │
│    }                                                        │
│  }                                                          │
│                                                              │
│  Dispatch: openai:set_globals event                        │
│  Widget receives update via useOpenAi hook                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. KEY PATTERNS FOR `discover_connections` FEATURE

### Pattern 1: Tool Input Validation (Zod)
```typescript
// Define schema
const DiscoverConnectionsSchema = z.object({
  userId?: z.string().optional(),
  filters?: z.object({
    connectionType?: z.string(),
    status?: z.string(),
  }).optional(),
});

// In tool handler
const parseResult = DiscoverConnectionsSchema.safeParse(args);
if (!parseResult.success) {
  return {
    content: [{ type: 'text', text: `Invalid input: ${...}` }],
    isError: true,
  };
}
```

### Pattern 2: Token Exchange
```typescript
// Get Privy token from OAuth access token
const privyToken = await exchangePrivyToken(auth.token);
// Function: POST /token/privy/access-token with Bearer {auth.token}
```

### Pattern 3: Protocol API Call
```typescript
// Call Protocol API with Privy token
const response = await fetch(`${PROTOCOL_API_URL}/discover/connections`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${privyToken}` },
  body: JSON.stringify({ ...payload }),
  signal: AbortSignal.timeout(60000),
});

const data = await response.json();
```

### Pattern 4: Widget-Ready Output
```typescript
return {
  content: [
    { type: 'text', text: `Found ${data.connectionsFound} connection(s)` }
  ],
  structuredContent: {
    connections: data.connections,  // Array of connection objects
    totalCount: data.totalCount,
    filters: data.appliedFilters,
  },
  _meta: {
    'openai/toolInvocation/invoked': `Found ${data.connectionsFound} connections`,
  },
};
```

### Pattern 5: Widget Component
```typescript
export function DiscoverConnectionsWidget() {
  const toolOutput = useOpenAi();
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(new Set());

  const data = (
    toolOutput?.structuredContent ||
    toolOutput?.result?.structuredContent ||
    toolOutput
  ) as ConnectionData | null;

  const connections = data?.connections || [];

  const handleSelectConnection = (connectionId: string) => {
    setSelectedConnectionIds(prev =>
      new Set(prev).has(connectionId)
        ? new Set([...prev].filter(id => id !== connectionId))
        : new Set(prev).add(connectionId)
    );
  };

  return (
    <div className="connections-widget">
      {connections.length === 0 ? (
        <div className="empty">No connections found</div>
      ) : (
        <div className="connections-list">
          {connections.map((conn) => (
            <div key={conn.id} className="connection-card">
              <h3>{conn.name}</h3>
              <p>{conn.description}</p>
              <button onClick={() => handleSelectConnection(conn.id)}>
                {selectedConnectionIds.has(conn.id) ? 'Deselect' : 'Select'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 8. CONFIGURATION & ENVIRONMENT

**File:** `.env` or environment variables required:

```bash
# Privy
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# Server
SERVER_BASE_URL=http://localhost:3002
PORT=3002
NODE_ENV=development

# JWT (base64-encoded RSA keys)
JWT_PRIVATE_KEY=<base64-encoded-private-key>
JWT_PUBLIC_KEY=<base64-encoded-public-key>

# Protocol API
PROTOCOL_API_URL=https://protocol.example.com

# Timeouts
PROTOCOL_API_TIMEOUT_MS=60000
PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS=10000

# Intent extraction limits
EXTRACT_INTENT_SECTION_CHAR_LIMIT=5000
EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT=2000
```

---

## 9. BUILD & DEPLOYMENT

### Scripts
```json
{
  "dev": "bun --watch src/server/index.ts",
  "dev:widgets": "vite build --config src/widgets/vite.config.ts --watch",
  "dev:all": "concurrently \"bun run dev:widgets\" \"sleep 2 && bun run dev\"",
  "build": "bun run build:client && bun run build:widgets && bun run build:server",
  "build:widgets": "vite build --config src/widgets/vite.config.ts",
  "start": "NODE_ENV=production bun dist/server/index.js"
}
```

### Output Structure
```
dist/
├── server/
│   ├── index.js
│   ├── mcp/
│   ├── oauth/
│   ├── middleware/
│   └── ...
├── client/
│   ├── index.html
│   └── assets/
└── widgets/
    ├── echo.js
    ├── intent-display.js
    ├── list-view.js
    ├── mcp2.css
    └── ...
```

---

## 10. SUMMARY TABLE

| Component | File Path | Key Types/Functions |
|-----------|-----------|-------------------|
| **Express Server** | `src/server/index.ts` | Express app setup, routes |
| **OAuth Authorize** | `src/server/oauth/authorize.ts` | `POST /authorize`, `/authorize/complete` |
| **OAuth Token** | `src/server/oauth/token.ts` | `POST /token`, `POST /token/privy/access-token` |
| **MCP Handlers** | `src/server/mcp/handlers.ts` | `POST /mcp` JSON-RPC endpoint |
| **MCP Tools** | `src/server/mcp/tools.ts` | `registerTools()`, tool handlers |
| **MCP Server** | `src/server/mcp/server.ts` | `initializeMCPServer()` |
| **MCP Resources** | `src/server/mcp/resources.ts` | `registerWidgetResources()` |
| **Auth Middleware** | `src/server/middleware/auth.ts` | `validateToken()`, JWT validation |
| **Privy Middleware** | `src/server/middleware/privy.ts` | `verifyPrivyToken()`, Privy SDK |
| **Storage** | `src/server/oauth/storage.ts` | In-memory auth codes, tokens, clients |
| **Config** | `src/server/config.ts` | Environment variable loading |
| **useOpenAi Hook** | `src/widgets/src/hooks/useOpenAi.ts` | React hook for `window.openai` API |
| **useWidgetState Hook** | `src/widgets/src/hooks/useWidgetState.ts` | Persisted widget state |
| **IntentDisplay Widget** | `src/widgets/src/IntentDisplay/IntentDisplay.tsx` | Intent display component |
| **IntentList Shared** | `src/widgets/src/shared/IntentList.tsx` | Reusable intent list |
| **Echo Widget** | `src/widgets/src/Echo/Echo.tsx` | Simple echo component |
| **ListView Widget** | `src/widgets/src/ListView/ListView.tsx` | Interactive list widget |

---

## Implementation Roadmap for `discover_connections`

1. **Define Protocol API endpoint**: `POST /discover/connections`
2. **Create tool**: `extract_intent` pattern as template
3. **Register tool**: Add to `tools.ts` with Zod schema
4. **Create handler**: `handleDiscoverConnections()` function
5. **Create widget**: `src/widgets/src/DiscoverConnections/DiscoverConnections.tsx`
6. **Register resource**: Add to `resources.ts`
7. **Test flow**: Verify auth → token exchange → API call → widget render

