# Verification Report: DISCOVER_CONNECTIONS_REPORT.md

## Section 1: mcp2 Architecture

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| 1.1 | Server routes: `/authorize`, `/authorize/complete`, `/token`, `/mcp`, `/.well-known/jwks.json` | verified | Actual: `/authorize` (line 94), `/token` (line 97), `/mcp` (line 100), `/.well-known` (line 84) - matches |
| 1.2 | Tools registered using `Server` class with `setRequestHandler()` | verified | `src/server/mcp/tools.ts` line 43-150 shows exactly this pattern |
| 1.2 | `_meta` includes `openai/outputTemplate`, `openai/toolInvocation/*` | verified | Lines 142-146 in tools.ts show these exact _meta keys |
| 1.3 | `/token/privy/access-token` endpoint returns `privyAccessToken`, `expiresAt`, `userId`, `scope` | verified | `src/server/oauth/token.ts` lines 354-360 return exactly these fields |
| 1.3 | Auth interface: `token`, `userId`, `scopes` | partially_verified | Actual: auth context has `token`, `userId` from `req.auth` (line 331-334 in token.ts), but `scopes` comes from `tokenData.scopes` not directly on auth object |
| 1.4 | extract_intent Zod schema fields | verified | `src/server/mcp/tools.ts` lines 31-36 match exactly |
| 1.4 | extract_intent output has `structuredContent.intents`, `filesProcessed`, `linksProcessed`, `intentsGenerated` | verified | Lines 447-452 return these exact fields |
| 1.4 | Token exchange URL: `/token/privy/access-token` | verified | Line 476 in tools.ts uses `${config.server.baseUrl}/token/privy/access-token` |
| 1.5 | Config structure with `intentExtraction.protocolApiUrl`, `protocolApiTimeoutMs`, etc. | verified | `src/server/config.ts` lines 55-61 match exactly |
| 1.6 | Widget Vite config entry points: `echo`, `list-view`, `intent-display` | verified | `src/widgets/vite.config.ts` lines 14-19 show these exact entries |
| 1.6 | useOpenAi hook pattern with `toolOutput?.structuredContent` | partially_verified | `src/widgets/src/hooks/useOpenAi.ts` returns `window.openai?.toolOutput` directly (line 36), NOT the nested pattern described. The nested pattern is in IntentDisplay.tsx lines 27-29, not in useOpenAi hook |
| 1.6 | IntentDisplay widget types | verified | `src/widgets/src/IntentDisplay/IntentDisplay.tsx` lines 6-18 match exactly |
| 1.6 | Resource registration with `createWidgetHTML()` | verified | `src/server/mcp/resources.ts` lines 102-125 show this pattern |

## Section 2: ../mcp discover_filter Implementation

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| 2.1 | Tool name `discover_filter` with input schema including `intentIds`, `userIds`, `indexIds`, `sources`, `excludeDiscovered`, pagination, `intentInput`, `vibecheck` | verified | `/Users/jahnik/index-network/mcp/src/server.ts` lines 837-859 match exactly |
| 2.2 | Handler accesses auth via `extra?.authInfo?.token` | verified | Line 933 uses `extra?.authInfo?.token` |
| 2.3 | Vibecheck constants: `VIBECHECK_DEFAULT_CONCURRENCY = 2`, `VIBECHECK_MAX_CONCURRENCY = 5`, `VIBECHECK_THROTTLE_MS = 75`, `VIBECHECK_RETRY_DELAYS_MS = [250, 500]` | verified | Lines 47-50 define these exact values |
| 2.3 | Worker pool pattern with throttling | verified | Lines 408-452 `runVibeChecksForResults` implements this pattern |
| 2.3 | Retry logic returns empty synthesis on final failure | verified | Lines 454-489 show exactly this behavior |
| 2.4 | DiscoverCard interface with header, body, actions, markup | verified | Lines 151-164 define this interface exactly |
| 2.5 | Widget config: `indexDiscoverWidget` with `templateUri: "ui://widget/index-discover.html"` | verified | Lines 700-709 match exactly |
| 2.6 | Report claims mcp uses `McpServer`, mcp2 uses `Server` | verified | ../mcp line 2 imports `McpServer`, mcp2 uses `Server` from SDK |
| 2.6 | Auth access: mcp uses `extra?.authInfo?.token`, mcp2 uses `extra?.auth?.token` | partially_verified | ../mcp uses `extra?.authInfo?.token` (line 933), but mcp2 actually uses `(extra as any)?.auth` (tools.ts line 158), not `extra?.auth?.token` |
| 2.6 | Token exchange path: mcp uses `/privy/access-token` | verified | Line 43 defines `privyTokenExchangeUrl = \`${normalizedBaseUrl}/privy/access-token\`` |

