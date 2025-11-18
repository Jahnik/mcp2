# Targeted Scan: Vibecheck, Connections Card, and Tailwind Dependencies

---

## 1. Vibecheck Synthesis Contract

### 1.1 Server Request/Response Shape

**file**: `../index/protocol/src/routes/synthesis.ts` (lines 14-73)

```typescript
// Request validators (express-validator)
router.post('/vibecheck',
  authenticatePrivy,
  [
    body('targetUserId').isUUID().withMessage('Target user ID must be a valid UUID'),
    body('intentIds').optional().isArray().withMessage('Intent IDs must be an array'),
    body('intentIds.*').optional().isUUID().withMessage('Each intent ID must be a valid UUID'),
    body('indexIds').optional().isArray().withMessage('Index IDs must be an array'),
    body('indexIds.*').optional().isUUID().withMessage('Each index ID must be a valid UUID'),
    body('options').optional().isObject().withMessage('Options must be an object')
  ],
  // ...
)

// Response shape (lines 62-66)
return res.json({
  synthesis,        // string - markdown text
  targetUserId,     // string - UUID
  contextUserId,    // string - UUID (authenticated user)
});
```

**file**: `../index/frontend/src/services/synthesis.ts` (lines 1-17)

```typescript
// Frontend request type
export interface SynthesisRequest {
  targetUserId: string;
  intentIds?: string[];
  indexIds?: string[];
  options?: {
    characterLimit?: number;
    [key: string]: unknown;
  };
}

// Frontend response type
export interface SynthesisResponse {
  synthesis: string;
  targetUserId: string;
  contextUserId: string;
  connectingStakes: number;  // Note: this field is in frontend type but NOT in actual route response
}
```

### 1.2 Agent-Level Behavior

**file**: `../index/protocol/src/agents/external/vibe_checker/index.ts`

**Exported types** (lines 10-41):

```typescript
export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  error?: string;
  timing?: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
  };
}

export interface VibeCheckOptions {
  timeout?: number;        // Default: 30000ms (line 69)
  characterLimit?: number; // Optional, passed to LLM prompt
}

export interface AuthenticatedUserIntent {
  id: string;
  payload: string;
  reasons: Array<{
    agent_name: string;
    agent_id: string;
    reasoning: string;
  }>;
}

export interface OtherUserData {
  id: string;
  name: string;
  intro: string;
  intents: AuthenticatedUserIntent[]; // Context user's intents matched to target user
}
```

**Function signature** (lines 46-48):

```typescript
export async function vibeCheck(
  otherUserData: OtherUserData,
  options: VibeCheckOptions = {}
): Promise<VibeCheckResult>
```

**Enforced limits and behavior** (from code, not comments):

1. **Timeout**: Default 30000ms (line 69), enforced via `Promise.race` with timeout promise (lines 141-143)
2. **Character limit**: Optional, passed directly to LLM system prompt as `Maximum ${characterLimit} characters` (line 86)
3. **Intent limit**: Only first 10 intents are processed: `.slice(0, 10)` (line 98)

**Output style enforcement** (from system prompt, lines 72-93):

The LLM is instructed to produce:
- Markdown with 2-3 inline hyperlinks: `[descriptive phrase](https://index.network/intents/ID)`
- Link format: natural phrases, not "(link)" suffix
- Links placed in beginning/middle, not end
- No bold, italic, or title
- Single paragraph, can use line breaks
- Addresses reader as "you", other person by first name only

### 1.3 Frontend Rendering

**file**: `../index/frontend/src/components/SynthesisMarkdown.tsx`

**Props interface** (lines 12-17):

```typescript
interface SynthesisMarkdownProps {
  content: string;
  className?: string;
  onArchive?: () => void;
  popoverControlRef?: React.MutableRefObject<{ close: () => void } | null>;
}
```

**Rendering approach** (lines 151-170):

- Uses `react-markdown` to render the synthesis string as markdown
- Custom link renderer with special styling and click handling
- Wraps content in `<div className={`${className} synthesis-markdown-content`}>`

**Link styling** (lines 156-165):

```typescript
<a
  href={href}
  onClick={(e) => handleLinkClick(e, href || '', String(children))}
  className="text-[#007EFF] font-medium py-0.5 px-0.5 -mx-0.5 rounded-md hover:opacity-80 cursor-pointer bg-[#edf5ff]"
  {...props}
>
  {children}
</a>
```

