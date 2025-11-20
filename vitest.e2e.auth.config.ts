import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use Node environment for server-side testing
    environment: 'node',

    // Test file patterns
    include: ['tests/e2e/auth/**/*.spec.ts'],

    // Global test timeout - auth flows can take time
    testTimeout: 30000,

    // Hook timeout for server startup/teardown
    hookTimeout: 15000,

    // Run tests sequentially by default for auth flows
    // Can be overridden per file with test.concurrent
    sequence: {
      concurrent: false,
    },

    // Setup file for global test configuration
    setupFiles: ['tests/e2e/auth/helpers/setup.ts'],

    // Global teardown
    globalSetup: 'tests/e2e/auth/helpers/global-setup.ts',

    // Reporter configuration
    reporters: ['verbose'],

    // Retry failed tests once (useful for timing-sensitive auth tests)
    retry: 1,

    // Pool configuration
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in single fork to share server instance
      },
    },
  },

  // Resolve TypeScript paths
  resolve: {
    alias: {
      '@server': '/src/server',
    },
  },
});
