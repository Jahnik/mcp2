# MCP2 - Essential Code Patterns

This document contains copy-paste-ready patterns for common operations in mcp2.

## 1. Creating a New MCP Tool

### Step 1: Define Zod Schema (in tools.ts)

```typescript
const MyToolSchema = z.object({
  requiredParam: z.string().min(1, 'Required param is required'),
  optionalParam?: z.string().optional(),
  numberParam?: z.number().optional(),
});
```

### Step 2: Register Tool in ListToolsRequestSchema Handler

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ... existing tools ...
      {
        name: 'my-tool',
        description: 'What my tool does',
        inputSchema: {
          type: 'object',
          properties: {
            requiredParam: {
              type: 'string',
              description: 'Description of param',
            },
            optionalParam: {
              type: 'string',
              description: 'Optional param',
            },
            numberParam: {
              type: 'number',
              description: 'Number param',
            },
          },
          required: ['requiredParam'],
        },
        annotations: {
          readOnlyHint: true,
        },
        _meta: {
          'openai/outputTemplate': 'ui://widget/my-tool.html',
          'openai/toolInvocation/invoking': 'Processing...',
          'openai/toolInvocation/invoked': 'Done',
          'openai/widgetAccessible': true,
          'openai/resultCanProduceWidget': true,
        },
      },
    ],
  };
});
```

### Step 3: Add Case in CallToolRequestSchema Handler

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const auth = (extra as any)?.auth;

  switch (name) {
    case 'my-tool':
      return await handleMyTool(args, auth);
    // ... other cases ...
  }
});
```

### Step 4: Implement Handler Function

