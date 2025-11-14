# Quick Start Guide

## Prerequisites

- ✅ Bun installed
- ✅ Privy.io account with app created
- ✅ OpenSSL (for JWT keys)

## 5-Minute Setup

### 1. Generate JWT Keys

```bash
# Generate RSA key pair
openssl genrsa -out private-key.pem 2048
openssl rsa -in private-key.pem -pubout -out public-key.pem

# Get base64-encoded values
echo "JWT_PRIVATE_KEY=$(cat private-key.pem | base64 | tr -d '\n')"
echo "JWT_PUBLIC_KEY=$(cat public-key.pem | base64 | tr -d '\n')"

# Clean up
rm private-key.pem public-key.pem
```

### 2. Configure Environment

```bash
# Copy template
cp .env.example .env

# Edit .env and add:
# - Your Privy App ID & Secret (from dashboard.privy.io)
# - JWT keys from step 1
# - Your backend API URL
```

### 3. Install & Build

```bash
# Install dependencies
bun install

# Build widgets (REQUIRED before starting server!)
bun run build:widgets
```

⚠️ **Important**: Widgets must be built before the server can serve them!

### 4. Start Development Server

**Three ways to run the development server:**

#### Option 1: Simple (First-time setup)
```bash
# Start server with auto-reload
bun run dev

# Server runs at http://localhost:3002
# Note: Rebuild widgets manually when you change widget code
```

#### Option 2: Watch Mode (Active widget development)
```bash
# Terminal 1: Auto-rebuild widgets on changes
bun run dev:widgets

# Terminal 2: Run server
bun run dev
```

#### Option 3: All-in-One (Recommended)
```bash
# Runs both server AND widget watch mode
bun run dev:all

# Server runs at http://localhost:3002
# Widgets auto-rebuild when you make changes
```

## Test Locally

### Option 1: MCP Inspector

```bash
bunx @modelcontextprotocol/inspector http://localhost:3002/mcp
```

### Option 2: ngrok + ChatGPT

```bash
# Terminal 1: Run server
bun run dev

# Terminal 2: Expose with ngrok
ngrok http 3002

# Copy the HTTPS URL (e.g., https://abc123.ngrok.app)
# Use this in ChatGPT Settings → Connectors
```

## Connect to ChatGPT

1. **Enable Developer Mode**:
   - ChatGPT Settings → Apps & Connectors → Advanced
   - Enable "Developer mode"

2. **Create Connector**:
   - Settings → Connectors → Create
   - Name: Your App Name
   - URL: `https://your-server.com/mcp` or ngrok URL

3. **Test**:
   - New conversation → Click + → More → Select your connector
   - Authorize via Privy
   - Try: "Show me my items"

## Production Deploy

### Quick Deploy (Docker)

```bash
# Build
docker build -t chatgpt-app .

# Run
docker run -p 3000:3000 --env-file .env chatgpt-app
```

### Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login and launch
fly auth login
fly launch

# Set secrets
fly secrets set \
  PRIVY_APP_ID=xxx \
  PRIVY_APP_SECRET=xxx \
  JWT_PRIVATE_KEY=xxx \
  JWT_PUBLIC_KEY=xxx \
  BACKEND_API_URL=xxx

# Deploy
fly deploy
```

## Common Issues

### Widgets not loading?

The most common issue is forgetting to build widgets!

```bash
# Solution 1: Build widgets once, then restart server
bun run build:widgets
bun run dev

# Solution 2: Use dev:all to auto-rebuild widgets
bun run dev:all
```

**Remember**: `bun run dev` does NOT build widgets automatically!

### OAuth flow fails?
- Verify `SERVER_BASE_URL` in .env matches actual URL
- Check Privy App ID is correct
- Ensure JWT keys are valid base64

### Can't connect to ChatGPT?
- Must use HTTPS (use ngrok for local testing)
- Verify `/mcp` endpoint is accessible
- Check server logs for errors

## Development Commands

```bash
# Server commands
bun run dev              # Start dev server (does NOT build widgets!)
bun run start            # Run production server

# Widget commands
bun run build:widgets    # Build widgets once
bun run dev:widgets      # Build widgets in watch mode (auto-rebuild)

# Combined commands
bun run dev:all          # Run server + widget watch (recommended for development)
bun run build            # Build everything for production

# Other commands
bun test                 # Run tests
bun run type-check       # TypeScript type checking
```

## Project Structure

```
mcp2/
├── src/
│   ├── server/     # Express + MCP + OAuth
│   ├── client/     # React OAuth UI
│   └── widgets/    # React widget components
├── dist/           # Build output (gitignored)
└── package.json
```

## Need Help?

- 📖 Full docs: [README.md](README.md)
- 🔧 OpenAI Apps SDK: https://developers.openai.com/apps-sdk/
- 🔐 Privy Docs: https://docs.privy.io/
- 🚀 Bun Docs: https://bun.sh/docs

## Next Steps

1. Customize the ListView widget in `src/widgets/src/ListView/`
2. Add more tools in `src/server/mcp/tools.ts`
3. Connect to your actual backend API in `src/server/api/backend.ts`
4. Build additional widgets as needed
5. Deploy to production!

Happy building! 🚀
