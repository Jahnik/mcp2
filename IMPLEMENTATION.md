# Extract Intent Implementation Guide

## Quick Start

This guide shows you how to implement the `extract_intent` MCP tool in mcp2 with a React widget featuring archive/delete functionality.

## Prerequisites

- mcp2 already has Privy authentication and OAuth 2.0 implemented
- Token exchange endpoint `/token/privy/access-token` exists
- Zod validation is used for all tool inputs

---

## Part 1: Backend Implementation (2-3 hours)

### Step 1: Environment Configuration

Add to `.env`:
```bash
# Protocol API (Index backend)
PROTOCOL_API_URL=http://localhost:3001/api

# Timeouts
PROTOCOL_API_TIMEOUT_MS=60000
PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS=10000

# Content limits
EXTRACT_INTENT_SECTION_CHAR_LIMIT=5000
EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT=2000
```

Add to `src/server/config.ts`:
```typescript
export const config = {
  // ... existing config

  intentExtraction: {
    protocolApiUrl: process.env.PROTOCOL_API_URL!,
    protocolApiTimeoutMs: Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000'),
    privyTokenExchangeTimeoutMs: Number(process.env.PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS ?? '10000'),
    sectionCharLimit: Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000'),
    instructionCharLimit: Number(process.env.EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT ?? '2000'),
  },
};
```

### Step 2: Add Zod Schema for Tool Input

In `src/server/mcp/tools.ts`, add:

```typescript
const ExtractIntentSchema = z.object({
  fullInputText: z.string().min(1, 'Input text is required'),
  rawText: z.string().optional(),
  conversationHistory: z.string().optional(),
  userMemory: z.string().optional(),
});
```

### Step 3: Register extract_intent Tool

In `src/server/mcp/tools.ts`, add to the tools array in `ListToolsRequestSchema` handler:

```typescript
{
  name: 'extract_intent',
  description: 'Extracts and structures the user\'s goals, needs, or objectives from any conversation to help understand what they\'re trying to accomplish.',
  inputSchema: {
    type: 'object',
    properties: {
      fullInputText: {
        type: 'string',
        description: 'Full input text from the user'
      },
      rawText: {
        type: 'string',
        description: 'Raw text content from uploaded file (optional)'
      },
      conversationHistory: {
        type: 'string',
        description: 'Raw conversation history as text (optional)'
      },
      userMemory: {
        type: 'string',
        description: 'Raw user memory/context as text (optional)'
      },
    },
    required: ['fullInputText'],
  },
  annotations: {
    readOnlyHint: true  // Marks tool as "read-only" in ChatGPT UI
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

**Note:** The `annotations: { readOnlyHint: true }` field tells ChatGPT this tool doesn't modify data. Without this, ChatGPT marks it as having "write" access.

Add case to `CallToolRequestSchema` handler:

```typescript
case 'extract_intent':
  return await handleExtractIntent(args, auth);
