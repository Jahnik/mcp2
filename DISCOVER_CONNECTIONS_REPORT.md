# discover_connections Implementation Report

## Executive Summary

This report documents the architecture and integration requirements for implementing the `discover_connections` tool and widget in mcp2. All sections are based on direct code analysis of the three repositories.

**Key Finding**: The `discover_connections` feature requires orchestrating THREE Protocol API endpoints:
1. `POST /discover/new` - Extract intents from text
2. `POST /discover/filter` - Find matching users based on intents
3. `POST /synthesis/vibecheck` - Generate human-readable summaries

**Important**: The prior implementation in `../mcp` is called `discover_filter` (not `discover_connections`). It already implements the full orchestration flow with VibeCheck concurrency, retry logic, and card generation.

---

## 1. Current mcp2 Architecture Relevant to discover_connections

### 1.1 Server Entry Point and Routes [VERIFIED]

**File**: [src/server/index.ts](src/server/index.ts)

The Express server registers these key routes:
- `/authorize` - OAuth authorization initiation
- `/authorize/complete` - OAuth callback
- `/token` - Token exchange (includes `/token/privy/access-token`)
- `/mcp` - MCP protocol endpoint (SSE transport)
- `/.well-known/jwks.json` - JWKS for token verification

### 1.2 MCP Tool Registration [VERIFIED]

**File**: [src/server/mcp/tools.ts](src/server/mcp/tools.ts)

Tools are registered using the low-level `Server` class with manual `setRequestHandler()`:

```typescript
// Tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'extract_intent',
        description: '...',
        inputSchema: { type: 'object', properties: {...}, required: [...] },
        _meta: {
          'openai/outputTemplate': 'ui://widget/intent-display.html',
          'openai/toolInvocation/invoking': 'Analyzing intents...',
          'openai/toolInvocation/invoked': 'Intents analyzed',
        },
      },
      // ... other tools
    ],
  };
});

// Tool dispatch
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const auth = (extra as any)?.auth;

  switch (name) {
    case 'extract_intent':
      return await handleExtractIntent(args, auth);
    // ... other cases
  }
});
```

### 1.3 Auth + Token Exchange [VERIFIED]

**File**: [src/server/oauth/token.ts](src/server/oauth/token.ts)

The `/token/privy/access-token` endpoint exchanges OAuth tokens for Privy tokens:

```typescript
tokenRouter.post('/privy/access-token', validateToken(['privy:token:exchange']), async (req, res) => {
  const oauthToken = req.auth?.token;
  const tokenData = getToken(oauthToken);

  return res.json({
    privyAccessToken: tokenData.privyToken,
    expiresAt: tokenData.expiresAt,
    userId: tokenData.privyUserId,
    scope: tokenData.scopes,
  });
});
```

**Auth context passed to tools**:
```typescript
interface Auth {
  token: string;       // OAuth JWT access token
  userId: string;      // Privy DID from JWT 'sub' claim
  scopes: string[];    // From JWT 'scope' claim
}
```

### 1.4 extract_intent Tool Implementation [VERIFIED]

**File**: [src/server/mcp/tools.ts:114-147](src/server/mcp/tools.ts#L114-L147) (registration)
**File**: [src/server/mcp/tools.ts:373-467](src/server/mcp/tools.ts#L373-L467) (handler)

**Input Schema (Zod)**:
```typescript
const ExtractIntentSchema = z.object({
  fullInputText: z.string().min(1, 'Input text is required'),
  rawText: z.string().optional(),
  conversationHistory: z.string().optional(),
  userMemory: z.string().optional(),
});
```

**Output Type**:
```typescript
{
  content: [{ type: 'text', text: string }],
  structuredContent: {
    intents: Array<{
      id: string;
      payload: string;
      summary?: string | null;
      createdAt: string;
    }>;
    filesProcessed: number;
    linksProcessed: number;
    intentsGenerated: number;
  },
  _meta?: Record<string, any>;
  isError?: boolean;
}
```

**Handler Flow**:
1. Validate auth (`auth?.userId`)
2. Validate input with Zod
3. Exchange OAuth token for Privy token via `exchangePrivyToken()`
4. Build payload with truncation limits
5. Call Protocol API `POST /discover/new` with FormData
6. Return structured response

**Key Helper - Token Exchange**:
```typescript
async function exchangePrivyToken(oauthToken: string): Promise<string> {
  const response = await fetch(`${config.server.baseUrl}/token/privy/access-token`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${oauthToken}` },
    signal: AbortSignal.timeout(config.intentExtraction.privyTokenExchangeTimeoutMs),
  });

  const data = await response.json() as { privyAccessToken: string };
  return data.privyAccessToken;
}
```

### 1.5 Configuration [VERIFIED]

**File**: [src/server/config.ts](src/server/config.ts)

```typescript
export const config = {
  server: {
    baseUrl: process.env.SERVER_BASE_URL,
    port: parseInt(process.env.PORT || '3002'),
  },
  intentExtraction: {
    protocolApiUrl: process.env.PROTOCOL_API_URL,
    protocolApiTimeoutMs: Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000'),
    privyTokenExchangeTimeoutMs: Number(process.env.PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS ?? '10000'),
    sectionCharLimit: Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000'),
    instructionCharLimit: Number(process.env.EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT ?? '2000'),
  },
  // ... privy, jwt, oauth configs
};
```

### 1.6 Widget System [VERIFIED]

**Directory**: `src/widgets/`

**Build**: Vite library mode outputting ES modules
**Entry**: `src/widgets/vite.config.ts`

```typescript
build: {
  lib: {
    entry: {
      'echo': 'src/Echo/index.tsx',
      'list-view': 'src/ListView/index.tsx',
      'intent-display': 'src/IntentDisplay/index.tsx',
    },
    formats: ['es'],
  },
}
```

**Widget Data Access Pattern**:
```typescript
// src/widgets/src/hooks/useOpenAi.ts
export function useOpenAi() {
  const openai = (window as any).openai;

  // ChatGPT flattens structuredContent to different levels
  const toolOutput = (
    openai?.toolOutput?.structuredContent ||
    openai?.toolOutput?.result?.structuredContent ||
    openai?.toolOutput
  );

  return { toolOutput, toolInput: openai?.toolInput, theme: openai?.theme };
}
```

**IntentDisplay Widget Types** (`src/widgets/src/IntentDisplay/IntentDisplay.tsx`):
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
```

