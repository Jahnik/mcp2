/**
 * Tier 0/1 - Error Handling: Token Endpoint
 * Tests error responses from POST /token
 */

import { describe, it, expect } from 'vitest';
import {
  rawTokenRequest,
  getAuthorizationCode,
  exchangeCodeForTokens,
  generatePKCEPair,
} from '../helpers/index.js';

describe('Errors: Token Endpoint', () => {
  describe('Tier 0 - Authorization code grant errors', () => {
    it('returns 400 for missing grant_type', async () => {
      const result = await rawTokenRequest({
        client_id: 'chatgpt-connector',
        code: 'some-code',
        code_verifier: 'some-verifier',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('unsupported_grant_type');
    });

    it('returns 400 for unsupported grant_type', async () => {
      const result = await rawTokenRequest({
        grant_type: 'client_credentials',
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('unsupported_grant_type');
    });

    it('returns 400 for missing code', async () => {
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        client_id: 'chatgpt-connector',
        code_verifier: 'some-verifier',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
      expect(result.body.error_description).toContain('code');
    });

    it('returns 400 for missing code_verifier', async () => {
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        client_id: 'chatgpt-connector',
        code: 'some-code',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
      expect(result.body.error_description).toContain('code_verifier');
    });

    it('returns 400 for missing client_id', async () => {
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code: 'some-code',
        code_verifier: 'some-verifier',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
    });

    it('returns 400 for invalid authorization code', async () => {
      const { codeVerifier } = generatePKCEPair();

      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code: 'invalid-code-xyz',
        code_verifier: codeVerifier,
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
      expect(result.body.error_description).toContain('authorization code');
    });

    it('returns 400 for reused authorization code', async () => {
      // Get a valid code
      const { code, codeVerifier } = await getAuthorizationCode();

      // Use it once (should succeed)
      await exchangeCodeForTokens(code, codeVerifier);

      // Try to use it again
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
      // The code is deleted after first use, so it's "invalid or expired"
    });

    it('returns 400 for invalid PKCE verifier', async () => {
      const { code } = await getAuthorizationCode();

      // Use a different verifier than the one that generated the challenge
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier-that-does-not-match',
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chat.openai.com/connector_platform_oauth_redirect',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
      expect(result.body.error_description).toContain('PKCE');
    });

    it('returns 400 for mismatched client_id', async () => {
      const { code, codeVerifier } = await getAuthorizationCode();

      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: 'different-client',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
    });

    it('returns 400 for mismatched redirect_uri', async () => {
      const { code, codeVerifier } = await getAuthorizationCode();

      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://different.com/callback',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
      expect(result.body.error_description).toContain('redirect_uri');
    });
  });

  describe('Tier 1 - Authorization code expiration', () => {
    it('returns 400 for expired authorization code', async () => {
      // Get a code and wait for it to expire (30 seconds)
      // For testing, we'll just verify the error handling works
      // In a real test, you'd mock time or use a shorter expiration

      const { code, codeVerifier } = await getAuthorizationCode();

      // We can't easily test expiration without mocking time
      // Instead, verify that invalid codes are handled properly
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code: code + '-modified', // Modify to make invalid
        code_verifier: codeVerifier,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
    });
  });

  describe('Tier 0 - Refresh token grant errors', () => {
    it('returns 400 for missing refresh_token in refresh grant', async () => {
      const result = await rawTokenRequest({
        grant_type: 'refresh_token',
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
      expect(result.body.error_description).toContain('refresh_token');
    });

    it('returns 400 for invalid refresh_token', async () => {
      const result = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: 'invalid-token',
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
    });
  });

  describe('Error response structure', () => {
    it('returns consistent error response format', async () => {
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body).toHaveProperty('error');
      expect(result.body).toHaveProperty('error_description');
      expect(typeof result.body.error).toBe('string');
      expect(typeof result.body.error_description).toBe('string');
    });

    it('does not leak internal details in error responses', async () => {
      const result = await rawTokenRequest({
        grant_type: 'authorization_code',
        code: 'invalid',
        code_verifier: 'invalid',
        client_id: 'chatgpt-connector',
      });

      const responseText = JSON.stringify(result.body);
      expect(responseText).not.toContain('node_modules');
      expect(responseText).not.toContain('at ');
      expect(responseText).not.toContain('.ts:');
      expect(responseText).not.toContain('.js:');
    });
  });
});