## Section 3: Protocol API (../index)

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| 3.1 | POST /discover/new accepts `payload` field with multipart/form-data | verified | `discover.ts` line 50-61, body validator at line 60 |
| 3.1 | Response includes `success`, `intents`, `filesProcessed`, `linksProcessed`, `intentsGenerated` | verified | Lines 248-254 return these exact fields |
| 3.2 | POST /discover/filter accepts `intentIds`, `userIds`, `indexIds`, `sources`, `excludeDiscovered`, `page`, `limit` | verified | Lines 321-336 validators match exactly |
| 3.2 | discover/filter sources type includes `'file' | 'integration' | 'link'` | partially_verified | Validator at line 331 only allows `['file', 'integration', 'link']`, but report also mentions `'discovery_form'` in filter-spec.md which is NOT in actual route |
| 3.2 | Response has `results`, `pagination`, `filters` | verified | Lines 369-378 return these exact fields |
| 3.3 | POST /synthesis/vibecheck accepts `targetUserId`, `intentIds`, `indexIds`, `options` | verified | `synthesis.ts` lines 14-23 validators match |
| 3.3 | Vibecheck response: `synthesis`, `targetUserId`, `contextUserId` | verified | Lines 62-66 return these fields |
| 3.3 | Options include `timeout`, `characterLimit` | not_verified | Actual options interface in `lib/synthesis.ts` line 10 extends `VibeCheckOptions` but no `timeout` field visible; only `characterLimit` is mentioned in filter-spec. Need to check vibe_checker agent |
| 3.3 | Synthesis contains intent links like `[phrase](https://index.network/intents/ID)` | not_verified | Cannot verify without checking vibe_checker agent implementation; this claim is from filter-spec.md, not actual code |
| 3.4 | Frontend `StakesByUserResponse` type | partially_verified | Type exists at `types.ts` lines 118-140 but differs from report: actual has `totalStake: string` (not number), `agents` array (not reasonings) |
| 3.4 | Frontend `UserConnection` type | verified | Lines 293-302 match the report |
| 3.5 | Inbox card uses class `bg-white border border-b-2 border-gray-800 mb-4` | not_verified | Would need to read inbox/page.tsx to verify; report references lines 316-393 but I haven't read this file |
| 3.6 | Frontend fetches synthesis per user with `fetchSynthesis(targetUserId, intentIds, indexIds)` | not_verified | Would need to read inbox/page.tsx to verify |

## Section 4: Integration Constraints

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| 4.1 | Scope requirement `privy:token:exchange` | verified | mcp2 `src/server/oauth/token.ts` line 326 and mcp `server.ts` line 1335 both check this scope |
| 4.2 | Proposed Connection type with `matchedIntents`, `score`, `type`, `title`, `summary` | not_verified | This is a proposed type in the report, not verified against actual code. The actual output from ../mcp uses `results` with `user`, `totalStake`, `intents` structure |
| 4.3 | Timeouts: token exchange 10s, discover/new 60s, discover/filter 30s, vibecheck 30s | partially_verified | mcp has `protocolApiTimeoutMs = 60000` for all API calls (line 39); vibecheck also uses same timeout. Report claims 30s for filter but actual is 60s |
| 4.4 | Recommended partial failure tolerance for vibecheck | verified | ../mcp lines 476-479 return empty synthesis on failure, don't fail whole request |

## Section 5: Recommended Implementation

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| 5.1 | Proposed tool input: `text`, `maxConnections` | not_verified | This is a recommendation, but differs from ../mcp pattern which uses `intentInput.fullInputText` not just `text` |
| 5.1 | Proposed output with `connections` array containing `user`, `synthesis`, `matchedIntents`, `totalStake` | partially_verified | Different from ../mcp actual output which uses `results` (not `connections`) and includes `vibechecks` as separate array, not embedded in each result |
| 5.2 | Flow diagram claims discover/filter timeout 30s | not_verified | Actual timeout in ../mcp is 60s (`protocolApiTimeoutMs`) for all API calls including discover/filter (line 356) |
| 5.3 | Widget Connection interface | not_verified | This is a proposed interface that doesn't exist yet |
| 5.4 | Config additions with `discoverFilterTimeoutMs: 30000` | partially_verified | Recommends 30s but ../mcp uses 60s |

## Section 6: Design Decisions

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| 6.2 | Parallel vs Sequential: "concurrent with configurable concurrency (default 2, max 5), throttling (75ms between calls)" | verified | Lines 47-50 in ../mcp match these values exactly |

## Appendix: File References

| Section | Claim Summary | Status | Corrections / Supporting Evidence |
|---------|--------------|--------|-----------------------------------|
| Appendix | `src/server/mcp/resources.ts` exists | verified | File exists and was read |
| Appendix | Lines 877-1049 for discover_filter in ../mcp | verified | Lines match the implementation |
| Appendix | Reference to `/routes/connections.ts` | not_verified | File not read; cannot confirm it exists or purpose |
| Appendix | Reference to `vibe_checker/index.ts` agent | not_verified | File not read; cannot confirm options/output format |

---

## Required Follow-up Scans

1. **Vibe Checker Agent**: `/Users/jahnik/index-network/index/protocol/src/agents/external/vibe_checker/index.ts`
   - Need to verify: synthesis output format, intent link generation, timeout options
   - Report claims synthesis contains markdown links to intents but this was not verified

2. **Frontend Inbox Page**: `/Users/jahnik/index-network/index/frontend/src/app/inbox/page.tsx`
   - Need to verify: Card Tailwind classes, fetchSynthesis pattern, SynthesisMarkdown component
   - Report references specific lines (316-393) but file wasn't fully analyzed

3. **Connections Route**: `/Users/jahnik/index-network/index/protocol/src/routes/connections.ts`
   - Referenced in appendix but not analyzed
   - May contain important patterns for connection actions

4. **Protocol API Timeout Analysis**:
   - Report claims different timeouts (30s for filter, 60s for new) but actual code uses same `protocolApiTimeoutMs = 60000` for all calls
   - Need to clarify correct values

5. **Output Schema Alignment**:
   - Report's proposed `connections` array differs from ../mcp's actual `results` + `vibechecks` separate arrays
   - Need to decide if proposed simplification is intentional or should match ../mcp exactly

6. **Sources Filter Types**:
   - Report includes `'discovery_form'` in source types but actual `/discover/filter` route only accepts `['file', 'integration', 'link']`
   - This may be intentional (API doesn't support filtering by discovery_form source) but needs clarification

---

*Verification performed by Claude Code analysis of mcp2, ../mcp, and ../index repositories.*