```typescript
async function handleMyTool(args: any, auth: any) {
  // 1. Validate authentication
  if (!auth || !auth.userId) {
    return {
      content: [{ type: 'text', text: 'Authentication required.' }],
      isError: true,
      _meta: { 'mcp/www_authenticate': 'Bearer resource_metadata="..."' },
    };
  }

  // 2. Validate input with Zod
  const parseResult = MyToolSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [{
        type: 'text',
        text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
      }],
      isError: true,
    };
  }

  const { requiredParam, optionalParam, numberParam } = parseResult.data;

  try {
    // 3. Exchange OAuth token for Privy token (if calling Protocol API)
    const privyToken = await exchangePrivyToken(auth.token);

    // 4. Call Protocol API
    const response = await fetch(`${config.intentExtraction.protocolApiUrl}/my-endpoint`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${privyToken}` },
      body: JSON.stringify({ requiredParam, optionalParam, numberParam }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Protocol API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 5. Return structured response for widget
    return {
      content: [{ type: 'text', text: `Success: ${data.message}` }],
      structuredContent: {
        // Data that widget will receive in window.openai.toolOutput
        result: data.result,
        count: data.count,
      },
      _meta: {
        'openai/toolInvocation/invoked': `Processed ${data.count} items`,
      },
    };
  } catch (error) {
    console.error('Error in my-tool:', error);
    return {
      content: [{
        type: 'text',
        text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      isError: true,
    };
  }
}
```

---

## 2. Token Exchange Pattern

```typescript
async function exchangePrivyToken(oauthToken: string): Promise<string> {
  const tokenPreview = `${oauthToken.slice(0, 8)}...${oauthToken.slice(-8)}`;
  console.log(`[exchangePrivyToken] Exchanging OAuth token ${tokenPreview}`);

  const response = await fetch(`${config.server.baseUrl}/token/privy/access-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${oauthToken}`,
    },
    signal: AbortSignal.timeout(config.intentExtraction.privyTokenExchangeTimeoutMs),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[exchangePrivyToken] Exchange failed: ${response.status}`, errorBody);
    throw new Error(`Failed to exchange token: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as { privyAccessToken: string };
  console.log(`[exchangePrivyToken] Successfully exchanged token`);
  return data.privyAccessToken;
}
```

---

## 3. Creating a New Widget

### Step 1: Create Component File

```typescript
// src/widgets/src/MyTool/MyTool.tsx

'use client';

import { useOpenAi } from '../hooks/useOpenAi';
import { useWidgetState } from '../hooks/useWidgetState';
import './styles.css';

interface WidgetState {
  selectedId: string | null;
  loading: boolean;
}

export function MyTool() {
  const { toolOutput, theme, callTool } = useOpenAi();
  const [widgetState, setWidgetState] = useWidgetState<WidgetState>(() => ({
    selectedId: null,
    loading: false,
  }));

  // Extract data from toolOutput (ChatGPT may flatten structuredContent)
  const data = (
    toolOutput?.structuredContent ||
    toolOutput?.result?.structuredContent ||
    toolOutput
  );

  const items = data?.items || [];

  const handleItemSelect = (itemId: string) => {
    setWidgetState((prev) => ({
      ...prev,
      selectedId: itemId,
    }));
  };

  if (!data || items.length === 0) {
    return (
      <div className={`my-tool theme-${theme}`}>
        <div className="empty-state">No items found</div>
      </div>
    );
  }

  return (
    <div className={`my-tool theme-${theme}`}>
      <div className="header">
        <h2>My Tool</h2>
      </div>
      <div className="content">
        {items.map((item: any) => (
          <div
            key={item.id}
            className={`item ${widgetState.selectedId === item.id ? 'selected' : ''}`}
            onClick={() => handleItemSelect(item.id)}
          >
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 2: Create Entry Point

```typescript
// src/widgets/src/MyTool/index.tsx

import { createRoot } from 'react-dom/client';
import { MyTool } from './MyTool';

const root = createRoot(document.getElementById('root')!);
root.render(<MyTool />);
```

### Step 3: Create Styles

```css
/* src/widgets/src/MyTool/styles.css */

.my-tool {
  padding: 1rem;
  font-family: system-ui, -apple-system, sans-serif;
}

.my-tool.theme-dark {
  background: #1e1e1e;
  color: #fff;
}

.my-tool.theme-light {
  background: #fff;
  color: #000;
}

.my-tool .header h2 {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
}

.my-tool .content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.my-tool .item {
  padding: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.my-tool .item:hover {
  border-color: #0078d4;
  background: #f0f7ff;
}

.my-tool .item.selected {
  border-color: #0078d4;
  background: #e8f4f8;
}

.my-tool .item h3 {
  margin: 0 0 0.25rem 0;
  font-size: 0.95rem;
}

.my-tool .item p {
  margin: 0;
  font-size: 0.85rem;
  color: #666;
}

.my-tool .empty-state {
  padding: 2rem;
  text-align: center;
  color: #999;
}
```

### Step 4: Register Widget Resource (in resources.ts)

```typescript
const widgets = [
  // ... existing widgets ...
  {
    fileName: 'my-tool',
    uri: 'ui://widget/my-tool.html',
    name: 'MyTool Widget',
    description: 'My tool widget description',
  },
];

// Also add to getWidgetMeta function:
const metadataMap: Record<string, any> = {
  // ... existing ...
  'ui://widget/my-tool.html': {
    'openai/outputTemplate': 'ui://widget/my-tool.html',
    'openai/toolInvocation/invoking': 'Loading...',
    'openai/toolInvocation/invoked': 'Loaded',
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true,
  },
};
```

---

## 4. Authentication Patterns

### Validating OAuth Token with Scope Requirements

```typescript
// In handlers.ts or other route files
import { validateToken } from '../middleware/auth.js';

mcpRouter.post('/', validateToken(['read', 'privy:token:exchange']), async (req, res) => {
  // At this point, req.auth is attached and has required scopes
  const { userId, scopes, token } = req.auth;
  
  // Use the token
  const privyToken = await exchangePrivyToken(token);
  
  // Continue...
});
```

### Reading Auth Information in Tool Handlers

```typescript
async function handleMyTool(args: any, auth: any) {
  // auth object contains:
  // {
  //   token: string;              // OAuth access token
  //   decoded: jwt.JwtPayload;    // Decoded JWT
  //   userId: string;             // Privy DID
  //   scopes: string[];           // Token scopes
  // }

  // Check auth exists
  if (!auth || !auth.userId) {
    return { content: [...], isError: true };
  }

  // Check specific scope
  if (!auth.scopes.includes('privy:token:exchange')) {
    return { content: [...], isError: true };
  }

  // Use token
  const privyToken = await exchangePrivyToken(auth.token);
}
```

---

## 5. Zod Input Validation Patterns

### Simple Schema

```typescript
const SimpleSchema = z.object({
  text: z.string().min(1, 'Text is required'),
  count: z.number().min(1, 'Count must be at least 1'),
  optional: z.string().optional(),
});
```

### Complex Schema with Nested Objects

```typescript
const ComplexSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  filters: z.object({
    type: z.string().optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
    dateRange: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }).optional(),
  }).optional(),
  pagination: z.object({
    limit: z.number().min(1).max(100).optional(),
    offset: z.number().min(0).optional(),
  }).optional(),
});
```

### Validation Pattern

```typescript
const parseResult = MySchema.safeParse(args);
if (!parseResult.success) {
  const errors = parseResult.error.errors
    .map(e => `${e.path.join('.')}: ${e.message}`)
    .join(', ');
  
  return {
    content: [{ type: 'text', text: `Invalid input: ${errors}` }],
    isError: true,
  };
}

const validatedArgs = parseResult.data;
// Use validatedArgs...
```

---

## 6. Protocol API Call Patterns

### FormData POST (for upload-like operations)

```typescript
const formData = new FormData();
formData.append('payload', JSON.stringify({ ...data }));

const response = await fetch(`${config.intentExtraction.protocolApiUrl}/discover/new`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${privyToken}` },
  body: formData,
  signal: AbortSignal.timeout(60000),
});
```

### JSON POST

```typescript
const response = await fetch(`${config.intentExtraction.protocolApiUrl}/discover/connections`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${privyToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: privyUserId,
    filters: { type: 'direct', status: 'active' },
  }),
  signal: AbortSignal.timeout(60000),
});
```

### Response Handling

```typescript
if (!response.ok) {
  const errorText = await response.text();
  console.error(`Protocol API error: ${response.status}`, errorText);
  throw new Error(`Protocol API error: ${response.status} - ${errorText}`);
}

const data = await response.json() as ExpectedResponseType;
```

---

## 7. Widget Data Flow Pattern

### In Tool Handler - Return Data

```typescript
return {
  content: [
    { type: 'text', text: `Found ${data.items.length} items` }
  ],
  structuredContent: {
    // This is what widget receives in window.openai.toolOutput.structuredContent
    items: data.items.map(item => ({
      id: item.id,
      title: item.name,
      description: item.description,
      metadata: item.metadata,
    })),
    total: data.total,
    filters: data.appliedFilters,
  },
  _meta: {
    'openai/toolInvocation/invoked': `Found ${data.items.length} items`,
  },
};
```

### In Widget - Receive Data

```typescript
export function MyWidget() {
  const toolOutput = useOpenAi();

  // ChatGPT may flatten structuredContent to top level
  const data = (
    toolOutput?.structuredContent ||
    toolOutput?.result?.structuredContent ||
    toolOutput
  );

  const items = data?.items || [];

  // Render items...
}
```

---

## 8. Widget State Management Pattern

### Define State Type

```typescript
interface MyWidgetState {
  selectedIds: string[];
  filters: {
    type?: string;
    status?: string;
  };
  loading: boolean;
  expandedId?: string;
}
```

### Use Hook

```typescript
const [widgetState, setWidgetState] = useWidgetState<MyWidgetState>(() => ({
  selectedIds: [],
  filters: {},
  loading: false,
}));
```

### Update State

```typescript
// Single update
setWidgetState((prev) => ({
  ...prev,
  selectedIds: [...prev.selectedIds, newId],
}));

// Conditional update
setWidgetState((prev) => ({
  ...prev,
  expandedId: prev.expandedId === id ? undefined : id,
}));
```

### Read State

```typescript
const isSelected = widgetState.selectedIds.includes(item.id);
const isExpanded = widgetState.expandedId === item.id;
```

---

## 9. Error Handling Patterns

### Tool Error Response

```typescript
return {
  content: [{
    type: 'text',
    text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
  }],
  isError: true,
  _meta: {
    // Optional: include error type for ChatGPT to understand
    'mcp/error_code': 'OPERATION_FAILED',
  },
};
```

### Authentication Error Response

```typescript
return {
  content: [{
    type: 'text',
    text: 'Authentication required.',
  }],
  isError: true,
  _meta: {
    'mcp/www_authenticate': 'Bearer resource_metadata="' + config.server.baseUrl + '/.well-known/oauth-protected-resource"',
  },
};
```

### Input Validation Error Response

```typescript
return {
  content: [{
    type: 'text',
    text: `Invalid input: ${errors.join(', ')}`,
  }],
  isError: true,
};
```

---

## 10. Helpful Constants & Configs

### Timeout Values

```typescript
// Token exchange
config.intentExtraction.privyTokenExchangeTimeoutMs  // default: 10000 (10s)

// Protocol API calls
config.intentExtraction.protocolApiTimeoutMs         // default: 60000 (60s)

// Character limits for input
config.intentExtraction.instructionCharLimit         // default: 2000
config.intentExtraction.sectionCharLimit             // default: 5000
```

### OAuth Scopes

```typescript
config.oauth.scopesSupported
// ['read', 'write', 'profile', 'privy:token:exchange']

// For tools calling Protocol API:
const requiredScopes = ['read', 'privy:token:exchange'];
```

### Base URLs

```typescript
config.server.baseUrl                    // e.g., 'http://localhost:3002'
config.intentExtraction.protocolApiUrl   // e.g., 'https://protocol.example.com'
```