**Loading/Error/Empty Pattern**:
```typescript
const [removedIntentIds, setRemovedIntentIds] = useState<Set<string>>(new Set());
const [removingIntentIds, setRemovingIntentIds] = useState<Set<string>>(new Set());

const visibleIntents = data?.intents?.filter(
  intent => !removedIntentIds.has(intent.id)
) || [];

if (!data || visibleIntents.length === 0) {
  return (
    <div className="intent-empty">
      {removedIntentIds.size > 0 ? 'All intents removed.' : 'No intents detected.'}
    </div>
  );
}
```

**Resource Registration** (`src/server/mcp/resources.ts`):
```typescript
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  // Match widget URIs like 'ui://widget/intent-display.html'
  if (uri === 'ui://widget/intent-display.html') {
    return {
      contents: [{
        uri,
        mimeType: 'text/html+skybridge',
        text: createWidgetHTML('Intent Display', 'intent-display'),
        _meta: {
          'openai/widgetAccessible': true,
          'openai/resultCanProduceWidget': true,
        }
      }]
    };
  }
});
```

---

## 2. Prior Implementation in ../mcp

### 2.1 discover_filter Tool (The Reference Implementation)

**File**: `/Users/jahnik/index-network/mcp/src/server.ts` (lines 877-1049)
**Spec**: `/Users/jahnik/index-network/mcp/filter-spec.md`

The old implementation is called `discover_filter` and already implements the full flow we need for `discover_connections`.

**Tool Name**: `discover_filter`

**Input Schema** (lines 837-859):
```typescript
const discoverFilterInputShape = {
  intentIds: z.array(z.string().uuid()).max(20).optional(),
  userIds: z.array(z.string().uuid()).max(20).optional(),
  indexIds: z.array(z.string().uuid()).max(20).optional(),
  sources: z.array(z.object({
    type: z.enum(['file', 'integration', 'link', 'discovery_form']),
    id: z.string().uuid(),
  })).max(20).optional(),
  excludeDiscovered: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  intentInput: z.object({                    // Optional chaining - create intents first
    fullInputText: z.string(),
    rawText: z.string().optional(),
    conversationHistory: z.string().optional(),
    userMemory: z.string().optional(),
  }).optional(),
  vibecheck: z.object({
    characterLimit: z.number().int().positive().optional(),
    concurrency: z.number().int().min(1).max(5).optional(),  // Default 2
  }).optional(),
  mock: z.boolean().optional(),
};
```

**Output Schema** (from filter-spec.md):
```typescript
{
  results: Array<{
    user: { id: string; name: string; email: string | null; avatar: string | null; intro: string | null; };
    totalStake: number;
    intents: Array<{
      intent: { id: string; payload: string; summary?: string | null; createdAt: string; };
      totalStake: number;
      reasonings: string[];
    }>;
  }>;
  pagination: { page: number; limit: number; hasNext: boolean; hasPrev: boolean; };
  filters: { intentIds: string[] | null; userIds: string[] | null; indexIds: string[] | null; sources: any[] | null; excludeDiscovered?: boolean; };
  vibechecks: Array<{ targetUserId: string; synthesis: string; }>;
  generatedIntents: Array<{ id: string; payload: string; summary?: string; createdAt: string; }> | null;
  cards: DiscoverCard[];
  cardsMarkup: string[];
  summary: string;
  pageHint: { hasNext: boolean; hasPrev: boolean; nextPage: number | null; prevPage: number | null; };
}
```

