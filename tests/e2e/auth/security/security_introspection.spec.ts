/**
 * Tier 2 - Security Debt: Token Introspection
 * Documents current behavior of the unprotected introspection endpoint
 *
 * NOTE: These tests document SECURITY DEBT, not desired behavior.
 * The introspection endpoint is currently unprotected (no authentication required).
 */

import { describe, it, expect } from 'vitest';
import {
  runFullOauthFlow,
  introspectToken,
  getTestContext,
} from '../helpers/index.js';

describe.skip('Security: Token Introspection (Tier 2 - Security Debt)', () => {
  describe('Unprotected introspection endpoint', () => {
    it('allows unauthenticated introspection of valid tokens', async () => {
      // Get a valid token
      const { accessToken, authParams } = await runFullOauthFlow();

      // Introspect without any authentication
      const result = await introspectToken(accessToken);

      // SECURITY DEBT: This should require authentication
      // Currently it returns full token details to anyone
      expect(result.active).toBe(true);
      expect(result.sub).toBe(authParams.privyUserId);
      expect(result.scope).toBeDefined();
      expect(result.client_id).toBeDefined();
    });

    it('exposes token claims to unauthenticated callers', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await introspectToken(accessToken);

      // These claims are exposed without authentication
      expect(result.sub).toBeDefined();
      expect(result.aud).toBeDefined();
      expect(result.iss).toBeDefined();
      expect(result.exp).toBeDefined();
      expect(result.iat).toBeDefined();
    });

    it('returns active=false for invalid tokens', async () => {
      const result = await introspectToken('invalid-token');

      // At least invalid tokens are handled properly
      expect(result.active).toBe(false);
    });

    it('returns active=false for malformed tokens', async () => {
      const result = await introspectToken('not.a.jwt');

      expect(result.active).toBe(false);
    });
  });

  describe('Introspection information disclosure', () => {
    it('reveals user identity (sub claim) to anyone', async () => {
      const { accessToken, authParams } = await runFullOauthFlow({
        privyUserId: 'did:privy:sensitive-user-id',
      });

      const result = await introspectToken(accessToken);

      // SECURITY DEBT: User identity is exposed
      expect(result.sub).toBe('did:privy:sensitive-user-id');
    });

    it('reveals scopes to anyone', async () => {
      const { accessToken } = await runFullOauthFlow({
        scope: 'read write profile',
      });

      const result = await introspectToken(accessToken);

      // SECURITY DEBT: Scopes are exposed
      expect(result.scope).toContain('read');
      expect(result.scope).toContain('write');
      expect(result.scope).toContain('profile');
    });

    it('reveals client_id to anyone', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await introspectToken(accessToken);

      // SECURITY DEBT: Client ID is exposed
      expect(result.client_id).toBe('chatgpt-connector');
    });

    it('reveals token expiration to anyone', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await introspectToken(accessToken);

      // SECURITY DEBT: Expiration is exposed
      // This could help attackers know when to retry
      expect(result.exp).toBeDefined();
      expect(typeof result.exp).toBe('number');
    });
  });

  describe('Expected security improvements', () => {
    // These tests document what SHOULD happen but doesn't yet

    it.todo('should require authentication to introspect tokens');
    it.todo('should only allow the token owner to introspect their own token');
    it.todo('should allow authorized resource servers to introspect');
    it.todo('should rate limit introspection requests');
    it.todo('should log introspection attempts for audit');
  });
});
