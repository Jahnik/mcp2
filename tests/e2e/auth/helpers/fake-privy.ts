/**
 * Fake Privy client for E2E testing
 * Intercepts PrivyClient.verifyAuthToken() calls and returns controlled responses
 */

import type { FakePrivyUser } from './types.js';

// Registry of valid test tokens
const validTokens = new Map<string, FakePrivyUser>();
const invalidTokens = new Set<string>();
let shouldFailAll = false;
let failureError: Error | null = null;

/**
 * Register a valid test token with the fake Privy
 */
export function registerValidToken(token: string, user: FakePrivyUser): void {
  validTokens.set(token, user);
}

/**
 * Register a token that should fail verification
 */
export function registerInvalidToken(token: string): void {
  invalidTokens.add(token);
}

/**
 * Set all verifications to fail (simulates Privy outage)
 */
export function setAllVerificationsToFail(error?: Error): void {
  shouldFailAll = true;
  failureError = error || new Error('Privy service unavailable');
}

/**
 * Reset the fake Privy to default state
 */
export function resetFakePrivy(): void {
  validTokens.clear();
  invalidTokens.clear();
  shouldFailAll = false;
  failureError = null;
}

/**
 * Get a registered user by token
 */
export function getRegisteredUser(token: string): FakePrivyUser | undefined {
  return validTokens.get(token);
}

/**
 * Fake verifyAuthToken implementation
 * This replaces the real PrivyClient.verifyAuthToken()
 */
export async function fakeVerifyAuthToken(token: string): Promise<{
  userId: string;
  appId: string;
  [key: string]: any;
}> {
  // Simulate some async behavior
  await new Promise(resolve => setTimeout(resolve, 10));

  // Check if all verifications should fail
  if (shouldFailAll) {
    throw failureError || new Error('Privy service unavailable');
  }

  // Check if token is explicitly invalid
  if (invalidTokens.has(token)) {
    throw new Error('Invalid Privy token');
  }

  // Look up the token in the registry
  const user = validTokens.get(token);
  if (!user) {
    throw new Error('Token not found or expired');
  }

  // Return the user claims
  return {
    userId: user.userId,
    appId: user.appId,
    ...user.claims,
  };
}

/**
 * Create a fake PrivyClient instance for injection
 */
export function createFakePrivyClient(): {
  verifyAuthToken: typeof fakeVerifyAuthToken;
} {
  return {
    verifyAuthToken: fakeVerifyAuthToken,
  };
}

/**
 * Helper to set up a standard test user
 */
export function setupTestUser(userId: string = 'did:privy:test-user-123'): {
  token: string;
  userId: string;
  appId: string;
} {
  const token = `test-privy-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const appId = 'test-app-id';

  registerValidToken(token, {
    userId,
    appId,
    token,
  });

  return { token, userId, appId };
}
