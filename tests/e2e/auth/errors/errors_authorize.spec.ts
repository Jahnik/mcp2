/**
 * Tier 0/1 - Error Handling: Authorization Endpoint
 * Tests error responses from /authorize and /authorize/complete
 */

import { describe, it, expect } from 'vitest';
import {
  rawAuthorizeRequest,
  setupTestUser,
  registerInvalidToken,
  generatePKCEPair,
  generateState,
  getTestContext,
} from '../helpers/index.js';

describe('Errors: Authorization Endpoint', () => {
  describe('Tier 0 - Basic error responses', () => {
    it('returns 400 for missing state parameter', async () => {
      const { token } = setupTestUser();
      const { codeChallenge } = generatePKCEPair();

      const result = await rawAuthorizeRequest({
        privy_token: token,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Missing state
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
      expect(result.body.error_description).toContain('state');
    });

    it('returns 400 for missing privy_token', async () => {
      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Missing privy_token
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
    });

    it('returns 400 for missing client_id', async () => {
      const { token } = setupTestUser();
      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: token,
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Missing client_id
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
    });

    it('returns 400 for missing redirect_uri', async () => {
      const { token } = setupTestUser();
      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: token,
        client_id: 'chatgpt-connector',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Missing redirect_uri
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
    });

    it('returns 400 for missing code_challenge', async () => {
      const { token } = setupTestUser();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: token,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge_method: 'S256',
        // Missing code_challenge
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
    });

    it('returns 401 for invalid Privy token', async () => {
      const invalidToken = 'invalid-privy-token-xyz';
      registerInvalidToken(invalidToken);

      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: invalidToken,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      expect(result.status).toBe(401);
      expect(result.body.error).toBe('invalid_token');
    });
  });

  describe('Tier 1 - Client and redirect validation', () => {
    it('returns 400 for unknown client_id', async () => {
      const { token } = setupTestUser();
      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: token,
        client_id: 'unknown-client-xyz',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_client');
    });

    it('returns 400 for invalid redirect_uri', async () => {
      const { token } = setupTestUser();
      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: token,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://evil.com/steal-code',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_client');
    });

    it('returns 400 for unsupported code_challenge_method', async () => {
      const { token } = setupTestUser();
      const { codeChallenge } = generatePKCEPair();
      const state = generateState();

      const result = await rawAuthorizeRequest({
        state,
        privy_token: token,
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: 'read',
        code_challenge: codeChallenge,
        code_challenge_method: 'plain', // Not supported
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
      expect(result.body.error_description).toContain('S256');
    });
  });

  describe('Error response structure', () => {
    it('returns consistent error response format', async () => {
      const result = await rawAuthorizeRequest({});

      expect(result.status).toBe(400);
      expect(result.body).toHaveProperty('error');
      expect(result.body).toHaveProperty('error_description');
      expect(typeof result.body.error).toBe('string');
      expect(typeof result.body.error_description).toBe('string');
    });

    it('does not leak internal details in error responses', async () => {
      const result = await rawAuthorizeRequest({
        state: 'test',
        privy_token: 'invalid',
        client_id: 'chatgpt-connector',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        code_challenge: 'test',
        code_challenge_method: 'S256',
      });

      // Should not contain stack traces or internal paths
      const responseText = JSON.stringify(result.body);
      expect(responseText).not.toContain('node_modules');
      expect(responseText).not.toContain('at ');
      expect(responseText).not.toContain('.ts:');
      expect(responseText).not.toContain('.js:');
    });
  });
});
