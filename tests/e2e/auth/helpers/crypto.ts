/**
 * Cryptographic utilities for E2E auth tests
 * PKCE code verifier/challenge generation, JWT decoding
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Generate a cryptographically secure random string for PKCE code_verifier
 * RFC 7636 specifies: 43-128 characters from unreserved URI characters
 */
export function generateCodeVerifier(length: number = 43): string {
  const buffer = randomBytes(Math.ceil((length * 3) / 4));
  return base64UrlEncode(buffer).slice(0, length);
}

/**
 * Generate code_challenge from code_verifier using S256 method
 * RFC 7636: code_challenge = BASE64URL(SHA256(code_verifier))
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256').update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Generate a complete PKCE pair (verifier + challenge)
 */
export function generatePKCEPair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/**
 * Base64URL encode a buffer (RFC 4648)
 */
function base64UrlEncode(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decode a JWT without verification (for test assertions)
 * WARNING: This does NOT verify signatures - only use for testing
 */
export function decodeJWT(token: string): {
  header: Record<string, any>;
  payload: Record<string, any>;
  signature: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signature] = parts;

  const header = JSON.parse(base64UrlDecode(headerB64));
  const payload = JSON.parse(base64UrlDecode(payloadB64));

  return { header, payload, signature };
}

/**
 * Base64URL decode a string
 */
function base64UrlDecode(str: string): string {
  // Add padding if necessary
  let padded = str;
  const padding = 4 - (str.length % 4);
  if (padding !== 4) {
    padded += '='.repeat(padding);
  }

  // Convert base64url to base64
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Generate a random state parameter for OAuth
 */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a fake Privy token for testing
 * This creates a JWT-like structure that our fake Privy verifier will accept
 */
export function generateFakePrivyToken(userId: string, appId: string = 'test-app'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    aud: appId,
    iss: 'privy.io',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signature = base64UrlEncode(randomBytes(32)); // Fake signature

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Generate an expired fake Privy token for testing
 */
export function generateExpiredPrivyToken(userId: string, appId: string = 'test-app'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    aud: appId,
    iss: 'privy.io',
    exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    iat: Math.floor(Date.now() / 1000) - 7200, // Issued 2 hours ago
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signature = base64UrlEncode(randomBytes(32));

  return `${headerB64}.${payloadB64}.${signature}`;
}