### 2.2 Handler Flow (lines 889-1049)

The `discover_filter` handler implements the exact orchestration we need:

```typescript
// 1. Validate & authenticate
const authToken = extra?.authInfo?.token;
const privyToken = await exchangePrivyToken(authToken);

// 2. Resolve intent IDs (optionally create from text first)
let resolvedIntentIds = input.intentIds ?? [];
let generatedIntents;

if (resolvedIntentIds.length === 0 && input.intentInput?.fullInputText) {
  // Chain: create intents first via /discover/new
  const intentCreation = await submitDiscoveryRequest(privyToken.token, combinedText);
  generatedIntents = intentCreation.intents;
  resolvedIntentIds = intentCreation.intents.map(i => i.id);
}

// 3. Call /discover/filter
const discoverResponse = await runDiscoverFilterRequest(privyToken.token, {
  intentIds: resolvedIntentIds,
  userIds, indexIds, sources,
  excludeDiscovered: true,
  page: 1, limit: 50
});

// 4. Run VibeCheck for ALL results (with concurrency + retries)
const vibechecks = await runVibeChecksForResults({
  privyToken: privyToken.token,
  results: discoverResponse.results,
  intentIds: resolvedIntentIds,
  indexIds,
  concurrency: input.vibecheck?.concurrency ?? 2,  // Default 2, max 5
  characterLimit: input.vibecheck?.characterLimit,
});

// 5. Create cards for widget display
const cards = createCardsFromResults({ results: discoverResponse.results, vibechecks });
const summary = buildDiscoverSummary({ generatedIntentCount, matchCount, pagination, vibecheckFailures });

// 6. Return combined response
return {
  content: [{ type: 'text', text: `${summary}\n\n${cardsMarkup.join('\n\n')}` }],
  structuredContent: {
    ...discoverResponse, generatedIntents, vibechecks, cards, cardsMarkup, summary, pageHint
  },
  _meta: { 'openai/toolInvocation/invoking': ..., 'openai/toolInvocation/invoked': ... }
};
```

### 2.3 VibeCheck Implementation Details

**Concurrency & Throttling** (lines 408-452):
```typescript
const VIBECHECK_DEFAULT_CONCURRENCY = 2;
const VIBECHECK_MAX_CONCURRENCY = 5;
const VIBECHECK_THROTTLE_MS = 75;  // Delay between calls
const VIBECHECK_RETRY_DELAYS_MS = [250, 500];  // Up to 2 retries with backoff

async function runVibeChecksForResults(options) {
  const limit = Math.min(Math.max(concurrency, 1), VIBECHECK_MAX_CONCURRENCY);
  // Worker pool pattern with throttling
  const worker = async () => {
    while (nextIndex < results.length) {
      vibechecks[current] = await runVibeCheckWithRetries({ ... });
      await delay(VIBECHECK_THROTTLE_MS);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}
```

**Retry Logic** (lines 454-489):
```typescript
async function runVibeCheckWithRetries(options) {
  let attempt = 0;
  while (attempt <= VIBECHECK_RETRY_DELAYS_MS.length) {
    try {
      return await runVibeCheckRequest(options);
    } catch (error) {
      attempt++;
      if (attempt > VIBECHECK_RETRY_DELAYS_MS.length) {
        // Return empty synthesis on final failure (don't fail whole request)
        return { targetUserId, synthesis: '' };
      }
      await delay(VIBECHECK_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
}
```

### 2.4 Card Structure (lines 499-546)

```typescript
interface DiscoverCard {
  header: {
    title: string;           // User name
    subtitle?: string;       // User intro
    badge?: string;          // "3 intents"
  };
  body: {
    context: string;         // List of matched intents
    stats: Array<{ label: string; value: number }>;  // Shared intents, Total stake
    vibecheck: string;       // Synthesis from vibecheck
  };
  actions: Array<{
    label: string;           // "Connect", "Save"
    hint: string;
    action: string;
    payload: { userId: string };
  }>;
  markup: string;            // Markdown representation
}
```

### 2.5 Widget Configuration (lines 700-709)

```typescript
const indexDiscoverWidget = {
  id: "index-discover",
  title: "Index Discover",
  templateUri: "ui://widget/index-discover.html",
  resourceName: "index-discover",
  invoking: "Rendering discovery cards",
  invoked: "Rendered discovery cards",
  mimeType: "text/html+skybridge",
  html: discoverWidgetHtml
};
```

### 2.6 Key Differences from mcp2

| Aspect | mcp (old) | mcp2 (current) |
|--------|-----------|----------------|
| SDK Class | `McpServer` | `Server` |
| Tool Registration | `registerTool()` | Manual `setRequestHandler()` |
| Auth Access | `extra?.authInfo?.token` | `extra?.auth?.token` |
| Token Exchange Path | `/privy/access-token` | `/token/privy/access-token` |
| Widget Build | Multi-page HTML | Library mode ES modules |
| Input Validation | Inline Zod | Separate schema |