**Notable features**:
- Clicking a link opens a popover with "Focus" and "Archive" actions
- Focus action fetches intent and sets it as discovery filter
- Archive action archives the intent
- Popover closes on outside click, escape, or scroll

---

## 2. Connections Card UI

### 2.1 Props Interface

**file**: `../index/frontend/src/app/inbox/page.tsx`

The card is rendered by `renderUserCard` callback (lines 316-394). It accepts two different data shapes:

**Derived interface** (reconstructed from usage):

```typescript
// For discover tab
interface StakesByUserResponse {
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
      agent: { name: string; avatar: string; };
      stake: string;
    }>;
  }>;
}

// For requests tab
interface UserConnection {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  status: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';
  isInitiator: boolean;
  lastUpdated: string;
}

// Callback signature
const renderUserCard = useCallback((
  data: StakesByUserResponse | UserConnection,
  tabType: 'discover' | 'requests'
) => { ... }, [...]);
```

### 2.2 JSX Snippet

**file**: `../index/frontend/src/app/inbox/page.tsx` (lines 325-393)

```tsx
<div key={user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
  <div className="py-4 px-2 sm:px-4 ">
    {/* User Header */}
    <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
      <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
        <Image
          src={getAvatarUrl(user)}
          alt={user.name}
          width={48}
          height={48}
          className="rounded-full"
        />
        <div>
          <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{user.name}</h2>
          <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
            {intents !== undefined ? (
              intents.length > 0 ? (
                <span>{intents.length} mutual intent{intents.length !== 1 ? 's' : ''}</span>
              ) : (
                <span>Potential connection</span>
              )
            ) : (
              <span>{formatDate(lastUpdated!)}</span>
            )}
          </div>
        </div>
      </div>
      {/* Connection Actions */}
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <ConnectionActions
          userId={user.id}
          userName={user.name}
          connectionStatus={getConnectionStatus(tabType, requestsView)}
          onAction={handleConnectionAction}
          size="sm"
        />
      </div>
    </div>

    {/* Synthesis Section */}
    {(synthesisLoading[user.id] || syntheses[user.id]) && (
      <div className="mb-4">
        <h3 className="font-medium text-gray-700 mb-2 text-sm">What could happen here</h3>
        {synthesisLoading[user.id] ? (
          <div className="animate-pulse space-y-2">
            <div className="h-3 bg-gray-200 rounded w-full"></div>
            <div className="h-3 bg-gray-200 rounded w-full"></div>
            <div className="h-3 bg-gray-200 rounded w-11/12"></div>
            {/* ... more skeleton lines ... */}
          </div>
        ) : (
          <SynthesisMarkdown
            content={syntheses[user.id]}
            className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm"
            onArchive={fetchData}
            popoverControlRef={popoverControlRef}
          />
        )}
      </div>
    )}
  </div>
</div>
```

### 2.3 External Dependencies

| Component/Utility | File Path | Required for Widget? |
|-------------------|-----------|---------------------|
| `ConnectionActions` | `../index/frontend/src/components/ConnectionActions.tsx` | **Optional** - handles Request/Skip/Accept/Decline buttons. Can be simplified or omitted in widget. |
| `SynthesisMarkdown` | `../index/frontend/src/components/SynthesisMarkdown.tsx` | **Yes** - or use `react-markdown` directly with custom link styling |
| `getAvatarUrl` | `../index/frontend/src/lib/file-utils.ts` | **Yes** - simple utility, can be inlined: returns avatar URL or fallback |
| `formatDate` | `../index/frontend/src/lib/utils.ts` | **Optional** - only used for requests tab |
| `Image` | `next/image` | **No** - replace with `<img>` in widget |
| Context: `useIndexFilter`, `useDiscoveryFilter`, `useNotifications` | Various context files | **No** - these are for page-level state management |

**Note**: The card does NOT use any global theme provider. Styles are all inline Tailwind classes.

---

## 3. Tailwind Dependencies

### 3.1 Configuration

**file**: `../index/frontend/tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Empty - uses all defaults
  },
  plugins: [],
}
```

The config is **minimal** - no custom colors, fonts, or extensions in the theme.

### 3.2 Font Families

**file**: `../index/frontend/src/app/globals.css` (lines 1-3, 79-81)

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');

/* ... */

