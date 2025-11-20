/**
 * Type definitions for E2E auth tests
 */

export interface TestServerConfig {
  port: number;
  baseUrl: string;
}

export interface OAuthFlowParams {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  privyUserId?: string;
  privyToken?: string;
}

export interface OAuthFlowResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  code: string;
  authParams: OAuthFlowParams;
  privyTokenUsed: string;
  tokenType: string;
}

export interface MCPCallResult {
  status: number;
  body: any;
  headers: Record<string, string>;
}

export interface TokenRefreshResult {
  newAccessToken: string;
  newRefreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface DecodedJWT {
  sub: string;
  scope: string;
  aud: string;
  client_id: string;
  iss: string;
  exp: number;
  iat: number;
}

export interface FakePrivyUser {
  userId: string;
  appId: string;
  token: string;
  claims?: Record<string, any>;
}

export interface FakeProtocolAPIConfig {
  port: number;
  responses: Map<string, any>;
  errors: Map<string, { status: number; body: any }>;
  delays: Map<string, number>;
}

// Test context passed between tests
export interface TestContext {
  server: {
    baseUrl: string;
    port: number;
  };
  fakeProtocolApi: {
    baseUrl: string;
    port: number;
  };
}