### 2.7 Behavioral Patterns to Preserve

1. **Intent chaining**: If no `intentIds`, create them from `intentInput.fullInputText` first
2. **VibeCheck for ALL results**: Not optional - run for every discovered user
3. **Concurrent VibeCheck**: Default 2, max 5 parallel calls with throttling
4. **Retry with backoff**: 2 retries (250ms, 500ms) before giving up on a vibecheck
5. **Partial failure tolerance**: VibeCheck failures don't fail the whole request
6. **Card generation**: Transform results + vibechecks into displayable cards
7. **Pagination hints**: Include `pageHint` for widget navigation

---

## 3. Protocol API and Connections UI in ../index

### 3.1 Endpoint: POST /discover/new

**File**: `/Users/jahnik/index-network/index/protocol/src/routes/discover.ts` (lines 50-261)

**Request**:
```
POST /discover/new
Authorization: Bearer {privy_token}
Content-Type: multipart/form-data

Fields:
- payload: string     // Text content, URLs, instructions
- files?: File[]      // Optional file uploads (up to 10)
```

**Response**:
```typescript
{
  success: boolean;
  intents: Array<{
    id: string;           // UUID
    payload: string;      // Intent text
    summary?: string;     // Optional summary
    createdAt: string;    // ISO timestamp
  }>;
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}
```

**Auth**: Privy JWT via `Authorization: Bearer <token>`

**Errors**:
- `400` - Missing required fields or validation errors
- `401` - Invalid/missing authentication token
- `500` - Server error during processing

### 3.2 Endpoint: POST /discover/filter

**File**: `/Users/jahnik/index-network/index/protocol/src/routes/discover.ts` (lines 321-384)

This is the **core endpoint** for finding connections based on user intents.

**Request**:
```typescript
POST /discover/filter
Authorization: Bearer {privy_token}
Content-Type: application/json

{
  intentIds?: string[];        // Specific intent IDs to filter by
  userIds?: string[];          // Filter to specific users
  indexIds?: string[];         // Filter by index membership
  sources?: Array<{            // Filter by intent source
    type: 'file' | 'integration' | 'link';
    id: string;
  }>;
  excludeDiscovered?: boolean; // Exclude users with existing connections (default: true)
  page?: number;               // Pagination (default: 1)
  limit?: number;              // Results per page (default: 50, max: 100)
}
```

**Response**:
```typescript
{
  results: Array<{
    user: {
      id: string;
      name: string;
      email: string | null;
      avatar: string | null;
      intro: string | null;
    };
    totalStake: number;
    intents: Array<{
      intent: {
        id: string;
        payload: string;
        summary?: string | null;
        createdAt: Date;
      };
      totalStake: number;
      reasonings: string[];
    }>;
  }>;
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    intentIds: string[] | null;
    userIds: string[] | null;
    indexIds: string[] | null;
    sources: any[] | null;
    excludeDiscovered: boolean;
  };
}
```

**Implementation**: Uses `discoverUsers()` from `/Users/jahnik/index-network/index/protocol/src/lib/discover.ts`

### 3.3 Endpoint: POST /synthesis/vibecheck

**File**: `/Users/jahnik/index-network/index/protocol/src/routes/synthesis.ts` (lines 14-73)

Generates human-readable collaboration summaries for connections.

**Request**:
```typescript
POST /synthesis/vibecheck
Authorization: Bearer {privy_token}
Content-Type: application/json

{
  targetUserId: string;          // User to generate synthesis for (required)
  intentIds?: string[];          // Specific intents to focus on
  indexIds?: string[];           // Index filtering for access control
  options?: {
    timeout?: number;            // Default: 30000ms
    characterLimit?: number;     // Optional max chars for output
  };
}
```

**Response**:
```typescript
{
  synthesis: string;      // Markdown text with intent links
  targetUserId: string;
  contextUserId: string;  // Authenticated user
}
```

**Synthesis Output Format** (from vibe_checker agent):
- Warm, friendly tone describing collaboration opportunities
- Contains 2-3 inline hyperlinks to intents: `[phrase](https://index.network/intents/ID)`
- Single paragraph, can use line breaks
- No bold, italic, or title

**Implementation**: Uses `synthesizeVibeCheck()` from `/Users/jahnik/index-network/index/protocol/src/lib/synthesis.ts` which calls the vibe_checker agent at `/Users/jahnik/index-network/index/protocol/src/agents/external/vibe_checker/index.ts`

### 3.4 Frontend Types for Connections

**File**: `/Users/jahnik/index-network/index/frontend/src/lib/types.ts`

