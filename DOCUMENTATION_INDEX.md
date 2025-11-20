# MCP2 Documentation Index

This repository contains comprehensive documentation for the mcp2 architecture. Start here to navigate the available resources.

## Documents Overview

### 1. **ARCHITECTURE.md** (37 KB, 1172 lines)
**Comprehensive technical architecture document**

Complete reference covering:
- Express server layout and all route definitions
- OAuth2 authentication flow (authorize, token, token exchange)
- MCP tools system with all 4 tools documented
- Authentication & Privy integration details
- Widget system architecture and patterns
- Token exchange flow diagram
- Configuration and environment variables
- Build and deployment information

**Use this when:** You need the complete picture of how everything works together.

**Key sections:**
- Section 1: Express Server Layout
- Section 2: MCP Tools System
- Section 3: Authentication & Privy Integration
- Section 4: Widget System
- Section 5: Intent Display Widget (Primary Example)
- Section 6: OAuth Token Flow Diagram
- Section 7: Key Patterns for discover_connections

---

### 2. **ARCHITECTURE_QUICK_REFERENCE.md** (7.6 KB, 208 lines)
**Quick lookup reference for common tasks**

Fast reference guide covering:
- Directory structure and key files
- Critical files organized by function
- Token exchange flow (simplified)
- Configuration variables
- Type examples (Tool Input, Tool Output, Token Response)
- Implementation roadmap for new features

**Use this when:** You need a quick answer or reminder about a specific component.

**Key sections:**
- Directory Structure (Key Files)
- Critical Files by Function
- Token Exchange Flow
- Configuration
- Type Examples
- For discover_connections Implementation

---

### 3. **CODE_PATTERNS.md** (1380 lines)
**Copy-paste-ready code patterns for common operations**

Ready-to-use implementations for:
1. Creating a new MCP tool (4-step process)
2. Token exchange pattern
3. Creating a new widget (4-step process with component, entry, styles, registration)
4. Authentication patterns
5. Zod input validation patterns
6. Protocol API call patterns
7. Widget data flow patterns
8. Widget state management patterns
9. Error handling patterns
10. Helpful constants and configs

**Use this when:** You're implementing a new feature and need code examples.

**Best for:**
- Implementing discover_connections tool
- Creating discover_connections widget
- Adding new routes
- Handling authentication in tools

---

## Quick Navigation Guide

### I want to...

#### Understand the overall architecture
Start with: **ARCHITECTURE.md** (Sections 1-3)
Then read: **ARCHITECTURE_QUICK_REFERENCE.md** (Directory Structure section)

#### Implement the `discover_connections` feature
Read: **ARCHITECTURE.md** (Section 7: Key Patterns for discover_connections)
Use: **CODE_PATTERNS.md** (Sections 1, 3, 6, 7)
Reference: **ARCHITECTURE_QUICK_REFERENCE.md** (For discover_connections Implementation)

#### Create a new MCP tool
Use: **CODE_PATTERNS.md** (Section 1: Creating a new MCP Tool)
Reference: **ARCHITECTURE.md** (Section 2: MCP Tools System)

#### Create a new widget
Use: **CODE_PATTERNS.md** (Section 3: Creating a New Widget)
Reference: **ARCHITECTURE.md** (Section 4: Widget System)

#### Understand token flow
Read: **ARCHITECTURE.md** (Section 6: OAuth Token Flow Diagram & Section 3: Authentication)
Reference: **ARCHITECTURE_QUICK_REFERENCE.md** (Token Exchange Flow section)
Use: **CODE_PATTERNS.md** (Section 2: Token Exchange Pattern)

#### Handle authentication in tools
Use: **CODE_PATTERNS.md** (Section 4: Authentication Patterns)
Reference: **ARCHITECTURE.md** (Section 3: Authentication & Privy Integration)

#### Build and deploy
Read: **ARCHITECTURE.md** (Section 9: Build & Deployment)
Reference: **ARCHITECTURE_QUICK_REFERENCE.md** (Build & Run section)

#### Understand widget-tool communication
Read: **ARCHITECTURE.md** (Section 4: Widget System & Section 5: Intent Display Widget)
Use: **CODE_PATTERNS.md** (Section 7: Widget Data Flow Pattern & Section 8: Widget State Management)

