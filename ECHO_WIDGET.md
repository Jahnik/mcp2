# Echo Widget

A simple example widget that demonstrates the basics of building ChatGPT widgets.

## What It Does

The Echo widget receives text from the user and displays it in a beautifully styled component with:
- Gradient purple background (adapts to light/dark theme)
- Large, readable text display
- Timestamp showing when the echo was created
- Smooth animations and modern design

## How to Use

### 1. Build the Widget

```bash
bun run build:widgets
```

This compiles the Echo widget to `dist/widgets/echo.js` and `dist/widgets/echo.css`.

### 2. Start the Server

```bash
bun run dev
```

### 3. Test with ChatGPT

Once connected to ChatGPT, try:
- "Echo hello world"
- "Echo this is a test message"
- "Show me an echo of 'Hello from ChatGPT!'"

The `echo` tool will be called, and the Echo widget will render with your text.

## Files

- **Widget Component**: [`src/widgets/src/Echo/Echo.tsx`](src/widgets/src/Echo/Echo.tsx)
- **Styles**: [`src/widgets/src/Echo/styles.css`](src/widgets/src/Echo/styles.css)
- **Entry Point**: [`src/widgets/src/Echo/index.tsx`](src/widgets/src/Echo/index.tsx)
- **MCP Tool**: [`src/server/mcp/tools.ts`](src/server/mcp/tools.ts) (handleEcho function)

## How It Works

### Flow

```
User: "Echo hello world"
  ↓
ChatGPT calls echo tool with args: { text: "hello world" }
  ↓
MCP server handleEcho() function returns structured data
  ↓
ChatGPT renders Echo widget with the text
  ↓
Widget displays: "hello world" in styled component
```

### Code Structure

**Tool Definition** (in tools.ts):
```typescript
{
  name: 'echo',
  description: 'Echo back text to the user',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to echo' }
    },
    required: ['text']
  }
}
```

**Tool Handler**:
```typescript
async function handleEcho(args: any) {
  return {
    structuredContent: { text: args.text },
    _meta: {
      'openai/outputTemplate': 'ui://widget/echo.html',
      timestamp: new Date().toISOString()
    }
  };
}
```

**Widget Component**:
```typescript
export function Echo() {
  const { toolOutput, theme } = useOpenAi();
  const echoText = toolOutput?.structuredContent?.text || 'No text provided';

  return (
    <div className={`echo-widget theme-${theme}`}>
      <div className="echo-text">{echoText}</div>
    </div>
  );
}
```

## Customization

### Change the Styling

Edit [`src/widgets/src/Echo/styles.css`](src/widgets/src/Echo/styles.css):

```css
.echo-widget.theme-light {
  background: linear-gradient(135deg, #your-color 0%, #another-color 100%);
}
```

### Add Interactivity

Add buttons or actions to the Echo component:

```typescript
export function Echo() {
  const { toolOutput, callTool } = useOpenAi();

  const handleCopy = () => {
    navigator.clipboard.writeText(toolOutput?.structuredContent?.text);
  };

  return (
    <div>
      <div className="echo-text">{text}</div>
      <button onClick={handleCopy}>Copy</button>
    </div>
  );
}
```

### Pass More Data

Update the tool handler to pass additional data:

```typescript
async function handleEcho(args: any) {
  return {
    structuredContent: {
      text: args.text,
      wordCount: args.text.split(' ').length,
      charCount: args.text.length,
    },
    _meta: {
      'openai/outputTemplate': 'ui://widget/echo.html',
      timestamp: new Date().toISOString()
    }
  };
}
```

Then access it in the widget:

```typescript
const { text, wordCount, charCount } = toolOutput?.structuredContent || {};
```

## Use as a Template

The Echo widget serves as a minimal template for building more complex widgets:

1. **Copy the structure**: Duplicate `src/widgets/src/Echo/` to create new widgets
2. **Update the tool**: Add a new tool in `tools.ts`
3. **Register in Vite**: Add to `src/widgets/vite.config.ts` entry points
4. **Register resource**: Add to widget list in `src/server/mcp/resources.ts`
5. **Build and test**: `bun run build:widgets && bun run dev`

## Next Steps

Try building more complex widgets:
- **Form Widget**: Collect user input with forms
- **Chart Widget**: Display data visualizations
- **Map Widget**: Show geographic data
- **Calendar Widget**: Display events and schedules

The Echo widget shows you all the basics:
- Receiving data from tools
- Accessing theme
- Styling components
- Rendering in ChatGPT

Use it as a foundation to build whatever you need! 🚀