```typescript
// Discovery results (from /discover/filter)
export interface StakesByUserResponse {
  user: {
    id: string;
    name: string;
    avatar: string;
  };
  intents: Array<{
    intent: {
      id: string;
      summary?: string;
      payload: string;
      updatedAt: string;
    };
    totalStake: string;
    agents: Array<{
      agent: {
        name: string;
        avatar: string;
      };
      stake: string;
    }>;
  }>;
}

// Connection state
export interface UserConnection {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  status: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';
  isInitiator: boolean;
  lastUpdated: string;
}
```

### 3.5 Website Frontend Connections UI

**File**: `/Users/jahnik/index-network/index/frontend/src/app/inbox/page.tsx`

The inbox page renders "connection cards" for discovered users. Here's the key UI pattern:

**User Card Structure** (lines 316-393):
```tsx
<div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
  <div className="py-4 px-2 sm:px-4">
    {/* User Header */}
    <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
      <div className="flex items-center gap-4">
        <Image
          src={getAvatarUrl(user)}
          alt={user.name}
          width={48}
          height={48}
          className="rounded-full"
        />
        <div>
          <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{user.name}</h2>
          <span className="text-sm text-gray-500 font-ibm-plex-mono">
            {intents.length} mutual intent{intents.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      {/* Connection Actions */}
      <ConnectionActions
        userId={user.id}
        userName={user.name}
        connectionStatus={status}
        onAction={handleConnectionAction}
        size="sm"
      />
    </div>

    {/* Synthesis Section */}
    {(synthesisLoading[user.id] || syntheses[user.id]) && (
      <div className="mb-4">
        <h3 className="font-medium text-gray-700 mb-2 text-sm">What could happen here</h3>
        {synthesisLoading[user.id] ? (
          {/* Loading skeleton */}
        ) : (
          <SynthesisMarkdown
            content={syntheses[user.id]}
            className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none"
          />
        )}
      </div>
    )}
  </div>
</div>
```

**Key Tailwind Classes**:
- Card: `bg-white border border-b-2 border-gray-800 mb-4`
- Header text: `font-bold text-lg text-gray-900 font-ibm-plex-mono`
- Subtext: `text-sm text-gray-500 font-ibm-plex-mono`
- Section title: `font-medium text-gray-700 mb-2 text-sm`
- Content: `text-gray-700 text-sm leading-relaxed`

**ConnectionActions Component** (`/Users/jahnik/index-network/index/frontend/src/components/ConnectionActions.tsx`):
```typescript
export interface ConnectionActionsProps {
  userId: string;
  userName: string;
  connectionStatus?: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped';
  onAction: (action: ConnectionAction, userId: string) => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'lg';
}
```

### 3.6 Data Flow in Frontend

The inbox page shows how synthesis is fetched for each connection:

```typescript
// Fetch synthesis for discovered users
const fetchSynthesis = async (targetUserId: string, intentIds?: string[], indexIds?: string[]) => {
  const response = await synthesisService.generateVibeCheck({
    targetUserId,
    intentIds,
    indexIds
  });
  setSyntheses(prev => ({ ...prev, [targetUserId]: response.synthesis }));
};

// After getting discover results
transformedStakesData.forEach(stake => {
  fetchSynthesis(stake.user.id, undefined, apiIndexIds);
});
```

---

## 4. Integration Constraints and Pitfalls

### 4.1 Auth & Identity

**Constraint**: Two-step token exchange is required
```
ChatGPT → MCP Server (OAuth JWT) → /token/privy/access-token → Protocol API (Privy JWT)
```

**Pitfalls**:
- **Different auth context paths**: mcp uses `extra?.authInfo?.token`, mcp2 uses `extra?.auth?.token`
- **Scope requirement**: Tool must check for `privy:token:exchange` scope
- **Token expiry**: OAuth and Privy tokens have different expiry times

**Mitigation**:
```typescript
// In discover_connections handler
if (!auth?.token) {
  return { content: [...], isError: true, _meta: { 'mcp/www_authenticate': '...' } };
}

if (!auth.scopes?.includes('privy:token:exchange')) {
  return { content: [{ type: 'text', text: 'Insufficient permissions' }], isError: true };
}

const privyToken = await exchangePrivyToken(auth.token);
```

### 4.2 Data Shape Mismatches

**Intent types** differ between systems:

| Source | Fields |
|--------|--------|
| Protocol API (`discover/new`) | `id`, `payload`, `summary?`, `createdAt` |
| mcp2 widget (`IntentData`) | `id`, `payload`, `summary?`, `createdAt` |
| ../mcp old implementation | Similar but may have additional fields |

**Connection types** are undefined - you must define them based on:
1. What `discover/filter` returns
2. What vibecheck synthesis returns
3. What the frontend expects

