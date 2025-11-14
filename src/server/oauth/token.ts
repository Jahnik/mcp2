/**
 * OAuth2 Token Endpoint
 * Exchanges authorization codes for access tokens
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import {
  getAuthorizationCode,
  deleteAuthorizationCode,
  validatePKCE,
  storeRefreshToken,
  getRefreshToken,
  deleteRefreshToken,
  getToken,
  storeToken,
} from './storage.js';
import { validateToken } from '../middleware/auth.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const tokenRouter = Router();

tokenRouter.post('/', async (req, res) => {
  try {
    const {
      grant_type,
      client_id,
    } = req.body;

    if (!client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter: client_id',
      });
    }

    if (grant_type === 'authorization_code') {
      return handleAuthorizationCodeGrant(req, res);
    }

    if (grant_type === 'refresh_token') {
      return handleRefreshTokenGrant(req, res);
    }

    // Unsupported grant type
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `Unsupported grant_type: ${grant_type}`,
    });
  } catch (error) {
    console.error('Token endpoint error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred while generating the access token',
    });
  }
});

async function handleAuthorizationCodeGrant(req: Request, res: Response) {
  const {
    code,
    code_verifier,
    client_id,
    redirect_uri,
    resource,
  } = req.body;

  if (!code || !code_verifier) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: code and code_verifier',
    });
  }

  // Retrieve authorization code
  const authCode = getAuthorizationCode(code);
  if (!authCode) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired authorization code',
    });
  }

  // Check if code has already been used
  if (authCode.used) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has already been used',
    });
  }

  // Check if code has expired
  if (authCode.expiresAt < Date.now()) {
    deleteAuthorizationCode(code);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has expired',
    });
  }

  // Validate client_id
  if (authCode.clientId !== client_id) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid client_id',
    });
  }

  // Validate redirect_uri if provided
  if (redirect_uri && authCode.redirectUri !== redirect_uri) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'redirect_uri does not match',
    });
  }

  // Validate PKCE code_verifier
  if (!validatePKCE(code_verifier, authCode.codeChallenge)) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid code_verifier (PKCE validation failed)',
    });
  }

  // Delete the authorization code (single use only)
  deleteAuthorizationCode(code);

  const audience = resource || config.server.baseUrl;

  const { accessToken, privyToken, expiresIn } = issueAccessToken({
    privyUserId: authCode.privyUserId,
    privyToken: authCode.privyToken,  // Pass through the Privy token
    scopes: authCode.scopes,
    clientId: client_id,
    audience,
  });

  // Store the access token with associated Privy token
  storeToken(accessToken, {
    clientId: client_id,
    privyUserId: authCode.privyUserId,
    privyToken,
    scopes: authCode.scopes,
    expiresAt: Date.now() + (expiresIn * 1000),
  });

  const refreshToken = storeRefreshToken({
    clientId: client_id,
    privyUserId: authCode.privyUserId,
    privyToken: authCode.privyToken,  // Store for refresh token flow
    scopes: authCode.scopes,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: authCode.scopes.join(' '),
  });
}

async function handleRefreshTokenGrant(req: Request, res: Response) {
  const { refresh_token, client_id, resource } = req.body;

  if (!refresh_token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameter: refresh_token',
    });
  }

  const storedRefreshToken = getRefreshToken(refresh_token);
  if (!storedRefreshToken) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid refresh_token',
    });
  }

  if (storedRefreshToken.clientId !== client_id) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Client mismatch for refresh_token',
    });
  }

  if (storedRefreshToken.expiresAt < Date.now()) {
    deleteRefreshToken(refresh_token);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'refresh_token has expired',
    });
  }

  // Rotate refresh token
  deleteRefreshToken(refresh_token);
  const newRefreshToken = storeRefreshToken({
    clientId: storedRefreshToken.clientId,
    privyUserId: storedRefreshToken.privyUserId,
    privyToken: storedRefreshToken.privyToken,  // Carry forward the Privy token
    scopes: storedRefreshToken.scopes,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  const audience = resource || config.server.baseUrl;
  const { accessToken, privyToken, expiresIn } = issueAccessToken({
    privyUserId: storedRefreshToken.privyUserId,
    privyToken: storedRefreshToken.privyToken,  // Pass through the Privy token
    scopes: storedRefreshToken.scopes,
    clientId: storedRefreshToken.clientId,
    audience,
  });

  // Store the new access token with associated Privy token
  storeToken(accessToken, {
    clientId: storedRefreshToken.clientId,
    privyUserId: storedRefreshToken.privyUserId,
    privyToken,
    scopes: storedRefreshToken.scopes,
    expiresAt: Date.now() + (expiresIn * 1000),
  });

  return res.json({
    access_token: accessToken,
    refresh_token: newRefreshToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: storedRefreshToken.scopes.join(' '),
  });
}

function issueAccessToken({
  privyUserId,
  privyToken,
  scopes,
  clientId,
  audience,
}: {
  privyUserId: string;
  privyToken: string;
  scopes: string[];
  clientId: string;
  audience: string;
}) {
  const accessToken = jwt.sign(
    {
      sub: privyUserId,
      scope: scopes.join(' '),
      aud: audience,
      client_id: clientId,
    },
    config.jwt.privateKey,
    {
      algorithm: config.jwt.algorithm,
      expiresIn: config.jwt.expiresIn,
      issuer: config.jwt.issuer,
      keyid: 'key-1',
    }
  );

  const expiresInSeconds =
    typeof config.jwt.expiresIn === 'string'
      ? 3600
      : Math.floor((config.jwt.expiresIn as number) / 1000);

  return {
    accessToken,
    privyToken,  // Return so we can store it
    expiresIn: expiresInSeconds,
  };
}

/**
 * Token introspection endpoint (optional, for debugging)
 */
