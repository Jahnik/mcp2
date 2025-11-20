/**
 * Global setup for E2E auth tests
 * Runs once before all test files
 */

export default async function globalSetup() {
  console.log('\n[E2E Auth Tests] Global setup starting...');

  // Set up test environment
  process.env.NODE_ENV = 'test';

  console.log('[E2E Auth Tests] Global setup complete\n');
}