**Proposed Connection type**:
```typescript
interface Connection {
  id: string;
  // From discover/filter
  matchedIntents: string[];    // Intent IDs
  score?: number;              // Relevance score
  type?: string;               // Connection type

  // From vibecheck synthesis
  title: string;               // Human-readable title
  summary: string;             // Human-readable summary

  // Metadata
  createdAt: string;
  metadata?: Record<string, any>;
}
```

### 4.3 Orchestration Complexity

**The discover_connections flow requires THREE sequential API calls**:

1. `POST /discover/new` → Extract intents from input text
2. `POST /discover/filter` → Find connections from intents
3. `POST /synthesis/vibecheck` → Generate summaries for each connection

**Timeouts** (from actual implementations):
- Token exchange: 10s
- discover/new: 60s
- discover/filter: 30s (DB queries)
- vibecheck: 30s per user (LLM call, default in vibe_checker)

**Limits**:
- discover/filter limit: max 100 results per page
- vibecheck: one call per discovered user, run with concurrency (default 2, max 5)
- Throttle vibecheck calls with 75ms delay between each

**Critical**: Vibecheck requires passing `intentIds` from the user's matched intents AND `targetUserId`. The synthesis is generated FROM the context user's intents TO the target user.

**Proposed orchestration**:
```typescript
async function handleDiscoverConnections(args: any, auth: any) {
  const privyToken = await exchangePrivyToken(auth.token);

  // 1. Extract intents from input text
  const discoverResult = await callDiscoverNew(privyToken, args.text);
  const intentIds = discoverResult.intents.map(i => i.id);

  if (intentIds.length === 0) {
    return {
      content: [{ type: 'text', text: 'No intents found in input' }],
      structuredContent: { connections: [], intentsExtracted: 0, connectionsFound: 0 },
    };
  }

  // 2. Find matching users based on intents
  const filterResult = await callDiscoverFilter(privyToken, {
    intentIds,
    excludeDiscovered: true,
    limit: args.maxConnections || 10,
  });

  if (filterResult.results.length === 0) {
    return {
      content: [{ type: 'text', text: 'No connections found' }],
      structuredContent: { connections: [], intentsExtracted: intentIds.length, connectionsFound: 0 },
    };
  }

  // 3. Generate synthesis for each discovered user
  const enrichedConnections = [];
  for (const result of filterResult.results) {
    const synthesis = await callVibecheck(privyToken, {
      targetUserId: result.user.id,
      intentIds,  // Context user's intent IDs
    });

    enrichedConnections.push({
      id: result.user.id,
      user: result.user,
      synthesis: synthesis.synthesis,  // Markdown with intent links
      matchedIntents: result.intents.map(i => ({
        id: i.intent.id,
        payload: i.intent.payload,
        summary: i.intent.summary,
      })),
      totalStake: result.totalStake,
    });
  }

  // 4. Return structured response
  const summary = enrichedConnections.length === 1
    ? `Found 1 connection: ${enrichedConnections[0].user.name}`
    : `Found ${enrichedConnections.length} connections`;

  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: {
      connections: enrichedConnections,
      intentsExtracted: intentIds.length,
      connectionsFound: enrichedConnections.length,
    },
  };
}
```

### 4.4 Error Handling

**Protocol API error shapes** (from intent-spec.md):

| Status | Body Shape | Handling |
|--------|------------|----------|
| 400 | `{ error: string }` | Return validation error to user |
| 401 | `{ error: 'unauthorized' }` | Return auth error, include WWW-Authenticate |
| 500 | `{ error: string }` | Log error, return generic message |

**Partial failure handling**:

The tool must decide how to handle partial failures in the 3-step flow:

1. **discover/new fails**: Return error immediately
2. **discover/filter fails**: Return intents only? Or error?
3. **Vibecheck fails for some**: Return connections without summaries? Or error?

**Recommended approach**: Follow ../mcp pattern - partial failure tolerance for vibecheck
```typescript
try {
  const intents = await callDiscoverNew(...);
  const connections = await callDiscoverFilter(...);
  // Vibecheck failures return empty synthesis, don't fail whole request
  const enriched = await runVibeChecksWithRetries(connections, ...);
  return { content: [...], structuredContent: { connections: enriched } };
} catch (error) {
  // Only fail on discover/new or discover/filter errors
  console.error('[discover_connections] Error:', error);
  return {
    content: [{ type: 'text', text: error.message }],
    isError: true,
  };
}
```

**Special cases**:
- "No intents found": Not an error, return success with empty result
- "No connections found": Not an error, return success with empty result

### 4.5 Styling & Component Reuse

**Challenges**:

1. **Missing Tailwind config**: mcp2 widgets may not have full Tailwind setup
2. **No connections UI reference**: Must create from scratch or find in ../index
3. **Global dependencies**: Index frontend may use context providers, themes

**Strategy options**:

**Option A: Copy ConnectionCard from ../index**
- Pro: Exact visual match
- Con: May have dependencies on global styles/context

**Option B: Build minimal component with extracted styles**
- Pro: No dependencies
- Con: May not match exactly