@layer components {
  .font-ibm-plex-mono {
    @apply font-['IBM_Plex_Mono'];
  }
}
```

**Usage in card**: `font-ibm-plex-mono` class applied to:
- User name: `<h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">`
- Mutual intents text: `<div className="... font-ibm-plex-mono">`

### 3.3 Colors Used by Card

All colors are **default Tailwind colors**:

| Class | Usage | Tailwind Default |
|-------|-------|------------------|
| `bg-white` | Card background | `#ffffff` |
| `border-gray-800` | Card border | `#1f2937` |
| `text-gray-900` | User name | `#111827` |
| `text-gray-700` | Synthesis text, section header | `#374151` |
| `text-gray-500` | Mutual intents subtext | `#6b7280` |
| `bg-gray-200` | Loading skeleton | `#e5e7eb` |
| `text-[#007EFF]` | Link color (in SynthesisMarkdown) | Custom blue |
| `bg-[#edf5ff]` | Link background (in SynthesisMarkdown) | Custom light blue |

### 3.4 Border Styles

```css
border border-b-2 border-gray-800
```

This creates a card with:
- 1px border on all sides
- 2px border on bottom only (creates subtle shadow effect)
- Border color `gray-800` (`#1f2937`)

### 3.5 Prose Plugin

The SynthesisMarkdown receives these prose-related classes:

```css
prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm
```

**Important**: Despite using `prose` classes, the tailwind config has **no plugins**. These classes are likely coming from a different source or are being used as arbitrary selectors (`[&_ul]` syntax).

### 3.6 Minimal CSS for Widget Reproduction

To reproduce this card in the mcp2 widget, you need:

```css
/* Font import */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');

/* Font class */
.font-ibm-plex-mono {
  font-family: 'IBM Plex Mono', monospace;
}

/* Link styling for synthesis markdown */
.synthesis-link {
  color: #007EFF;
  font-weight: 500;
  padding: 0.125rem;
  margin: -0.125rem;
  border-radius: 0.375rem;
  background-color: #edf5ff;
}

.synthesis-link:hover {
  opacity: 0.8;
}
```

All other classes (`bg-white`, `border-gray-800`, `text-gray-900`, etc.) are standard Tailwind defaults.

---

## 4. Open Questions / Ambiguities

### 4.1 Multiple Card Candidates

The inbox page uses a single `renderUserCard` function for both discover and requests tabs. This is the correct and only "connection card" in the frontend. There's no separate reusable component - it's defined inline in `page.tsx`.

### 4.2 Vibecheck Behavior - Implied but Not Enforced

1. **Intent link generation**: The vibe_checker agent is *instructed* to produce links in format `[phrase](https://index.network/intents/ID)`, but this is not validated. The agent could produce malformed links.

2. **Character limit**: Passed to LLM prompt but not validated on output. Synthesis could exceed the limit.

3. **Response field mismatch**: Frontend `SynthesisResponse` type includes `connectingStakes: number` but the actual route response doesn't return this field.

### 4.3 Widget Reproduction Challenges

1. **SynthesisMarkdown popover**: The popover with Focus/Archive actions requires:
   - `useRouter` from Next.js
   - `useIntents` context for fetching/archiving intents
   - `useDiscoveryFilter` context for setting filters
   - `createPortal` for rendering outside the card

   **For widget**: Replace with simple markdown rendering or implement a simpler click handler.

2. **ConnectionActions component**: Depends on notification context and has complex state management.

   **For widget**: Either omit or implement simplified version without notifications.

3. **Image optimization**: Uses `next/image` which requires Next.js.

   **For widget**: Use standard `<img>` tag.

4. **Context providers**: The page relies on multiple context providers (`IndexFilterContext`, `DiscoveryFilterContext`, `APIContext`).

   **For widget**: Not needed - widget receives data via `structuredContent`.

### 4.4 Prose Classes Without Plugin

The SynthesisMarkdown uses `prose prose-sm` classes but the tailwind config has no `@tailwindcss/typography` plugin. This suggests either:
- The plugin is installed but not listed in config (check `package.json`)
- The classes are being used as placeholders but don't actually apply any styles
- There's a PostCSS or CSS-in-JS setup applying these

**Recommendation**: For widget, don't rely on prose plugin. Use the explicit `[&_*]` selectors shown in the className or write custom CSS.

---

*Scan completed by Claude Code targeting vibecheck, connections card, and tailwind dependencies.*
