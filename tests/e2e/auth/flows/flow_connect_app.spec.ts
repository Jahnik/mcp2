/**
 * Tier 0 - Happy Path: Connect App Flow
 * Tests the complete OAuth flow from authorization to token issuance
 */

import { describe, it, expect } from 'vitest';
import {
  runFullOauthFlow,
  decodeAccessToken,
  getTestContext,
} from '../helpers/index.js';

describe('Flow: Connect App via OAuth + Privy', () => {
  it('completes full OAuth flow and issues valid tokens', async () => {
    // Run the complete flow
    const result = await runFullOauthFlow({
      scope: 'read',
    });

    // Verify authorization code was returned
    expect(result.code).toBeDefined();
    expect(result.code).toHaveLength(64); // 32 bytes hex-encoded

    // Verify token response structure
    expect(result.tokenType).toBe('Bearer');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.expiresIn).toBeLessThanOrEqual(3600); // Max 1 hour

    // Decode and verify access token claims
    const decoded = decodeAccessToken(result.accessToken);
    const { server } = getTestContext();

    // Subject should be the Privy DID
    expect(decoded.sub).toBe(result.authParams.privyUserId);

    // Audience should be the server base URL
    expect(decoded.aud).toBe(server.baseUrl);

    // Issuer should be the server base URL
    expect(decoded.iss).toBe(server.baseUrl);

    // Scope should contain requested scope plus privy:token:exchange
    expect(decoded.scope).toContain('read');
    expect(decoded.scope).toContain('privy:token:exchange');

    // Client ID should be present
    expect(decoded.client_id).toBe(result.authParams.clientId);

    // Token should not be expired
    const now = Math.floor(Date.now() / 1000);
    expect(decoded.exp).toBeGreaterThan(now);
    expect(decoded.iat).toBeLessThanOrEqual(now);
  });

  it('includes privy:token:exchange scope even if not requested', async () => {
    const result = await runFullOauthFlow({
      scope: 'read write', // Not requesting privy:token:exchange
    });

    // Verify the scope was auto-added
    expect(result.scope).toContain('privy:token:exchange');

    const decoded = decodeAccessToken(result.accessToken);
    expect(decoded.scope).toContain('privy:token:exchange');
  });

  it('filters invalid scopes and includes only valid ones', async () => {
    const result = await runFullOauthFlow({
      scope: 'read invalid-scope-xyz write',
    });

    // Should have read and write, but not the invalid scope
    expect(result.scope).toContain('read');
    expect(result.scope).toContain('write');
    expect(result.scope).not.toContain('invalid-scope-xyz');
  });

  it('defaults to read scope when none specified', async () => {
    const result = await runFullOauthFlow({
      scope: '',
    });

    // Should have read scope by default
    expect(result.scope).toContain('read');
    expect(result.scope).toContain('privy:token:exchange');
  });

  it('generates unique authorization codes for each request', async () => {
    const result1 = await runFullOauthFlow();
    const result2 = await runFullOauthFlow();

    // Codes should be different
    expect(result1.code).not.toBe(result2.code);

    // Tokens should be different
    expect(result1.accessToken).not.toBe(result2.accessToken);
    expect(result1.refreshToken).not.toBe(result2.refreshToken);
  });

  it('generates different tokens for different users', async () => {
    const result1 = await runFullOauthFlow({
      privyUserId: 'did:privy:user-1',
    });
    const result2 = await runFullOauthFlow({
      privyUserId: 'did:privy:user-2',
    });

    // Tokens should be different
    expect(result1.accessToken).not.toBe(result2.accessToken);

    // Decoded tokens should have different subjects
    const decoded1 = decodeAccessToken(result1.accessToken);
    const decoded2 = decodeAccessToken(result2.accessToken);

    expect(decoded1.sub).toBe('did:privy:user-1');
    expect(decoded2.sub).toBe('did:privy:user-2');
  });

  it('returns state parameter in redirect URL', async () => {
    const customState = 'my-custom-state-123';
    const result = await runFullOauthFlow({
      state: customState,
    });

    // State should be preserved
    expect(result.authParams.state).toBe(customState);
  });

  it('uses correct redirect URI for ChatGPT', async () => {
    // Test with chatgpt.com redirect URI
    const result = await runFullOauthFlow({
      redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.authParams.redirectUri).toBe('https://chatgpt.com/connector_platform_oauth_redirect');
  });

  it('supports both ChatGPT redirect URIs', async () => {
    // Test with chat.openai.com redirect URI
    const result1 = await runFullOauthFlow({
      redirectUri: 'https://chat.openai.com/connector_platform_oauth_redirect',
    });
    expect(result1.accessToken).toBeDefined();

    // Test with chatgpt.com redirect URI
    const result2 = await runFullOauthFlow({
      redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    });
    expect(result2.accessToken).toBeDefined();
  });
});