**Recommended: Option B with these styles**:
```css
/* src/widgets/src/DiscoverConnections/styles.css */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.connection-card {
  font-family: 'IBM Plex Mono', monospace;
  background: #ffffff;
  border: 1px solid #E0E0E0;
  border-radius: 4px;
  padding: 1rem;
  margin-bottom: 0.5rem;
}

.connection-card:hover {
  border-color: #CCCCCC;
}

.connection-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #000;
  margin-bottom: 0.5rem;
}

.connection-summary {
  font-size: 0.75rem;
  color: #333;
  line-height: 1.5;
}
```

---

## 5. Recommended Implementation Approach

### 5.1 Proposed Tool Contract

**Tool Name**: `discover_connections`

**Input Schema**:
```typescript
const DiscoverConnectionsSchema = z.object({
  text: z.string().min(1, 'Input text is required'),
  maxConnections: z.number().optional().default(10),
});
```

**Output Schema**:
```typescript
{
  content: [{ type: 'text', text: string }],
  structuredContent: {
    connections: Array<{
      id: string;                     // User ID
      user: {
        id: string;
        name: string;
        avatar: string | null;
        intro: string | null;
      };
      synthesis: string;              // Markdown from vibecheck (contains intent links)
      matchedIntents: Array<{
        id: string;
        payload: string;
        summary?: string | null;
      }>;
      totalStake: number;             // Relevance score
    }>;
    intentsExtracted: number;
    connectionsFound: number;
  },
  _meta: {
    'openai/toolInvocation/invoking': 'Finding connections...',
    'openai/toolInvocation/invoked': 'Found X connections',
  },
}
```

**Note**: The synthesis from vibecheck already contains the "title" as inline markdown with links. There's no separate title field - the synthesis IS the human-readable summary.

### 5.2 Orchestration Flow

```
1. Validate auth & input
   └─ Check auth?.userId, auth?.token
   └─ Validate with Zod schema

2. Exchange OAuth → Privy token
   └─ POST /token/privy/access-token
   └─ Timeout: 10s

3. Extract intents from text
   └─ POST /discover/new
   └─ Timeout: 60s
   └─ Return early if no intents

4. Find connections from intents
   └─ POST /discover/filter
   └─ Timeout: 30s
   └─ Return early if no connections

5. Generate summaries via vibecheck
   └─ POST /synthesis/vibecheck
   └─ Timeout: 30s per user (LLM call)
   └─ Run with concurrency (default 2, max 5)

6. Return structured response
```

### 5.3 Widget Data Consumption

**File**: `src/widgets/src/DiscoverConnections/DiscoverConnections.tsx`

```typescript
interface Connection {
  id: string;
  user: {
    id: string;
    name: string;
    avatar: string | null;
    intro: string | null;
  };
  synthesis: string;  // Markdown from vibecheck
  matchedIntents: Array<{
    id: string;
    payload: string;
    summary?: string | null;
  }>;
  totalStake: number;
}

interface ConnectionsData {
  connections: Connection[];
  intentsExtracted: number;
  connectionsFound: number;
}

export function DiscoverConnections() {
  const { toolOutput } = useOpenAi();
  const data = toolOutput as ConnectionsData | null;

  const connections = data?.connections || [];

  if (connections.length === 0) {
    return <div className="empty">No connections found</div>;
  }

  return (
    <div className="connections-widget">
      {connections.map(conn => (
        <div key={conn.id} className="connection-card">
          <div className="connection-header">
            <span className="connection-name">{conn.user.name}</span>
            <span className="connection-intents">{conn.matchedIntents.length} mutual intents</span>
          </div>
          <div className="connection-synthesis">{conn.synthesis}</div>
        </div>
      ))}
    </div>
  );
}
```

### 5.4 Configuration Additions

**Add to `src/server/config.ts`**:
```typescript
discoverConnections: {
  discoverFilterUrl: process.env.DISCOVER_FILTER_URL || `${process.env.PROTOCOL_API_URL}/discover/filter`,
  vibecheckUrl: process.env.VIBECHECK_URL || `${process.env.PROTOCOL_API_URL}/synthesis/vibecheck`,
  discoverFilterTimeoutMs: Number(process.env.DISCOVER_FILTER_TIMEOUT_MS ?? '30000'),
  vibecheckTimeoutMs: Number(process.env.VIBECHECK_TIMEOUT_MS ?? '30000'),
  maxConnections: Number(process.env.MAX_CONNECTIONS ?? '10'),
  vibecheckConcurrency: Number(process.env.VIBECHECK_CONCURRENCY ?? '2'),
  vibecheckThrottleMs: Number(process.env.VIBECHECK_THROTTLE_MS ?? '75'),
}
```

### 5.5 What NOT to Do

1. **Do NOT make direct Protocol API calls from the widget**
   - All API calls must go through the tool handler
   - Widget only consumes `structuredContent`