tokenRouter.post('/introspect', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        active: false,
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
    }) as jwt.JwtPayload;

    // Return token info
    res.json({
      active: true,
      sub: decoded.sub,
      scope: decoded.scope,
      client_id: decoded.client_id,
      exp: decoded.exp,
      iat: decoded.iat,
      iss: decoded.iss,
      aud: decoded.aud,
    });
  } catch (error) {
    // Token is invalid or expired
    res.json({
      active: false,
    });
  }
});

/**
 * Privy Token Exchange Endpoint
 *
 * Used by MCP tools to exchange their OAuth access token for the original Privy token
 * that was provided during the authorization flow. This allows tools to call the Protocol API.
 *
 * Following the ../mcp pattern:
 * 1. Validates the OAuth access token and checks for 'privy:token:exchange' scope
 * 2. Looks up the stored token record to find the associated Privy token
 * 3. Returns the Privy token with metadata
 */
tokenRouter.post('/privy/access-token', validateToken(['privy:token:exchange']), async (req, res) => {
  try {
    console.log('[privy/access-token] Received exchange request');

    // The validateToken middleware has already verified the token and attached req.auth
    const oauthToken = req.auth?.token;
    console.log('[privy/access-token] OAuth token from auth:', oauthToken ? `${oauthToken.slice(0, 8)}...${oauthToken.slice(-8)}` : 'MISSING');
    console.log('[privy/access-token] Required scopes:', req.auth?.scopes);

    if (!oauthToken) {
      console.error('[privy/access-token] No OAuth token in request');
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Look up the stored token data to get the Privy token
    const tokenData = getToken(oauthToken);
    console.log('[privy/access-token] Token lookup result:', tokenData ? 'FOUND' : 'NOT FOUND');

    if (!tokenData) {
      console.error('[privy/access-token] Token not found in storage');
      return res.status(404).json({ error: 'token_not_found' });
    }

    // Log for debugging (only show preview of token)
    const preview = `${tokenData.privyToken.slice(0, 4)}...${tokenData.privyToken.slice(-4)}`;
    console.log('[privy/access-token] Exchanging token for Privy bearer', preview);

    // Return the Privy token with metadata
    return res.json({
      privyAccessToken: tokenData.privyToken,
      expiresAt: tokenData.expiresAt,
      issuedAt: null,  // We don't track issuedAt separately
      userId: tokenData.privyUserId,
      scope: tokenData.scopes,
    });
  } catch (error) {
    console.error('[privy/access-token] Error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to exchange token',
    });
  }
});