```

### Step 4: Implement Tool Handler

Add to `src/server/mcp/tools.ts`:

```typescript
async function handleExtractIntent(args: any, auth: any) {
  // 1. Validate authentication
  if (!auth || !auth.userId) {
    return {
      content: [{ type: 'text', text: 'Authentication required.' }],
      isError: true,
      _meta: { 'mcp/www_authenticate': 'Bearer resource_metadata="..."' },
    };
  }

  // 2. Validate input
  const parseResult = ExtractIntentSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [{
        type: 'text',
        text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
      }],
      isError: true,
    };
  }

  const { fullInputText, rawText, conversationHistory, userMemory } = parseResult.data;

  try {
    // 3. Exchange OAuth token for Privy token
    const privyToken = await exchangePrivyToken(auth.token);

    // 4. Prepare payload - truncate sections to limits
    const truncate = (text: string | undefined, limit: number) =>
      text ? text.slice(0, limit) : '';

    const payload = [
      truncate(fullInputText, config.intentExtraction.instructionCharLimit),
      rawText ? `=== File Content ===\n${truncate(rawText, config.intentExtraction.sectionCharLimit)}` : '',
      conversationHistory ? `=== Conversation ===\n${truncate(conversationHistory, config.intentExtraction.sectionCharLimit)}` : '',
      userMemory ? `=== Context ===\n${truncate(userMemory, config.intentExtraction.sectionCharLimit)}` : '',
    ].filter(Boolean).join('\n\n');

    // 5. Call Protocol API
    const formData = new FormData();
    formData.append('payload', payload);

    const response = await fetch(`${config.intentExtraction.protocolApiUrl}/discover/new`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${privyToken}`,
      },
      body: formData,
      signal: AbortSignal.timeout(config.intentExtraction.protocolApiTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Protocol API error: ${response.status}`);
    }

    const data = await response.json();

    // 6. Return structured response for widget
    return {
      content: [{
        type: 'text',
        text: `Extracted ${data.intentsGenerated} intent(s)`,
      }],
      structuredContent: {
        intents: data.intents,
        filesProcessed: data.filesProcessed || 0,
        linksProcessed: data.linksProcessed || 0,
        intentsGenerated: data.intentsGenerated,
      },
      _meta: {
        'openai/toolInvocation/invoked': `Extracted ${data.intentsGenerated} intents`,
      },
    };
  } catch (error) {
    console.error('Error extracting intents:', error);
    return {
      content: [{
        type: 'text',
        text: `Failed to extract intents: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      isError: true,
    };
  }
}

// Helper function to exchange OAuth token for Privy token
async function exchangePrivyToken(oauthToken: string): Promise<string> {
  const response = await fetch(`${config.server.baseUrl}/token/privy/access-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${oauthToken}`,
    },
    signal: AbortSignal.timeout(config.intentExtraction.privyTokenExchangeTimeoutMs),
  });

  if (!response.ok) {
    throw new Error('Failed to exchange token');
  }

  const data = await response.json();
  return data.privyAccessToken;
}
```

### Step 5: Test Backend

Test without widget first:

```bash
bun run dev:all
```

Test in ChatGPT with the tool - you should see text responses before implementing the widget.

---

## Part 2: Widget Implementation (2-3 hours)

### Step 1: Setup Tailwind CSS

```bash
cd src/widgets
bun add -D tailwindcss postcss autoprefixer
```

Create `src/widgets/tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
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

### Step 2: Copy IntentList Component

```bash
mkdir -p src/widgets/src/shared
cp ../index/frontend/src/components/IntentList.tsx src/widgets/src/shared/
```

### Step 3: Create IntentDisplay Widget

Create `src/widgets/src/IntentDisplay/IntentDisplay.tsx`:

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

  const [removedIntentIds, setRemovedIntentIds] = useState<Set<string>>(new Set());
  const [removingIntentIds, setRemovingIntentIds] = useState<Set<string>>(new Set());

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

Create `src/widgets/src/IntentDisplay/index.tsx`:

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

Create `src/widgets/src/IntentDisplay/styles.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

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

Create `src/widgets/src/IntentDisplay/index.html`:

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

### Step 4: Update Vite Config

In `src/widgets/vite.config.ts`, add to the entry object:

```typescript
entry: {
  'echo': 'src/Echo/index.tsx',
  'list-view': 'src/ListView/index.tsx',
  'intent-display': 'src/IntentDisplay/index.html',  // NEW
}
```

### Step 5: Build Widget

```bash
cd src/widgets
bun run build
```

### Step 6: Register Widget with Server

The widget should be automatically picked up if the HTML file is in the build output. Test in ChatGPT.

---

## Part 3: Backend API Endpoint for Delete

Add to Protocol API backend (`../index/backend`):

```typescript
router.delete('/intents/:id', authenticatePrivy, async (req, res) => {
  const { id } = req.params;
  const userId = req.privyUser.userId;

  try {
    const intent = await db.intents.findUnique({
      where: { id },
      select: { userId: true }
    });

    if (!intent || intent.userId !== userId) {
      return res.status(404).json({ error: 'Intent not found' });
    }

    // Soft delete
    await db.intents.update({
      where: { id },
      data: { archived: true, archivedAt: new Date() }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error archiving intent:', error);
    return res.status(500).json({ error: 'Failed to archive intent' });
  }
});
```

---

## Implementation Checklist

### Backend
- [ ] Add environment variables to `.env`
- [ ] Add config to `src/server/config.ts`
- [ ] Add `ExtractIntentSchema` Zod schema
- [ ] Register `extract_intent` tool in `ListToolsRequestSchema`
- [ ] Add case to `CallToolRequestSchema` handler
- [ ] Implement `handleExtractIntent` function
- [ ] Implement `exchangePrivyToken` helper
- [ ] Test tool without widget

### Widget
- [ ] Install Tailwind CSS dependencies
- [ ] Create `tailwind.config.js`
- [ ] Copy IntentList component from ../index
- [ ] Create IntentDisplay component with archive/delete
- [ ] Create index.tsx entry point
- [ ] Create styles.css with Tailwind directives
- [ ] Create index.html
- [ ] Update vite.config.ts entry points
- [ ] Build widget
- [ ] Test in ChatGPT

### Backend API (in Protocol API)
- [ ] Add DELETE `/api/intents/:id` endpoint
- [ ] Test archive functionality

---

## Common Pitfalls

1. **Token Exchange Timing Out**
   - Ensure MCP server URL is correct
   - Check timeout values are reasonable
   - Verify `/token/privy/access-token` endpoint exists

2. **Widget Not Loading**
   - Check Vite build output includes widget files
   - Verify widget HTML path matches `outputTemplate` in tool metadata
   - Check browser console for errors

3. **IntentList Dependencies**
   - IntentList uses Tailwind classes - must have Tailwind configured
   - Check for any missing imports from IntentList

4. **Archive/Delete Not Working**
   - Verify Protocol API endpoint exists
   - Check authentication headers are passed correctly
   - Ensure intent ownership validation works

5. **Content Truncation Issues**
   - Protocol API has limits on payload size
   - Pre-truncate sections before sending to avoid errors

---

## Testing

1. Test with simple text input
2. Test with long text (verify truncation)
3. Test with multiple optional sections
4. Test archive/delete buttons in widget
5. Test error cases (invalid token, API timeout)

---

## Time Estimate

- Backend: 2-3 hours
- Widget: 2-3 hours
- Backend API: 30 minutes
- Testing: 1 hour
- **Total: 5-7 hours**
