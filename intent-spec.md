# Extract Intent Implementation Specification

## Overview

This specification documents the implementation requirements for adding intent extraction functionality to the MCP2 ChatGPT App. The spec is based on analysis of two reference implementations:

1. **../index** - The Index protocol backend API (`/discover/new` endpoint)
2. **../mcp** - The production MCP server implementation with `extract_intent` tool

## Recent Updates ✅

The following improvements have been made to mcp2 since this spec was created:

- **Authentication Security** ✅ Implemented Privy SDK (`@privy-io/server-auth`) for proper token verification
- **Privy Token Storage** ✅ Added `privyToken` field to all OAuth storage interfaces (AuthorizationCode, TokenData, RefreshTokenData)
- **Token Exchange Endpoint** ✅ Implemented `/token/privy/access-token` for MCP OAuth → Privy token exchange
- **Frontend Token Passing** ✅ Updated AuthorizePage to send `privy_token` during authorization
- **Scope Support** ✅ Added `'privy:token:exchange'` to supported scopes
- **Input Validation** ✅ Implemented Zod validation for all MCP tool inputs (GetItemsSchema, PerformActionSchema, EchoSchema)
- **Widget Design Decision** ✅ mcp2 will include a React widget for `extract_intent` matching the minimal grayscale design from ../index/frontend/IntentList.tsx (unlike ../mcp which has no widget)

These updates mean mcp2 now has feature parity with mcp for authentication and security. Sections marked with ✅ have been updated to reflect the current implementation.

---

## Table of Contents