2. **Do NOT skip the token exchange**
   - Protocol API requires Privy JWT, not OAuth JWT

3. **Do NOT ignore timeouts**
   - Each API call needs its own timeout with AbortController

4. **Do NOT hardcode limits**
   - Use config for batch sizes, max connections, timeouts

---

## 6. Open Questions / Design Decisions

### 6.1 Resolved (from code analysis)

1. **discover/filter endpoint**: `POST /discover/filter` - takes intentIds array, returns users with matched intents
2. **Vibecheck endpoint**: `POST /synthesis/vibecheck` - processes one user at a time with targetUserId and intentIds
3. **Connections UI**: Card component with user header, synthesis section, and action buttons (see Section 3.5)

### 6.2 Design Decisions Needed

1. **Error handling strategy**
   - **Recommended**: Follow ../mcp pattern - partial failure tolerance for vibecheck (return empty synthesis on failure, don't fail whole request)
   - Fail entire request only on discover/new or discover/filter failures

2. **Parallel vs Sequential vibecheck calls**
   - Sequential: Simpler, avoids rate limits, but slower for many connections
   - Parallel: Faster, but may hit API limits
   - **Recommended**: Follow ../mcp pattern - concurrent with configurable concurrency (default 2, max 5), throttling (75ms between calls), and retry with backoff

3. **Widget state management**
   - Should user be able to dismiss/archive connections in widget?
   - **Recommended**: Start simple - no dismissal. Add later if needed.

4. **Widget styling approach**
   - Copy exact Tailwind classes from Index frontend?
   - Or build minimal standalone styles?
   - **Recommended**: Copy key classes but self-contained (no global dependencies)

5. **Max connections limit**
   - How many connections to return by default?
   - **Recommended**: Default 10, configurable via tool input

---

## 7. Next Steps

### Implementation

1. Add configuration to `config.ts`
2. Create helper functions for new API calls
3. Implement `handleDiscoverConnections` handler
4. Register tool in `ListToolsRequestSchema`
5. Add case to `CallToolRequestSchema` switch
6. Create widget component
7. Register widget resource

### Testing

1. Unit tests for helper functions
2. Integration tests for full flow
3. Test error cases (auth failure, API errors, empty results)
4. Test in ChatGPT iframe

---

## Appendix: File Reference

### mcp2 Files Analyzed

| File | Purpose |
|------|---------|
| [src/server/index.ts](src/server/index.ts) | Server entry, route setup |
| [src/server/mcp/tools.ts](src/server/mcp/tools.ts) | Tool registration & handlers |
| [src/server/mcp/resources.ts](src/server/mcp/resources.ts) | Widget resource registration |
| [src/server/oauth/token.ts](src/server/oauth/token.ts) | Token endpoints including Privy exchange |
| [src/server/config.ts](src/server/config.ts) | Centralized configuration |
| [src/widgets/src/IntentDisplay/](src/widgets/src/IntentDisplay/) | Intent widget (template for connections) |
| [src/widgets/src/hooks/useOpenAi.ts](src/widgets/src/hooks/useOpenAi.ts) | Widget data access hook |

### ../mcp Files Analyzed (Prior Implementation)

| File | Purpose |
|------|---------|
| `/Users/jahnik/index-network/mcp/src/server.ts` | `discover_filter` tool implementation (lines 877-1049) |
| `/Users/jahnik/index-network/mcp/filter-spec.md` | Detailed spec for discover_filter tool |

### ../index Protocol Files Analyzed

| File | Purpose |
|------|---------|
| `/Users/jahnik/index-network/index/protocol/src/routes/discover.ts` | `/discover/new` and `/discover/filter` endpoints |
| `/Users/jahnik/index-network/index/protocol/src/routes/synthesis.ts` | `/synthesis/vibecheck` endpoint |
| `/Users/jahnik/index-network/index/protocol/src/routes/connections.ts` | Connection actions (REQUEST, ACCEPT, etc.) |
| `/Users/jahnik/index-network/index/protocol/src/lib/discover.ts` | `discoverUsers()` implementation |
| `/Users/jahnik/index-network/index/protocol/src/lib/synthesis.ts` | `synthesizeVibeCheck()` implementation |
| `/Users/jahnik/index-network/index/protocol/src/agents/external/vibe_checker/index.ts` | Vibe checker LLM agent |

### ../index Frontend Files Analyzed

| File | Purpose |
|------|---------|
| `/Users/jahnik/index-network/index/frontend/src/app/inbox/page.tsx` | Main inbox page with connection cards |
| `/Users/jahnik/index-network/index/frontend/src/components/ConnectionActions.tsx` | Connection action buttons component |
| `/Users/jahnik/index-network/index/frontend/src/lib/types.ts` | TypeScript types for connections |

---

*Report generated by Claude Code analysis of mcp2, ../mcp, and ../index repositories.*
