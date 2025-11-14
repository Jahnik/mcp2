/**
 * MCP HTTP Request Handlers
 * Integrates the MCP server with Express HTTP endpoints
 */

import { Router, Request, Response } from 'express';
import { getMCPServer } from './server.js';
import { validateToken } from '../middleware/auth.js';

export const mcpRouter = Router();

/**
 * POST /mcp
 * Main MCP endpoint for JSON-RPC requests
 * Requires OAuth authentication
 */
mcpRouter.post('/', validateToken(['read']), async (req: Request, res: Response) => {
  try {
    const mcpServer = getMCPServer();
    const request = req.body;

    // Log incoming request
    console.log('[MCP] Incoming request:', JSON.stringify({
      method: request.method,
      params: request.params,
      id: request.id
    }));

    // Pass auth context to MCP handlers
    const extra = {
      auth: req.auth,
    };

    // Handle the MCP request
    const response = await handleMCPRequest(mcpServer, request, extra);

    // Log response
    console.log('[MCP] Response:', JSON.stringify({
      result: response.result ? 'present' : 'missing',
      error: response.error,
      id: response.id
    }));

    res.json(response);
  } catch (error) {
    console.error('MCP request error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error',
      },
      id: req.body.id || null,
    });
  }
});

/**
 * GET /mcp
 * Server-Sent Events endpoint for streaming (optional)
 */
mcpRouter.get('/', validateToken(['read']), async (req: Request, res: Response) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Clean up on close
  req.on('close', () => {
    clearInterval(heartbeat);
    res.end();
  });
});

/**
 * Handle MCP JSON-RPC request
 */
async function handleMCPRequest(server: any, request: any, extra: any) {
  const { method, params, id } = request;

  try {
    const handler = server._requestHandlers.get(method);
    if (!handler) {
      throw new Error(`Unknown method: ${method}`);
    }

    const normalizedRequest =
      typeof params === 'undefined' ? { method } : { method, params };

    const result = await handler(normalizedRequest, extra);

    return {
      jsonrpc: '2.0',
      result,
      id: typeof id === 'undefined' ? null : id,
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      id,
    };
  }
}
