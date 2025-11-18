/**
 * Test setup file - runs before each test file
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { startTestServer, stopTestServer, getTestServer } from './server-bootstrap.js';
import { startFakeProtocolAPI, stopFakeProtocolAPI, resetRoutes } from './fake-protocol-api.js';
import { resetFakePrivy } from './fake-privy.js';

// Shared test context
export const testContext = {
  server: {
    baseUrl: '',
    port: 0,
  },
  fakeProtocolApi: {
    baseUrl: '',
    port: 0,
  },
};

// Start servers before all tests
beforeAll(async () => {
  console.log('\n[Test Setup] Starting test infrastructure...');

  // Start fake Protocol API first
  const protocolApi = await startFakeProtocolAPI();
  testContext.fakeProtocolApi = {
    baseUrl: protocolApi.baseUrl,
    port: protocolApi.port,
  };

  // Start test server
  const server = await startTestServer({
    protocolApiUrl: protocolApi.baseUrl,
  });
  testContext.server = {
    baseUrl: server.baseUrl,
    port: server.port,
  };

  console.log('[Test Setup] Test infrastructure ready');
  console.log(`  - Test Server: ${server.baseUrl}`);
  console.log(`  - Fake Protocol API: ${protocolApi.baseUrl}\n`);
}, 30000);

// Clean up after all tests
afterAll(async () => {
  console.log('\n[Test Setup] Shutting down test infrastructure...');

  await stopTestServer();
  await stopFakeProtocolAPI();

  console.log('[Test Setup] Test infrastructure stopped\n');
}, 15000);

// Reset mocks before each test
beforeEach(() => {
  resetFakePrivy();
  resetRoutes();
});

// Export context getter
export function getTestContext() {
  return testContext;
}
