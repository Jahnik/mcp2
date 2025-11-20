/**
 * Tier 2 - Security Debt: Privy Token Exchange
 * Documents current behavior around Privy token storage and exchange
 *
 * NOTE: These tests document SECURITY DEBT, not desired behavior.
 * Stale/expired Privy tokens may be returned by the exchange endpoint.
 */

import { describe, it, expect } from 'vitest';
import {
  runFullOauthFlow,
  exchangeForPrivyToken,
  refreshTokens,
  getTestContext,
} from '../helpers/index.js';

describe.skip('Security: Privy Token Exchange (Tier 2 - Security Debt)', () => {
  describe('Stale Privy token handling', () => {
    it('returns stored Privy token without validating freshness', async () => {
      // The Privy token stored during authorization is returned as-is
      // There's no check that it's still valid/not expired
      const { accessToken, authParams } = await runFullOauthFlow();

      const result = await exchangeForPrivyToken(accessToken);

      // SECURITY DEBT: The stored token is returned without validation
      expect(result.privyAccessToken).toBe(authParams.privyToken);
    });

    it('preserves same Privy token through refresh cycles', async () => {
      // The original Privy token is carried forward through refreshes
      // Even if it becomes stale/expired
      const initial = await runFullOauthFlow();
      const initialPrivyToken = initial.authParams.privyToken;

      // Refresh several times
      let current = initial;
      for (let i = 0; i < 3; i++) {
        const refreshed = await refreshTokens(current.refreshToken);
        current = {
          ...current,
          accessToken: refreshed.newAccessToken,
          refreshToken: refreshed.newRefreshToken,
        };
      }

      // Exchange for Privy token
      const result = await exchangeForPrivyToken(current.accessToken);

      // SECURITY DEBT: Same Privy token as original
      expect(result.privyAccessToken).toBe(initialPrivyToken);
    });

    it('does not validate Privy token expiration on exchange', async () => {
      // We can't easily test this without mocking time
      // But we document the expected behavior

      const { accessToken, authParams } = await runFullOauthFlow();

      const result = await exchangeForPrivyToken(accessToken);

      // The endpoint returns the token regardless of its exp claim
      expect(result.privyAccessToken).toBeDefined();
    });
  });

  describe('Token storage concerns', () => {
    it('stores Privy tokens in-memory with access tokens', async () => {
      // This is implementation detail but relevant for security review
      // Tokens are stored in a Map in storage.ts

      const { accessToken } = await runFullOauthFlow();
      const result = await exchangeForPrivyToken(accessToken);

      // Token is retrievable
      expect(result.privyAccessToken).toBeDefined();
      expect(result.userId).toBeDefined();
    });

    it('Privy token persists until refresh token expires', async () => {
      // The Privy token lifecycle is tied to the refresh token
      // not to its own expiration

      const { refreshToken, authParams } = await runFullOauthFlow();
      const originalPrivyToken = authParams.privyToken;

      // Get new access token
      const refreshed = await refreshTokens(refreshToken);

      // Exchange new access token
      const result = await exchangeForPrivyToken(refreshed.newAccessToken);

      // Same Privy token
      expect(result.privyAccessToken).toBe(originalPrivyToken);
    });
  });

  describe('Expected security improvements', () => {
    it.todo('should validate Privy token expiration before returning');
    it.todo('should refresh Privy token if expired/stale');
    it.todo('should handle Privy token refresh failures gracefully');
    it.todo('should emit metrics/logs when stale tokens are used');
    it.todo('should consider shorter TTL for stored Privy tokens');
  });
});

describe.skip('Security: State Parameter Handling (Tier 2 - Security Debt)', () => {
  describe('State parameter passthrough', () => {
    it('passes state through without server-side validation', async () => {
      // State is passed from authorize to redirect without validation
      // This could be a CSRF concern

      const { runFullOauthFlow, getAuthorizationCode } = await import('../helpers/index.js');

      const customState = 'attacker-controlled-state';
      const { code } = await getAuthorizationCode({ state: customState });

      // State is accepted and passed through
      // SECURITY DEBT: No CSRF protection
      expect(code).toBeDefined();
    });

    it('accepts any state value including empty', async () => {
      const { getAuthorizationCode } = await import('../helpers/index.js');

      // Empty state
      const result = await getAuthorizationCode({ state: '' });
      expect(result.code).toBeDefined();
    });

    it('accepts very long state values', async () => {
      const { getAuthorizationCode } = await import('../helpers/index.js');

      // Very long state (could be used for data exfiltration)
      const longState = 'a'.repeat(10000);
      const result = await getAuthorizationCode({ state: longState });
      expect(result.code).toBeDefined();
    });
  });

  describe('Expected security improvements', () => {
    it.todo('should validate state against CSRF token');
    it.todo('should limit state parameter length');
    it.todo('should reject requests without state in production');
  });
});

describe.skip('Security: OIDC Discovery Mismatch (Tier 2 - Security Debt)', () => {
  describe('Discovery endpoint claims vs actual behavior', () => {
    it('advertises OIDC support but does not issue id_token', async () => {
      const { server } = getTestContext();

      // Fetch OIDC configuration
      const response = await fetch(`${server.baseUrl}/.well-known/openid-configuration`);
      const config = await response.json();

      // Check what's advertised
      // SECURITY DEBT: May claim OIDC support but not implement it
      expect(config.issuer).toBeDefined();

      // Get tokens
      const { runFullOauthFlow } = await import('../helpers/index.js');
      const result = await runFullOauthFlow();

      // Verify no id_token is returned
      // An OIDC-compliant implementation should return one
      // @ts-ignore - we're checking that this doesn't exist
      expect(result.id_token).toBeUndefined();
    });
  });

  describe('Expected improvements', () => {
    it.todo('should either implement id_token or remove OIDC claims from discovery');
    it.todo('should return proper id_token with OIDC claims');
  });
});