1. [Backend API Reference](#backend-api-reference)
2. [Intent Analysis Engine](#intent-analysis-engine)
3. [MCP Tool Implementation](#mcp-tool-implementation)
4. [Widget Implementation (Optional)](#widget-implementation-optional)
5. [Authentication Flow](#authentication-flow)
6. [Environment Configuration](#environment-configuration)
7. [Critical Pitfalls & Best Practices](#critical-pitfalls--best-practices)
8. [Architectural Differences: mcp2 vs mcp](#architectural-differences-mcp2-vs-mcp)
9. [Implementation Checklist](#implementation-checklist)

---

## Backend API Reference

### Endpoint: POST /discover/new

**Source:** `/Users/jahnik/index-network/index/protocol/src/routes/discover.ts`

**Authentication:** Privy JWT token via `Authorization: Bearer <token>`

**Content-Type:** `multipart/form-data`

**Request Fields:**
```typescript
{
  files?: File[];      // Array of files (up to 10)
  payload?: string;    // Text content and/or URLs
}
```

**Processing Flow:**

1. **File Handling**
   - Uploads files to server
   - Saves metadata to `files` table
   - Extracts text content using `unstructured-client`
   - Processes files in parallel via `loadFilesInParallel()`

2. **URL Extraction**
   - Regex: `/https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[^\s]*)?/g`
   - Saves URLs to `indexLinks` table
   - Crawls each URL via `crawlLinksForIndex()`
   - Stores crawled content as markdown files

3. **Content Combination**
   - Merges file content + URL content + instruction text
   - Format: `User instruction: <text>\n\n=== URL ===\n<content>`
   - Truncates each piece to 5000 characters

4. **Intent Generation**
   - **Short payload (<100 chars) + no files/URLs** → Create intent directly
   - **Otherwise** → Call `analyzeObjects()` to generate intents via LLM

**Response Format:**
```typescript
{
  success: boolean;
  intents: Array<{
    id: string;           // UUID
    payload: string;      // The intent text
    summary?: string;     // Optional summary
    createdAt: string;    // ISO timestamp
  }>;
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}
```

**Error Responses:**
- `400` - Missing required fields or validation errors
- `401` - Invalid/missing authentication token
- `500` - Server error during processing

---

## Intent Analysis Engine

### Core Function: analyzeObjects()

**Source:** `/Users/jahnik/index-network/index/protocol/src/agents/core/intent_inferrer/index.ts`

**Signature:**
```typescript
async function analyzeObjects(
  objects: any[],
  textInstruction?: string,
  existingIntents?: string[],
  count?: number,        // Ignored - kept for backward compatibility
  timeoutMs?: number     // Default: 60000
): Promise<IntentInferenceResult>
```

**Processing Steps:**

1. **Content Concatenation**
   ```typescript
   for (const obj of objects) {
     const objContent = typeof obj.content === 'string'
       ? obj.content
       : JSON.stringify(obj, null, 2);

     concatenatedContent += `=== ${objName} ===\n${objContent.substring(0, 5000)}\n\n`;
   }
   ```

2. **Context Building**
   ```typescript
   const contextParts = [];
   if (textInstruction) {
     contextParts.push(`User Guidance: ${textInstruction}`);
   }
   // Note: existingIntents are commented out in current implementation
   ```

3. **LLM Intent Inference**
   - Uses `traceableStructuredLlm()` with Zod schema
   - Generates 3-7 intents dynamically (not fixed count)
   - Returns intents with confidence scores (0-1)

**Intent Types:**

| Type | Description | Example |
|------|-------------|---------|
| **Explicit** | Directly stated, temporal markers removed | "Looking for Rust devs to work on privacy-preserving computation" |
| **Implicit** | Inferred from context, exploratory tone preserved | "Figuring out how to make climate models accessible" |

**LLM Prompt Rules:**

1. Intents must be substantial and meaningful
2. Remove temporal markers ("Now", "Currently", "Just")
3. Skip generic instructions ("fill out form", "apply here")
4. Combine related technical requirements
5. Forward-looking (what they seek/offer), not backward-looking
6. Self-contained with enough context
7. Add relevant context from surrounding content

**Response Format:**
```typescript
{
  success: boolean;
  intents: Array<{
    payload: string;     // The intent in user's voice
    confidence: number;  // 0-1
  }>;
}
```

---

## MCP Tool Implementation

### Tool: extract_intent

**Source:** `/Users/jahnik/index-network/mcp/src/server.ts:780-835`

**mcp2 Implementation:** ✅ **WILL INCLUDE WIDGET** with minimal grayscale design matching ../index/frontend/IntentList.tsx

**Note:** The reference ../mcp implementation does NOT have a widget, but mcp2 will add one for better UX.

### Tool Registration (mcp2 with Widget)

```typescript
// In ListToolsRequestSchema handler
{
  name: 'extract-intent',
  description: 'Extracts and structures the user\'s goals, needs, or objectives from any conversation to help understand what they\'re trying to accomplish.',
  inputSchema: {
    type: 'object',
    properties: {
      fullInputText: { type: 'string', description: 'Full input text' },
      rawText: { type: 'string', description: 'Raw text content from uploaded file' },
      conversationHistory: { type: 'string', description: 'Raw conversation history as text' },
      userMemory: { type: 'string', description: 'Raw user memory/context as text' },
    },
    required: ['fullInputText'],
  },
  _meta: {
    'openai/outputTemplate': 'ui://widget/intent-display.html',
    'openai/toolInvocation/invoking': 'Analyzing intents...',
    'openai/toolInvocation/invoked': 'Intents analyzed',
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true,
  },
}
```

### Input Processing

**Content Truncation Limits:**
```typescript
const SECTION_CHAR_LIMIT = 5000;      // Per section
const INSTRUCTION_CHAR_LIMIT = 2000;  // For fullInputText
```

**Payload Builder:**
```typescript
function buildIntentPayload(input: {
  fullInputText: string;
  rawText?: string;
  conversationHistory?: string;
  userMemory?: string;
}): { combinedText: string; sectionCount: number } {
  const sections: Array<{ label: string; text: string }> = [];

  // Add each section if present
  const addSection = (label: string, value?: string) => {
    if (value && value.trim()) {
      sections.push({
        label,
        text: truncateText(value.trim(), SECTION_CHAR_LIMIT)
      });
    }
  };

  addSection('Full Input', input.fullInputText);
  addSection('Uploaded File', input.rawText);
  addSection('Conversation History', input.conversationHistory);
  addSection('User Memory', input.userMemory);

  // Format with clear delimiters
  const labeledBlocks = sections
    .map(({ label, text }) => `=== ${label} ===\n${text}`)
    .join('\n\n');

  // Build final payload
  const parts: string[] = [];
  if (input.fullInputText?.trim()) {
    parts.push(
      `User instruction: ${truncateText(input.fullInputText.trim(), INSTRUCTION_CHAR_LIMIT)}`
    );
  }
  if (labeledBlocks) {
    parts.push(labeledBlocks);
  }

  return {
    combinedText: parts.join('\n\n'),
    sectionCount: sections.length
  };
}
```

**Truncation Helper:**
```typescript
function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return text.substring(0, limit) + '...';
}
```

### Tool Handler Implementation

```typescript
async (input, extra) => {
  try {
    // 1. Validate authentication
    const authToken = extra?.authInfo?.token;
    if (!authToken) {
      throw new Error('Missing authentication context for extract_intent invocation.');
    }

    // 2. Build payload
    const { combinedText, sectionCount } = buildIntentPayload(input);
    if (!combinedText) {
      return {
        content: [{ type: 'text', text: 'No input content provided for intent extraction.' }],
        structuredContent: {
          intents: [],
          filesProcessed: 0,
          linksProcessed: 0,
          intentsGenerated: 0,
        },
      };
    }

    console.log(`[extract_intent] Forwarding ${combinedText.length} chars across ${sectionCount} sections to protocol API`);

    // 3. Exchange MCP token for Privy token
    const privyToken = await exchangePrivyToken(authToken);

    // 4. Call backend API
    const discoveryResponse = await submitDiscoveryRequest(privyToken.token, combinedText);

    // 5. Format response
    const summary = summarizeIntents(discoveryResponse.intents);

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        intents: discoveryResponse.intents,
        filesProcessed: discoveryResponse.filesProcessed,
        linksProcessed: discoveryResponse.linksProcessed,
        intentsGenerated: discoveryResponse.intentsGenerated,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extract intents.';
    console.error('[extract_intent] Error', error);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
```

### Helper Functions

**Text Summary Generator:**
```typescript
function summarizeIntents(intents: Array<{ id: string; payload: string }>): string {
  if (!intents || intents.length === 0) {
    return 'No intents detected.';
  }
  return intents
    .map((intent, index) => `${index + 1}. ${intent.payload}`)
    .join('\n');
}
```

**Backend API Call:**
```typescript
async function submitDiscoveryRequest(
  privyToken: string,
  payload: string
): Promise<DiscoveryRequestResponsePayload> {
  const baseUrl = process.env.PROTOCOL_API_URL;
  if (!baseUrl) {
    throw new Error('PROTOCOL_API_URL is not configured.');
  }

  const formData = new FormData();
  formData.append('payload', payload);

  const response = await fetchWithTimeout(
    `${baseUrl}/discover/new`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${privyToken}`,
      },
      body: formData,
    },
    60000,  // 60 second timeout
    'Discovery request'
  );

  const body = await parseJsonIfPresent(response);

  if (!response.ok || !body) {
    const message = (body as any)?.error || response.statusText;
    throw new Error(`Protocol API error (${response.status}): ${message}`);
  }

  if (!body.success) {
    throw new Error('Protocol API returned an unsuccessful status.');
  }

  return body;
}
```

---

## Authentication Flow

### Two-Step Token Exchange

```
┌─────────────┐
│   ChatGPT   │
└──────┬──────┘
       │ MCP Auth Token
       ▼
┌─────────────┐
│  MCP Server │
└──────┬──────┘
       │ POST /privy/access-token
       │ Authorization: Bearer <mcp-token>
       ▼
┌─────────────┐
│ Token Exchg │
└──────┬──────┘
       │ Privy Access Token
       ▼
┌─────────────┐
│  Protocol   │
│   Backend   │
└─────────────┘
```

### Token Exchange Implementation

**Endpoint:** `POST /privy/access-token`

**Implementation:**
```typescript
async function exchangePrivyToken(accessToken: string): Promise<{
  token: string;
  expiresAt?: number;
}> {
  const privyTokenExchangeUrl = `${process.env.MCP_SERVER_URL}/privy/access-token`;

  const response = await fetchWithTimeout(
    privyTokenExchangeUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    10000,  // 10 second timeout
    'Privy token exchange'
  );

  const body = await parseJsonIfPresent(response);

  if (!response.ok) {
    const message = body?.error_description || body?.error || response.statusText;
    throw new Error(`Privy token exchange failed (${response.status}): ${message}`);
  }

  if (!body?.privyAccessToken) {
    throw new Error('Token exchange response missing privyAccessToken');
  }

  return {
    token: body.privyAccessToken,
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : undefined,
  };
}
```

**Expected Response:**
```typescript
{
  privyAccessToken: string;
  expiresAt?: number | null;
  issuedAt?: number | null;
  userId?: string | null;
  scope?: string[];
}
```

### Timeout Helper

```typescript
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}
```

---

## Widget Implementation ✅ REQUIRED

**Note:** While the `extract_intent` tool in ../mcp does **NOT** have a widget, **mcp2 will implement a widget** for better UX.

### Design Requirements

The widget MUST follow the design language from `/Users/jahnik/index-network/index/frontend/src/components/IntentList.tsx`:

- **Color Scheme:** Minimal, subtle grayscale palette with semantic colors
  - Primary: White backgrounds (`#ffffff`)
  - Borders: Light gray (`#E0E0E0`, `#CCCCCC`)
  - Text: Dark gray/black (`#333`, `#000`)
  - Hover states: Subtle color shifts
  - Semantic colors: Green for "new" badges, blue for selected items
- **Borders:** Minimal rounded corners (`rounded-sm` = 2-4px border-radius)
- **Typography:** IBM Plex Mono font family, clean sizing hierarchy
- **Layout:** Card-based with clear hierarchy and consistent spacing
- **Interactions:** Hover effects, opacity transitions for action buttons

This creates visual consistency with the Index Protocol frontend that users are familiar with.

### Widget Structure

**Directory:**
```
src/widgets/src/IntentDisplay/
├── IntentDisplay.tsx    (React component - main widget)
├── styles.css          (Minimal grayscale styling)
└── index.tsx           (Entry point)

src/widgets/src/shared/
└── IntentList.tsx      (Copied from ../index/frontend/src/components/IntentList.tsx)
```

**Note:** Copy the IntentList component from `../index/frontend/src/components/IntentList.tsx` to use as the base component. This provides the card layout, hover effects, and action buttons (archive/delete).

**IntentDisplay.tsx (React Component with Archive/Delete):**
```typescript
import React, { useState } from 'react';
import { useOpenAi } from '../hooks/useOpenAi';
import IntentList from '../shared/IntentList';
import './styles.css';

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
  const { toolOutput } = useOpenAi();
  const data = toolOutput as IntentData | null;

  // Track removed intents locally
  const [removedIntentIds, setRemovedIntentIds] = useState<Set<string>>(new Set());
  const [removingIntentIds, setRemovingIntentIds] = useState<Set<string>>(new Set());

  // Filter out removed intents
  const visibleIntents = data?.intents?.filter(
    intent => !removedIntentIds.has(intent.id)
  ) || [];

  const handleRemoveIntent = async (intent: Intent) => {
    try {
      setRemovingIntentIds(prev => new Set(prev).add(intent.id));

      // Call backend API to archive/delete intent
      const response = await fetch(`/api/intents/${intent.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to remove intent');
      }

      // Remove from local state
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

  if (!data || visibleIntents.length === 0) {
    return (
      <div className="intent-widget">
        <div className="intent-empty">
          {removedIntentIds.size > 0
            ? 'All intents have been removed.'
            : 'No intents detected.'}
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

**index.tsx (Entry Point):**
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { IntentDisplay } from './IntentDisplay';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <IntentDisplay />
    </React.StrictMode>
  );
}
```

**styles.css (Widget wrapper styles):**
```css
/*
 * Minimal wrapper styles for IntentDisplay widget
 * IntentList component uses Tailwind classes, so Tailwind CSS must be configured
 */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.intent-widget {
  font-family: 'IBM Plex Mono', monospace;
  background: #ffffff;
  color: #333;
  min-height: 200px;
}

.intent-empty {
  padding: 1rem;
  text-align: center;
  color: #666;
  font-size: 0.75rem;
}

.intent-summary {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #E0E0E0;
  font-size: 0.75rem;
  font-weight: 500;
  background: #ffffff;
  color: #333;
}
```

**tailwind.config.js (Required for IntentList):**
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'ibm-plex-mono': ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
```

**Note:** Since IntentList uses Tailwind utility classes (`rounded-sm`, `border-[#E0E0E0]`, etc.), you must:
1. Install Tailwind CSS: `bun add -D tailwindcss postcss autoprefixer`
2. Create `tailwind.config.js` in `src/widgets/`
3. Add Tailwind directives to your CSS: `@tailwind base; @tailwind components; @tailwind utilities;`
4. Configure Vite to process Tailwind CSS

### Vite Configuration

**Add to `src/widgets/vite.config.ts`:**

```typescript
build: {
  lib: {
    entry: {
      'echo': 'src/Echo/index.tsx',
      'list-view': 'src/ListView/index.tsx',
      'intent-display': 'src/IntentDisplay/index.tsx',  // NEW
    },
    formats: ['es'],
  },
  // ...
}
```

### Backend API Endpoints for Archive/Delete

The widget needs backend API endpoints to archive/delete intents. These should be added to the Protocol API backend.

**DELETE /api/intents/:id**

Archive or delete an intent by ID. This endpoint should:
1. Verify the user is authenticated (via Privy token)
2. Check that the intent belongs to the authenticated user
3. Archive the intent (soft delete) or permanently delete it
4. Return success response

**Implementation location:** `/Users/jahnik/index-network/index/backend` (Index Protocol API)

```typescript
// Example endpoint handler
router.delete('/intents/:id', authenticatePrivy, async (req, res) => {
  const { id } = req.params;
  const userId = req.privyUser.userId;

  try {
    // Verify intent belongs to user
    const intent = await db.intents.findUnique({
      where: { id },
      select: { userId: true }
    });

    if (!intent || intent.userId !== userId) {
      return res.status(404).json({ error: 'Intent not found' });
    }

    // Archive intent (soft delete)
    await db.intents.update({
      where: { id },
      data: {
        archived: true,
        archivedAt: new Date()
      }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error archiving intent:', error);
    return res.status(500).json({ error: 'Failed to archive intent' });
  }
});
```

**Note:** The widget makes requests to `/api/intents/:id`, which should be proxied through the MCP server to the Protocol API with proper authentication.

### Server Widget Registration

```typescript
// Widget configuration
const intentDisplayWidget = {
  id: "intent-display",
  title: "Intent Display",
  templateUri: "ui://widget/intent-display.html",
  resourceName: "intent-display",
  invoking: "Analyzing intents...",
  invoked: "Intents analyzed",
  mimeType: "text/html+skybridge",
  html: intentDisplayWidgetHtml  // Loaded and rewritten at startup
};

// Register resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === intentDisplayWidget.templateUri) {
    return {
      contents: [{
        uri: intentDisplayWidget.templateUri,
        mimeType: intentDisplayWidget.mimeType,
        text: intentDisplayWidget.html,
        title: intentDisplayWidget.title,
        _meta: {
          "openai/widgetAccessible": true,
          "openai/resultCanProduceWidget": true,
          "openai/outputTemplate": intentDisplayWidget.templateUri,
          "openai/toolInvocation/invoking": intentDisplayWidget.invoking,
          "openai/toolInvocation/invoked": intentDisplayWidget.invoked,
        }
      }]
    };
  }

  // ... handle other widgets
});

// Update tool registration to include widget
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: 'extract_intent',
      description: '...',
      inputSchema: { /* ... */ },
      _meta: {
        'openai/outputTemplate': intentDisplayWidget.templateUri,
        'openai/widgetAccessible': true,
        'openai/resultCanProduceWidget': true,
      },
    }]
  };
});
```

---

## Environment Configuration

### Required Environment Variables

```bash
# Server Configuration
MCP_SERVER_URL=https://your-ngrok-url.ngrok-free.app
PORT=3002
NODE_ENV=development

# Protocol API
PROTOCOL_API_URL=http://localhost:3001
PROTOCOL_API_TIMEOUT_MS=60000

# Privy Token Exchange
PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS=10000

# Content Limits
EXTRACT_INTENT_SECTION_CHAR_LIMIT=5000
EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT=2000
```

### Configuration Loading

```typescript
// Type definitions
interface IntentConfig {
  protocolApiUrl: string;
  protocolApiTimeoutMs: number;
  privyTokenExchangeTimeoutMs: number;
  sectionCharLimit: number;
  instructionCharLimit: number;
}

// Load configuration
const intentConfig: IntentConfig = {
  protocolApiUrl: process.env.PROTOCOL_API_URL || '',
  protocolApiTimeoutMs: Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000'),
  privyTokenExchangeTimeoutMs: Number(process.env.PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS ?? '10000'),
  sectionCharLimit: Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000'),
  instructionCharLimit: Number(process.env.EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT ?? '2000'),
};

// Validation
function validateIntentConfig() {
  if (!intentConfig.protocolApiUrl) {
    throw new Error('PROTOCOL_API_URL is required for intent extraction');
  }
  console.log('✅ Intent extraction configured:', {
    protocolApiUrl: intentConfig.protocolApiUrl,
    timeouts: {
      api: `${intentConfig.protocolApiTimeoutMs}ms`,
      tokenExchange: `${intentConfig.privyTokenExchangeTimeoutMs}ms`,
    },
    limits: {
      section: intentConfig.sectionCharLimit,
      instruction: intentConfig.instructionCharLimit,
    },
  });
}
```

---

## Critical Pitfalls & Best Practices

### 1. Content Truncation is CRITICAL

**❌ Bad:**
```typescript
const payload = `${input.fullInputText}\n${input.rawText}\n${input.conversationHistory}`;
```

**✅ Good:**
```typescript
const sections = [
  { label: 'Full Input', text: truncateText(input.fullInputText, 2000) },
  { label: 'Raw Text', text: truncateText(input.rawText, 5000) },
  { label: 'History', text: truncateText(input.conversationHistory, 5000) },
];
const payload = sections
  .filter(s => s.text)
  .map(s => `=== ${s.label} ===\n${s.text}`)
  .join('\n\n');
```

**Why:** Backend API has content limits, prevents timeouts and excessive token usage.

### 2. FormData, NOT JSON

**❌ Bad:**
```typescript
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload })
});
```

**✅ Good:**
```typescript
const formData = new FormData();
formData.append('payload', payload);

fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData
});
```

**Why:** Backend expects `multipart/form-data` for file upload compatibility.

### 3. Two-Step Authentication

**❌ Bad:**
```typescript
// Directly use MCP token with backend
const response = await fetch(`${PROTOCOL_API_URL}/discover/new`, {
  headers: { Authorization: `Bearer ${extra.authInfo.token}` }
});
```

**✅ Good:**
```typescript
// Step 1: Exchange MCP token for Privy token
const privyToken = await exchangePrivyToken(extra.authInfo.token);

// Step 2: Use Privy token with backend
const response = await fetch(`${PROTOCOL_API_URL}/discover/new`, {
  headers: { Authorization: `Bearer ${privyToken.token}` }
});
```

**Why:** Backend requires Privy JWT, not MCP auth token.

### 4. Multiple Timeout Handling

**❌ Bad:**
```typescript
const response = await fetch(url);  // No timeout
```

**✅ Good:**
```typescript
async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Use different timeouts for different operations
await fetchWithTimeout(tokenUrl, options, 10000, 'Token exchange');
await fetchWithTimeout(apiUrl, options, 60000, 'Intent generation');
```

**Why:** Token exchange is fast (10s), intent generation is slow (60s).

### 5. Human-Readable Summary Required

**❌ Bad:**
```typescript
return {
  structuredContent: { intents }
};
```

**✅ Good:**
```typescript
const summary = intents.length === 0
  ? 'No intents detected.'
  : intents.map((intent, i) => `${i + 1}. ${intent.payload}`).join('\n');

return {
  content: [{ type: 'text', text: summary }],
  structuredContent: { intents, filesProcessed, linksProcessed, intentsGenerated }
};
```

**Why:** ChatGPT displays `content` to user, `structuredContent` is for widgets/data.

### 6. Error Handling at Every Step

**❌ Bad:**
```typescript
async function handleIntent(input, extra) {
  const payload = buildPayload(input);
  const token = await exchangeToken(extra.authInfo.token);
  const result = await callAPI(token, payload);
  return result;
}
```

**✅ Good:**
```typescript
async function handleIntent(input, extra) {
  try {
    // 1. Auth check
    if (!extra?.authInfo?.token) {
      throw new Error('Missing authentication context');
    }

    // 2. Payload building (can be empty)
    const { combinedText, sectionCount } = buildPayload(input);
    if (!combinedText) {
      return { content: [{ type: 'text', text: 'No content provided' }], structuredContent: { intents: [] } };
    }

    // 3. Token exchange (can fail/timeout)
    const privyToken = await exchangeToken(extra.authInfo.token);

    // 4. API call (can fail/timeout)
    const result = await callAPI(privyToken.token, combinedText);

    // 5. Success
    return formatResponse(result);

  } catch (error) {
    console.error('[extract_intent] Error:', error);
    return {
      content: [{ type: 'text', text: error.message }],
      isError: true
    };
  }
}
```

**Why:** Multiple failure points: auth, payload, token exchange, API call, parsing.

### 7. Widget Data Access Pattern

**❌ Bad:**
```typescript
// Assuming specific structure
const intents = window.openai.toolOutput.structuredContent.intents;
```

**✅ Good:**
```typescript
// Check multiple possible locations (ChatGPT flattens structuredContent)
const data = openai?.toolOutput ||
             openai?.toolOutput?.structuredContent ||
             openai?.toolOutput?.result?.structuredContent ||
             openai?.toolResponseMetadata?.structuredContent ||
             null;

const intents = data?.intents || [];
```

**Why:** ChatGPT flattens `structuredContent` to top level of `toolOutput`.

### 8. Asset URL Rewriting

**❌ Bad:**
```typescript
// Serve HTML as-is from Vite build
const html = fs.readFileSync('dist/widgets/intent.html', 'utf-8');
```

**✅ Good:**
```typescript
// Read HTML at startup
let intentHtml = fs.readFileSync('dist/widgets/intent.html', 'utf-8');

// Rewrite asset URLs to absolute paths
function rewriteAssetUrls(html: string, route: string) {
  const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
  return html.replace(
    /(src|href)="\/([^"]+)"/g,
    (_, attr, path) => {
      const suffix = path.startsWith(`${route}/`) ? path.slice(route.length + 1) : path;
      const normalizedPath = suffix ? `${route}/${suffix}` : route;
      return `${attr}="${baseUrl}/${normalizedPath}"`;
    }
  );
}

intentHtml = rewriteAssetUrls(intentHtml, 'widgets');
```

**Why:** ChatGPT serves widgets in iframe, relative paths won't work, need absolute URLs.

### 9. Vanilla JS for Widgets, Not React

**❌ Bad (for simple widgets):**
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';

function IntentWidget() {
  const [intents, setIntents] = useState([]);
  // Complex React setup
}
```

**✅ Good:**
```typescript
// Direct DOM manipulation
const listEl = document.getElementById('intent-list');

function render(intents) {
  listEl.innerHTML = '';
  intents.forEach((intent, i) => {
    const item = document.createElement('div');
    item.textContent = `${i + 1}. ${intent.payload}`;
    listEl.appendChild(item);
  });
}

// Load from window.openai
const data = (window as any).openai?.toolOutput;
render(data?.intents || []);
```

**Why:** Simpler, smaller bundle, faster load for basic display widgets.

### 10. Empty Response Handling

**❌ Bad:**
```typescript
if (!combinedText) {
  throw new Error('No content');
}
```

**✅ Good:**
```typescript
if (!combinedText) {
  return {
    content: [{ type: 'text', text: 'No input content provided for intent extraction.' }],
    structuredContent: {
      intents: [],
      filesProcessed: 0,
      linksProcessed: 0,
      intentsGenerated: 0,
    },
  };
}
```

**Why:** Return valid empty response rather than error, better UX.

---

## Architectural Differences: mcp2 vs mcp

This section documents the key architectural differences between the current mcp2 codebase and the reference mcp implementation. Understanding these differences is critical for implementing `extract_intent` correctly.

### 1. MCP Server Architecture

#### mcp2 (Current Implementation)

**Pattern:** Low-level `Server` class with manual `setRequestHandler()` pattern

**Location:** `/Users/jahnik/index-network/mcp2/src/server/mcp/server.ts`

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export async function initializeMCPServer(): Promise<Server> {
  mcpServer = new Server(
    { name: 'chatgpt-app-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  await registerWidgetResources(mcpServer);
  registerTools(mcpServer);
  return mcpServer;
}
```

**Tool Registration:** `/Users/jahnik/index-network/mcp2/src/server/mcp/tools.ts`

```typescript
// Step 1: List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get-items',
        description: '...',
        inputSchema: { type: 'object', properties: {...} },
        _meta: { 'openai/outputTemplate': 'ui://widget/list-view.html' }
      }
    ],
  };
});

// Step 2: Manual dispatch
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const auth = (extra as any)?.auth;

  switch (name) {
    case 'get-items':
      return await handleGetItems(args, auth);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});
```

#### mcp (Reference Implementation)

**Pattern:** Higher-level `McpServer` class with `registerTool()` convenience API

**Location:** `/Users/jahnik/index-network/mcp/src/server.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({
  name: "index-mcp-server",
  version: "1.0.1"
}, {
  capabilities: { tools: {}, resources: {} }
});

// Single registration with inline handler
server.registerTool("extract_intent", {
  title: "Analyze Conversation Intent",
  description: "Extracts and structures the user's goals...",
  inputSchema: {
    fullInputText: z.string().describe("Full input text"),
    rawText: z.string().optional(),
    conversationHistory: z.string().optional(),
    userMemory: z.string().optional(),
  },
  annotations: { readOnlyHint: true }
}, async (input, extra) => {
  const authToken = extra?.authInfo?.token;
  // Handler logic here
  return { content: [...], structuredContent: {...} };
});
```

#### Key Differences

| Aspect | mcp2 | mcp |
|--------|------|-----|
| **SDK Class** | `Server` | `McpServer` |
| **Tool Registration** | Manual handlers + switch/case | Direct `registerTool()` |
| **Input Validation** | Manual in handler | Zod schema with type inference |
| **Type Safety** | Partial (`args: any`) | Full (Zod-inferred types) |
| **Code Volume** | More boilerplate | More concise |
| **Auth Context** | `extra?.auth` | `extra?.authInfo` |

**Implication for extract_intent:**
- mcp2 requires manual handler in `CallToolRequestSchema` switch statement
- Must manually parse and validate `args` object
- Auth token accessed via `extra?.auth?.token` instead of `extra?.authInfo?.token`

---

### 2. Resource Registration Pattern

#### mcp2: Registry-Based with Dynamic HTML Generation

**Location:** `/Users/jahnik/index-network/mcp2/src/server/mcp/resources.ts`

```typescript
// Widget registry stores metadata only
const widgetRegistry = new Map<string, {
  name: string;
  description: string;
}>();

// Generates HTML with external script references
function createWidgetHTML(title: string, widgetFileName: string): string {
  const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
  return `
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="${baseUrl}/widgets/mcp2.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${baseUrl}/widgets/${widgetFileName}.js"></script>
  </body>
</html>
  `;
}

// Resource handler looks up from registry
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  for (const [widgetUri, widgetData] of widgetRegistry.entries()) {
    if (uri === widgetUri) {
      return {
        contents: [{
          uri: widgetUri,
          mimeType: 'text/html+skybridge',
          text: createWidgetHTML(widgetData.name, widgetFileName),
          _meta: getWidgetMeta(widgetUri),
        }],
      };
    }
  }
  throw new Error(`Unknown resource: ${uri}`);
});
```

**Static File Serving:** `/Users/jahnik/index-network/mcp2/src/server/index.ts`

```typescript
app.use('/widgets', express.static(path.join(process.cwd(), 'dist/widgets'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
```

#### mcp: Pre-loaded HTML with Inline Asset URLs

**Location:** `/Users/jahnik/index-network/mcp/src/server.ts`

```typescript
// Pre-load HTML at startup
const widgetHtmlPrimaryPath = join(__dirname, '../widgets/dist/widgets/index.html');
let widgetHtml = readFileWithFallback(widgetHtmlPrimaryPath, fallbackPath);

// Rewrite asset paths to absolute URLs
function rewriteAssetUrls(html: string, route: string) {
  const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
  return html.replace(/(src|href)="\/([^"]+)"/g, (_match, attr, path) => {
    return `${attr}="${baseUrl}/${route}/${path}"`;
  });
}

widgetHtml = rewriteAssetUrls(widgetHtml, 'widgets');

// Widget configuration with pre-loaded HTML
const indexEchoWidget = {
  id: "index-echo",
  templateUri: "ui://widget/index-echo.html",
  html: widgetHtml  // Full HTML content
};

// Direct resource registration
server.registerResource(
  indexEchoWidget.resourceName,
  indexEchoWidget.templateUri,
  {},
  async () => ({
    contents: [{
      uri: indexEchoWidget.templateUri,
      mimeType: 'text/html+skybridge',
      text: indexEchoWidget.html,
      _meta: { /* ... */ }
    }]
  })
);
```

#### Key Differences

| Aspect | mcp2 | mcp |
|--------|------|-----|
| **HTML Loading** | Generated dynamically | Pre-loaded at startup |
| **Memory Usage** | Lower (metadata only) | Higher (full HTML cached) |
| **Startup Time** | Faster | Slower |
| **Widget Registry** | Map-based | Inline objects |
| **Asset References** | External script tags | Inline/pre-rewritten |
| **Resource Handler** | Manual loop + lookup | Direct callback |

**Implication for extract_intent:**
- If adding a widget, follow mcp2's `loadWidget()` pattern
- Add widget to registry, let `createWidgetHTML()` generate the template
- Widget files served via Express static middleware

---

### 3. Widget Build System

#### mcp2: Vite Library Mode with React

**Location:** `/Users/jahnik/index-network/mcp2/src/widgets/vite.config.ts`

```typescript
export default defineConfig({
  plugins: [react()],
  root: 'src/widgets',
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: '../../dist/widgets',
    emptyOutDir: true,
    lib: {
      entry: {
        'list-view': 'src/ListView/index.tsx',
        'echo': 'src/Echo/index.tsx',
      },
      formats: ['es'],
      fileName: (format, name) => `${name}.js`,
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
        assetFileNames: '[name].[ext]',
      },
      external: [], // Bundle React
    },
  },
});
```

**Output:**
```
dist/widgets/
├── echo.js            (React component bundle)
├── list-view.js       (React component bundle)
└── mcp2.css          (Shared styles)
```

**Widget Implementation:** React with hooks

```typescript
// src/widgets/src/Echo/Echo.tsx
import { useOpenAi } from '../hooks/useOpenAi';

export function Echo() {
  const { toolOutput, toolInput, theme } = useOpenAi();

  const echoText = toolOutput?.text || toolInput?.text || 'No text provided';

  return (
    <div className={`echo-widget theme-${theme}`}>
      <div className="echo-text">{echoText}</div>
    </div>
  );
}
```

#### mcp: Vite Multi-Page App with HTML Entry Points

**Location:** `/Users/jahnik/index-network/mcp/widgets/vite.config.ts`

```typescript
export default defineConfig({
  plugins: [react(), copyWidgetHtmlPlugin()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        'widgets/index': resolve(__dirname, 'src/echo/index.html'),
        'widgets/discover': resolve(__dirname, 'src/discover/index.html'),
      },
      output: {
        entryFileNames: '[name]-[hash:8].js',
        assetFileNames: '[name]-[hash:8][extname]',
      }
    }
  }
});
```

**Output:**
```
dist/widgets/
├── index.html         (Complete HTML page)
├── index-abc123.js    (Bundled JS with hash)
└── styles-def456.css  (Bundled CSS with hash)
```

**Widget Implementation:** Vanilla JS with DOM manipulation

```typescript
// src/discover/index.tsx
const summaryEl = document.getElementById('discover-summary');
const cardsEl = document.getElementById('discover-cards');

function render(payload) {
  summaryEl.textContent = payload.summary ?? '';
  cardsEl.innerHTML = '';

  (payload.cards ?? []).forEach((card) => {
    const section = document.createElement('section');
    // Manual DOM building
    cardsEl.appendChild(section);
  });
}

const data = (window as any).openai?.toolOutput;
render(data);
```

#### Key Differences

| Aspect | mcp2 | mcp |
|--------|------|-----|
| **Build Mode** | Library (module output) | Multi-page (HTML output) |
| **Entry Points** | TypeScript files | HTML files |
| **Framework** | React + hooks | Vanilla JS |
| **Bundle Size** | Larger (React per widget) | Smaller (shared deps) |
| **Development** | Component-based | Script-based |
| **Type Safety** | Full TypeScript + React types | Partial (vanilla TS) |

**Implication for extract_intent widget (if needed):**
- mcp2: Create React component in `src/widgets/src/IntentDisplay/`
- Add entry to `vite.config.ts` lib.entry
- Use `useOpenAi()` hook to access data
- **OR** follow mcp's vanilla JS approach for simpler implementation

---

### 4. Authentication & Token Flow

#### mcp2: Privy SDK with Proper Verification ✅ UPDATED

**Middleware:** `/Users/jahnik/index-network/mcp2/src/server/middleware/privy.ts`

```typescript
import { PrivyClient } from '@privy-io/server-auth';

const privyClient = new PrivyClient(
  config.privy.appId,
  config.privy.appSecret
);

export async function verifyPrivyToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.substring(7);

  // Properly verify token using Privy SDK
  const claims = await privyClient.verifyAuthToken(token);

  if (!claims || !claims.userId) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  req.privyUser = {
    userId: claims.userId,
    appId: claims.appId,
  };
  next();
}
```

**OAuth Middleware:** `/Users/jahnik/index-network/mcp2/src/server/middleware/auth.ts`

```typescript
export function validateToken(requiredScopes: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.substring(7);

    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
    }) as jwt.JwtPayload;

    req.auth = {
      token,
      decoded,
      userId: decoded.sub as string,
      scopes: decoded.scope.split(' '),
    };
    next();
  };
}
```

**Auth passed to tools:**
```typescript
const auth = (extra as any)?.auth;
// { token, userId, scopes }
```

#### mcp: Privy SDK with Proper Verification

**Middleware:** `/Users/jahnik/index-network/mcp/src/auth.ts`

```typescript
import { PrivyClient } from "@privy-io/node";

const privyClient = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
  jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY,
});

export async function authenticatePrivy(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.slice("Bearer ".length);

  const validation = validateAccessToken(token);  // Local token check
  if (!validation.valid) {
    return res.status(401).json({ error: validation.message });
  }

  req.auth = {
    token,
    clientId: validation.clientId,
    scopes: validation.scope,
    expiresAt: Math.floor(validation.expiresAt / 1000),
    extra: {
      privyUserId: validation.claims.user_id,
      privySessionId: validation.claims.session_id,
    },
  };

  next();
}
```

**Auth passed to tools:**
```typescript
const authToken = extra?.authInfo?.token;
// String token value
```

#### Privy Token Exchange ✅ IMPLEMENTED IN MCP2

**Both implementations** need to exchange the MCP auth token for a Privy token to call the Protocol API.

**mcp2 Implementation:** `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts` (lines 298-333)

```typescript
tokenRouter.post('/privy/access-token', validateToken(['privy:token:exchange']), async (req, res) => {
  const oauthToken = req.auth?.token;
  const tokenData = getToken(oauthToken);

  if (!tokenData) {
    return res.status(404).json({ error: 'token_not_found' });
  }

  return res.json({
    privyAccessToken: tokenData.privyToken,
    expiresAt: tokenData.expiresAt,
    issuedAt: null,
    userId: tokenData.privyUserId,
    scope: tokenData.scopes,
  });
});
```

**mcp Implementation:** `/Users/jahnik/index-network/mcp/src/server.ts`

```typescript
async function exchangePrivyToken(accessToken: string) {
  const response = await fetchWithTimeout(
    `${baseUrl}/privy/access-token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    10000
  );

  const body = await response.json();
  return { token: body.privyAccessToken, expiresAt: body.expiresAt };
}
```

**Endpoint:** `POST /privy/access-token`

```typescript
app.post('/privy/access-token', authenticatePrivy, (req: AuthenticatedRequest, res) => {
  const scopes = req.oauth.scope || [];
  if (!scopes.includes('privy:token:exchange')) {
    return res.status(403).json({ error: 'insufficient_scope' });
  }

  const payload = getPrivyTokenExchangePayload(req.oauth.accessToken);
  return res.json({
    privyAccessToken: payload.privyToken,
    expiresAt: payload.expiresAt,
  });
});
```

#### Key Differences ✅ UPDATED

| Aspect | mcp2 | mcp |
|--------|------|-----|
| **Privy SDK** | @privy-io/server-auth ✅ | @privy-io/node SDK |
| **Token Verification** | Proper verification with SDK ✅ | Proper verification |
| **Auth Middleware** | Separate Privy + OAuth functions | Single unified function |
| **Token Storage** | OAuth tokens in Maps with Privy token ✅ | OAuth tokens in Maps |
| **Security Level** | High (full verification) ✅ | High (full verification) |
| **Auth Context** | `extra?.auth` object | `extra?.authInfo?.token` string |
| **Scope Checking** | Per-endpoint | In endpoints |
| **Token Exchange** | `/token/privy/access-token` ✅ | `/privy/access-token` |
| **Privy Token Storage** | Stored with OAuth tokens ✅ | Stored with OAuth tokens |

**Implication for extract_intent:**
- mcp2: Access token via `extra?.auth?.token` ✅
- mcp: Access token via `extra?.authInfo?.token`
- Both have `/privy/access-token` endpoint implemented ✅
- mcp2's endpoint path: `/token/privy/access-token`
- mcp's endpoint path: `/privy/access-token`

---

### 5. Configuration Management

#### mcp2: Centralized Config Module

**Location:** `/Users/jahnik/index-network/mcp2/src/server/config.ts`

```typescript
// Validate upfront
const requiredEnvVars = [
  'PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'SERVER_BASE_URL',
  'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'BACKEND_API_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Single config object
export const config = {
  privy: {
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
  },
  server: {
    baseUrl: process.env.SERVER_BASE_URL!,
    port: parseInt(process.env.PORT || '3002'),
  },
  jwt: { /* ... */ },
  backend: {
    apiUrl: process.env.BACKEND_API_URL!,
  },
} as const;
```

**Usage:**
```typescript
import { config } from './config';

const apiUrl = config.backend.apiUrl;
```

#### mcp: Direct Environment Variable Access

**Location:** Various files

```typescript
const issuer = process.env.OAUTH_ISSUER_URL ||
               process.env.MCP_SERVER_URL ||
               "http://localhost:3002";

const protocolApiTimeoutMs = Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000');
const sectionCharLimit = Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000');
```

**Validation:**
```typescript
const requiredEnv = ["PRIVY_APP_ID", "PRIVY_APP_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(`Missing required: ${missingEnv.join(", ")}`);
}
```

#### Key Differences

| Aspect | mcp2 | mcp |
|--------|------|-----|
| **Centralization** | Single config module | Scattered throughout |
| **Type Safety** | Full TypeScript types | Partial |
| **Validation** | Upfront at startup | Lazy/on-use |
| **Defaults** | Explicit in config | Inline with ?? operator |
| **Discoverability** | Easy (one file) | Must search codebase |
| **Testing** | Easy to mock | Must mock process.env |

**Implication for extract_intent:**
- mcp2: Add config to `config.ts`
```typescript
export const config = {
  // ... existing config
  intentExtraction: {
    protocolApiUrl: process.env.PROTOCOL_API_URL!,
    protocolApiTimeoutMs: Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000'),
    sectionCharLimit: Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000'),
  },
};
```

- mcp: Access directly
```typescript
const apiUrl = process.env.PROTOCOL_API_URL;
```

---

### 6. Implementation Strategy for extract_intent in mcp2

Based on the architectural differences, here's the recommended approach:

#### Step 1: Add Environment Configuration

**File:** `/Users/jahnik/index-network/mcp2/src/server/config.ts`

```typescript
export const config = {
  // ... existing config

  intentExtraction: {
    protocolApiUrl: process.env.PROTOCOL_API_URL || '',
    protocolApiTimeoutMs: Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000'),
    privyTokenExchangeTimeoutMs: Number(process.env.PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS ?? '10000'),
    sectionCharLimit: Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000'),
    instructionCharLimit: Number(process.env.EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT ?? '2000'),
  },
} as const;

// Validation
if (!config.intentExtraction.protocolApiUrl) {
  console.warn('Warning: PROTOCOL_API_URL not set. Intent extraction will not work.');
}
```

#### Step 2: Add Helper Functions

**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/intent-helpers.ts`

```typescript
import { config } from '../config';

interface IntentPayloadBuildResult {
  combinedText: string;
  sectionCount: number;
}

// Helper from mcp implementation
export function buildIntentPayload(input: {
  fullInputText: string;
  rawText?: string;
  conversationHistory?: string;
  userMemory?: string;
}): IntentPayloadBuildResult {
  const sections: Array<{ label: string; text: string }> = [];

  const addSection = (label: string, value?: string) => {
    if (value && value.trim()) {
      sections.push({
        label,
        text: truncateText(value.trim(), config.intentExtraction.sectionCharLimit)
      });
    }
  };

  addSection('Full Input', input.fullInputText);
  addSection('Uploaded File', input.rawText);
  addSection('Conversation History', input.conversationHistory);
  addSection('User Memory', input.userMemory);

  const labeledBlocks = sections
    .map(({ label, text }) => `=== ${label} ===\n${text}`)
    .join('\n\n');

  const parts: string[] = [];
  if (input.fullInputText?.trim()) {
    parts.push(
      `User instruction: ${truncateText(input.fullInputText.trim(), config.intentExtraction.instructionCharLimit)}`
    );
  }
  if (labeledBlocks) {
    parts.push(labeledBlocks);
  }

  return {
    combinedText: parts.join('\n\n'),
    sectionCount: sections.length
  };
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : text.substring(0, limit) + '...';
}

export function summarizeIntents(intents: Array<{ payload: string }>): string {
  if (!intents || intents.length === 0) {
    return 'No intents detected.';
  }
  return intents.map((intent, index) => `${index + 1}. ${intent.payload}`).join('\n');
}

// ... exchangePrivyToken and submitDiscoveryRequest from mcp
```

#### Step 3: Add Tool Handler

**File:** `/Users/jahnik/index-network/mcp2/src/server/mcp/tools.ts`

```typescript
// Add to ListToolsRequestSchema tools array
{
  name: 'extract-intent',
  description: 'Extracts and structures the user\'s goals, needs, or objectives from any conversation',
  inputSchema: {
    type: 'object',
    properties: {
      fullInputText: { type: 'string', description: 'Full input text' },
      rawText: { type: 'string', description: 'Raw text content from uploaded file' },
      conversationHistory: { type: 'string', description: 'Raw conversation history as text' },
      userMemory: { type: 'string', description: 'Raw user memory/context as text' },
    },
    required: ['fullInputText'],
  },
  // Note: No _meta - this tool doesn't have a widget
}

// Add to CallToolRequestSchema switch statement
case 'extract-intent':
  return await handleExtractIntent(args, auth);

// Add handler function
async function handleExtractIntent(args: any, auth: any) {
  if (!auth || !auth.token) {
    return {
      content: [{ type: 'text', text: 'Authentication required to extract intents.' }],
      isError: true,
    };
  }

  try {
    const { combinedText, sectionCount } = buildIntentPayload(args);

    if (!combinedText) {
      return {
        content: [{ type: 'text', text: 'No input content provided for intent extraction.' }],
        structuredContent: {
          intents: [],
          filesProcessed: 0,
          linksProcessed: 0,
          intentsGenerated: 0,
        },
      };
    }

    console.log(`[extract_intent] Forwarding ${combinedText.length} chars across ${sectionCount} sections`);

    const privyToken = await exchangePrivyToken(auth.token);
    const discoveryResponse = await submitDiscoveryRequest(privyToken.token, combinedText);
    const summary = summarizeIntents(discoveryResponse.intents);

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        intents: discoveryResponse.intents,
        filesProcessed: discoveryResponse.filesProcessed,
        linksProcessed: discoveryResponse.linksProcessed,
        intentsGenerated: discoveryResponse.intentsGenerated,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extract intents.';
    console.error('[extract_intent] Error:', error);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
```

#### Step 4: Privy Token Exchange Endpoint ✅ ALREADY IMPLEMENTED

**File:** `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts` (lines 298-333)

The Privy token exchange endpoint is already implemented in mcp2 at `/token/privy/access-token`.

```typescript
tokenRouter.post('/privy/access-token', validateToken(['privy:token:exchange']), async (req, res) => {
  try {
    const oauthToken = req.auth?.token;
    const tokenData = getToken(oauthToken);

    if (!tokenData) {
      return res.status(404).json({ error: 'token_not_found' });
    }

    return res.json({
      privyAccessToken: tokenData.privyToken,
      expiresAt: tokenData.expiresAt,
      issuedAt: null,
      userId: tokenData.privyUserId,
      scope: tokenData.scopes,
    });
  } catch (error) {
    console.error('[privy/access-token] Error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to exchange token',
    });
  }
});
```

**Note:** The endpoint is available at `/token/privy/access-token` (not `/privy/access-token`).
When calling this endpoint from extract_intent, use:
```typescript
const privyTokenExchangeUrl = `${process.env.MCP_SERVER_URL}/token/privy/access-token`;
```

---

### Summary: Architecture Comparison Table

| Component | mcp2 | mcp | Impact on extract_intent |
|-----------|------|-----|------------------------|
| **MCP Server** | `Server` + handlers | `McpServer` + registerTool | Must use manual handler pattern |
| **Tool Registration** | Switch/case dispatch | Direct registration | Add case to switch statement |
| **Input Validation** | Zod validation ✅ | Zod schemas | Zod validation implemented |
| **Auth Context** | `extra?.auth` object | `extra?.authInfo?.token` string | Access token via `auth?.token` |
| **Resource Loading** | Dynamic generation | Pre-loaded HTML | Follow existing pattern |
| **Widget Framework** | React + hooks | Vanilla JS | Can use React if adding widget |
| **Build System** | Vite lib mode | Vite multi-page | Follow existing vite.config |
| **Authentication** | Privy SDK + OAuth ✅ | Privy SDK + OAuth | Auth implementation matches |
| **Configuration** | Centralized module | Direct env vars | Add to config module |
| **Token Exchange** | `/token/privy/access-token` ✅ | `/privy/access-token` | Already implemented |
| **Privy Token Storage** | Stored with OAuth tokens ✅ | Stored with OAuth tokens | Already implemented |
| **Input Validation** | Zod validation ✅ | Manual validation | Already implemented |

---

## Implementation Checklist

### Phase 1: Backend Setup

- [ ] Add environment variables to `.env`
  - [ ] `PROTOCOL_API_URL`
  - [ ] `PROTOCOL_API_TIMEOUT_MS`
  - [ ] `PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS`
  - [ ] `EXTRACT_INTENT_SECTION_CHAR_LIMIT`
  - [ ] `EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT`

- [ ] Implement helper functions
  - [ ] `truncateText()`
  - [ ] `buildIntentPayload()`
  - [ ] `summarizeIntents()`
  - [ ] `fetchWithTimeout()`
  - [ ] `parseJsonIfPresent()`

- [ ] Implement authentication
  - [ ] `exchangePrivyToken()` function
  - [ ] Token exchange endpoint handler (if not exists)

- [ ] Implement backend API call
  - [ ] `submitDiscoveryRequest()` function
  - [ ] FormData construction
  - [ ] Error handling

- [ ] Register `extract_intent` tool
  - [ ] Tool definition with inputSchema
  - [ ] Tool handler implementation
  - [ ] Error handling and logging

- [ ] Test tool without widget
  - [ ] Test with simple text input
  - [ ] Test with multiple sections
  - [ ] Test with empty input
  - [ ] Test error cases (auth failure, API timeout)

### Phase 2: Widget Implementation with Archive/Delete

**Step 1: Setup Tailwind CSS**
- [ ] Install dependencies
  ```bash
  cd src/widgets
  bun add -D tailwindcss postcss autoprefixer
  ```
- [ ] Create `tailwind.config.js` in `src/widgets/`
- [ ] Add Tailwind directives to main CSS file
- [ ] Configure Vite to process Tailwind (already configured if using PostCSS)

**Step 2: Copy IntentList Component**
- [ ] Create shared directory
  ```bash
  mkdir -p src/widgets/src/shared
  ```
- [ ] Copy IntentList component
  ```bash
  cp ../index/frontend/src/components/IntentList.tsx src/widgets/src/shared/IntentList.tsx
  ```
- [ ] Verify IntentList has no external dependencies (like custom hooks or contexts)

**Step 3: Create IntentDisplay Widget**
- [ ] Create widget directory structure
  - [ ] `src/widgets/src/IntentDisplay/`
  - [ ] `IntentDisplay.tsx` (React component with archive/delete handlers)
  - [ ] `index.tsx` (entry point)
  - [ ] `styles.css` (wrapper styles)

- [ ] Implement IntentDisplay.tsx
  - [ ] Import IntentList from shared
  - [ ] Use `useOpenAi()` hook to get tool output
  - [ ] Track removed intents with `useState`
  - [ ] Implement `handleRemoveIntent` with fetch to `/api/intents/:id`
  - [ ] Filter visible intents (exclude removed)
  - [ ] Pass props to IntentList component

- [ ] Create index.html entry point
  ```html
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>Intent Display</title>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="./index.tsx"></script>
    </body>
  </html>
  ```

**Step 4: Add Backend API Endpoints**
- [ ] Add DELETE `/api/intents/:id` endpoint to Protocol API backend
  - [ ] Authenticate user via Privy token
  - [ ] Verify intent ownership
  - [ ] Archive intent (soft delete)
  - [ ] Return success response

- [ ] (Optional) Add API proxy in MCP server if needed
  - [ ] Proxy `/api/intents/*` to Protocol API
  - [ ] Forward authentication headers

**Step 5: Update Vite Configuration**
- [ ] Add intent-display to build entry points
  ```typescript
  entry: {
    'echo': 'src/Echo/index.tsx',
    'list-view': 'src/ListView/index.tsx',
    'intent-display': 'src/IntentDisplay/index.html',  // NEW
  }
  ```

**Step 6: Update Server Widget Registration**
- [ ] Load and rewrite intent-display widget HTML
- [ ] Register widget resource with server
- [ ] Add widget metadata to extract_intent tool registration
  - [ ] Add `_meta` to tool definition

- [ ] Test widget
  - [ ] Test data loading
  - [ ] Test rendering
  - [ ] Test theme switching
  - [ ] Test in ChatGPT iframe

### Phase 3: Production Readiness

- [ ] Add comprehensive logging
  - [ ] Request logging
  - [ ] Error logging
  - [ ] Performance metrics

- [ ] Add monitoring
  - [ ] Token exchange success rate
  - [ ] API call success rate
  - [ ] Average response time

- [ ] Documentation
  - [ ] API documentation
  - [ ] Error codes and messages
  - [ ] Usage examples

- [ ] Testing
  - [ ] Unit tests for helpers
  - [ ] Integration tests for tool
  - [ ] End-to-end tests with ChatGPT

---

## Type Definitions

```typescript
// Intent types
interface Intent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  updatedAt?: string;
  sourceId?: string | null;
  sourceType?: string | null;
  userId?: string;
}

// Tool input
interface ExtractIntentInput {
  fullInputText: string;
  rawText?: string;
  conversationHistory?: string;
  userMemory?: string;
}

// Backend response
interface DiscoveryRequestResponse {
  success: boolean;
  intents: Intent[];
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}

// Privy token response
interface PrivyTokenResponse {
  privyAccessToken: string;
  expiresAt?: number | null;
  issuedAt?: number | null;
  userId?: string | null;
  scope?: string[];
}

// Tool response
interface ExtractIntentResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: {
    intents: Intent[];
    filesProcessed: number;
    linksProcessed: number;
    intentsGenerated: number;
  };
  isError?: boolean;
  _meta?: {
    'openai/toolInvocation/invoking'?: string;
    'openai/toolInvocation/invoked'?: string;
  };
}

// Configuration
interface IntentConfig {
  protocolApiUrl: string;
  protocolApiTimeoutMs: number;
  privyTokenExchangeTimeoutMs: number;
  sectionCharLimit: number;
  instructionCharLimit: number;
}
```

---

## References

### Source Files Analyzed

1. **Backend API:**
   - `/Users/jahnik/index-network/index/protocol/src/routes/discover.ts`
   - `/Users/jahnik/index-network/index/protocol/src/agents/core/intent_inferrer/index.ts`

2. **Frontend Service:**
   - `/Users/jahnik/index-network/index/frontend/src/services/discover.ts`
   - `/Users/jahnik/index-network/index/frontend/src/components/DiscoveryForm.tsx`

3. **MCP Implementation:**
   - `/Users/jahnik/index-network/mcp/src/server.ts` (lines 221-341, 677-835)
   - `/Users/jahnik/index-network/mcp/widgets/src/discover/index.tsx`
   - `/Users/jahnik/index-network/mcp/widgets/vite.config.ts`

### Key Patterns from Reference Implementation

1. **No widget for extract_intent** - Text-only response
2. **FormData for backend** - Not JSON
3. **Two-step auth** - MCP token → Privy token → Backend
4. **Content truncation** - Section-wise with different limits
5. **Multiple timeouts** - 10s for token, 60s for API
6. **ChatGPT flattens structuredContent** - Check toolOutput directly
7. **Vanilla JS widgets** - Direct DOM manipulation
8. **Asset URL rewriting** - Absolute URLs required for iframe

---

## Next Steps

1. Start with **Phase 1** (backend without widget)
2. Test thoroughly with ChatGPT
3. Optionally implement **Phase 2** (widget) if needed
4. Follow production readiness checklist

**Estimated Implementation Time:**
- Phase 1 (Backend): 2-4 hours
- Phase 2 (Widget): 2-3 hours
- Phase 3 (Production): 1-2 hours
- **Total: 5-9 hours**
