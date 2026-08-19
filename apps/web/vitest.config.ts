import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig's paths. Without this, any module importing '@/…'
      // is untestable — which had quietly put the hooks, the storage seam and
      // every component out of reach of the suite.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  // Next compiles JSX with the automatic runtime; vitest's esbuild defaults to
  // the classic one, which fails with "React is not defined" the moment a test
  // renders a component.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node', // Web Crypto (crypto.subtle) is available globally in Node 20+
    include: ['lib/**/*.test.ts'],
  },
});
