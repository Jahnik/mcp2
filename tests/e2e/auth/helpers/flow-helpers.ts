/**
 * Flow helper functions for E2E auth tests
 * Reusable functions for running OAuth flows and making authenticated requests
 */

import type { OAuthFlowParams, OAuthFlowResult, MCPCallResult, TokenRefreshResult } from './types.js';
import { generatePKCEPair, generateState, decodeJWT } from './crypto.js';
import { registerValidToken, setupTestUser } from './fake-privy.js';
import { getTestContext } from './setup.js';

// Default OAuth client for ChatGPT
const DEFAULT_CLIENT_ID = 'chatgpt-connector';
const DEFAULT_REDIRECT_URIS = [
  'https://chat.openai.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector_platform_oauth_redirect',
];

/**
 * Run a complete OAuth flow from authorization to token exchange
 */
export async function runFullOauthFlow(options: {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  privyUserId?: string;
  skipPrivySetup?: boolean;
} = {}): Promise<OAuthFlowResult> {
  const { server } = getTestContext();

  // Set up parameters
  const clientId = options.clientId || DEFAULT_CLIENT_ID;
  const redirectUri = options.redirectUri || DEFAULT_REDIRECT_URIS[0];
  const scope = options.scope || 'read';
  const state = options.state || generateState();
  const { codeVerifier, codeChallenge } = generatePKCEPair();

  // Set up test user with Privy
  let privyUserId = options.privyUserId || `did:privy:test-user-${Date.now()}`;
  let privyToken: string;

  if (!options.skipPrivySetup) {
    const testUser = setupTestUser(privyUserId);
    privyToken = testUser.token;
    privyUserId = testUser.userId;
  } else {
    // Generate a token but don't register it (for testing invalid tokens)
    privyToken = `unregistered-token-${Date.now()}`;
  }

  // Step 1: POST /authorize/complete to get authorization code
  const authorizeResponse = await fetch(`${server.baseUrl}/authorize/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      privy_token: privyToken,
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }),
  });

  if (!authorizeResponse.ok) {
    const error = await authorizeResponse.json();
    throw new Error(`Authorization failed: ${JSON.stringify(error)}`);
  }

  const authorizeData = await authorizeResponse.json();
  const code = authorizeData.code;

  // Step 2: POST /token to exchange code for tokens
  const tokenResponse = await fetch(`${server.baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.json();
    throw new Error(`Token exchange failed: ${JSON.stringify(error)}`);
  }

  const tokenData = await tokenResponse.json();

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    scope: tokenData.scope,
    code,
    authParams: {
      clientId,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      privyUserId,
      privyToken,
    },
    privyTokenUsed: privyToken,
    tokenType: tokenData.token_type,
  };
}

/**
 * Call an MCP tool with an access token
 */
export async function callMcpWithAccessToken(
  accessToken: string,
  toolName: string,
  params: Record<string, any>
): Promise<MCPCallResult> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params,
      },
      id: `test-${Date.now()}`,
    }),
  });

  const body = await response.json();

  return {
    status: response.status,
    body,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * Refresh tokens using a refresh token
 */
export async function refreshTokens(
  refreshToken: string,
  clientId: string = DEFAULT_CLIENT_ID
): Promise<TokenRefreshResult> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token refresh failed: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  return {
    newAccessToken: data.access_token,
    newRefreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/**
 * Exchange OAuth access token for Privy token
 */
export async function exchangeForPrivyToken(accessToken: string): Promise<{
  privyAccessToken: string;
  userId: string;
  expiresAt: number;
}> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/token/privy/access-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Privy token exchange failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

/**
 * Get authorization code without exchanging for tokens
 */
export async function getAuthorizationCode(options: {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  privyUserId?: string;
  privyToken?: string;
} = {}): Promise<{
  code: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}> {
  const { server } = getTestContext();

  const clientId = options.clientId || DEFAULT_CLIENT_ID;
  const redirectUri = options.redirectUri || DEFAULT_REDIRECT_URIS[0];
  const scope = options.scope || 'read';
  const state = options.state || generateState();
  const { codeVerifier, codeChallenge } = generatePKCEPair();

  // Set up test user if not provided
  let privyToken = options.privyToken;
  let privyUserId = options.privyUserId;

  if (!privyToken) {
    const testUser = setupTestUser(privyUserId);
    privyToken = testUser.token;
    privyUserId = testUser.userId;
  }

  const response = await fetch(`${server.baseUrl}/authorize/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      privy_token: privyToken,
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Authorization failed: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  return {
    code: data.code,
    redirectUri: data.redirect_uri,
    state: data.state || state,
    codeVerifier,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  options: {
    clientId?: string;
    redirectUri?: string;
  } = {}
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: options.clientId || DEFAULT_CLIENT_ID,
      redirect_uri: options.redirectUri || DEFAULT_REDIRECT_URIS[0],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Token exchange failed: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/**
 * Make a raw request to the token endpoint (for error testing)
 */
export async function rawTokenRequest(body: Record<string, any>): Promise<{
  status: number;
  body: any;
}> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * Make a raw request to the authorize/complete endpoint (for error testing)
 */
export async function rawAuthorizeRequest(body: Record<string, any>): Promise<{
  status: number;
  body: any;
}> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/authorize/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

/**
 * Make a raw MCP request (for error testing)
 */
export async function rawMcpRequest(
  body: Record<string, any>,
  headers: Record<string, string> = {}
): Promise<MCPCallResult> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json(),
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * Introspect a token
 */
export async function introspectToken(token: string): Promise<{
  active: boolean;
  sub?: string;
  scope?: string;
  client_id?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string;
}> {
  const { server } = getTestContext();

  const response = await fetch(`${server.baseUrl}/token/introspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  return response.json();
}

/**
 * Decode and return JWT payload for assertions
 */
export function decodeAccessToken(accessToken: string): {
  sub: string;
  scope: string;
  aud: string;
  client_id: string;
  iss: string;
  exp: number;
  iat: number;
} {
  const { payload } = decodeJWT(accessToken);
  return payload as any;
}