---

## File Cross-Reference

### By Topic

**OAuth & Authentication:**
- ARCHITECTURE.md: Section 3
- ARCHITECTURE_QUICK_REFERENCE.md: Auth & Token Flow section
- CODE_PATTERNS.md: Section 4
- Source files:
  - `/Users/jahnik/index-network/mcp2/src/server/oauth/authorize.ts`
  - `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts`
  - `/Users/jahnik/index-network/mcp2/src/server/middleware/auth.ts`

**MCP Tools:**
- ARCHITECTURE.md: Section 2
- CODE_PATTERNS.md: Section 1
- Source files:
  - `/Users/jahnik/index-network/mcp2/src/server/mcp/tools.ts`
  - `/Users/jahnik/index-network/mcp2/src/server/mcp/handlers.ts`
  - `/Users/jahnik/index-network/mcp2/src/server/mcp/server.ts`

**Widgets:**
- ARCHITECTURE.md: Section 4 & 5
- CODE_PATTERNS.md: Section 3 & 7 & 8
- Source files:
  - `/Users/jahnik/index-network/mcp2/src/widgets/src/IntentDisplay/`
  - `/Users/jahnik/index-network/mcp2/src/widgets/src/hooks/useOpenAi.ts`
  - `/Users/jahnik/index-network/mcp2/src/widgets/src/hooks/useWidgetState.ts`

**Token Exchange:**
- ARCHITECTURE.md: Section 6 & Section 2 (extract_intent tool)
- ARCHITECTURE_QUICK_REFERENCE.md: Token Exchange Flow section
- CODE_PATTERNS.md: Section 2
- Source file:
  - `/Users/jahnik/index-network/mcp2/src/server/oauth/token.ts` (POST /token/privy/access-token)

**Configuration:**
- ARCHITECTURE.md: Section 8
- ARCHITECTURE_QUICK_REFERENCE.md: Configuration section
- CODE_PATTERNS.md: Section 10
- Source file:
  - `/Users/jahnik/index-network/mcp2/src/server/config.ts`

---

## Implementation Workflow

### To implement `discover_connections`:

1. **Plan** (30 min)
   - Read ARCHITECTURE.md Section 7 (Key Patterns)
   - Read ARCHITECTURE.md Section 2 (Extract Intent as template)
   - Plan Protocol API endpoint requirements

2. **Implement Tool** (1-2 hours)
   - Open CODE_PATTERNS.md Section 1 (Creating a New MCP Tool)
   - Create Zod schema
   - Implement handler function
   - Register tool in tools.ts

3. **Implement Widget** (1-2 hours)
   - Open CODE_PATTERNS.md Section 3 (Creating a New Widget)
   - Create React component
   - Create styles
   - Register widget in resources.ts

4. **Test** (1 hour)
   - Build widgets: `bun run build:widgets`
   - Start server: `bun run dev`
   - Test in ChatGPT with OAuth flow

---

## Key Concepts

### Token Exchange Flow
OAuth token (from ChatGPT) → POST /token/privy/access-token → Privy token → Protocol API

### Tool Response Format
```typescript
{
  content: [{ type: 'text'; text: string }];
  structuredContent: { /* data for widget */ };
  _meta: { /* metadata */ };
}
```

### Widget Data Access
`window.openai.toolOutput.structuredContent` contains the tool's `structuredContent`

### Required Scopes for Protocol API
Tools need `['read', 'privy:token:exchange']` scopes

---

## Additional Resources

- `.env.example` - Environment variable template
- `package.json` - Dependencies and build scripts
- `tsconfig.json` - TypeScript configuration
- Source files are in `/Users/jahnik/index-network/mcp2/src/`

---

## Document Versions

- ARCHITECTURE.md: 1172 lines, comprehensive reference
- ARCHITECTURE_QUICK_REFERENCE.md: 208 lines, quick lookup
- CODE_PATTERNS.md: 1380 lines, ready-to-use patterns
- DOCUMENTATION_INDEX.md: This file, navigation guide

Generated: November 18, 2025
