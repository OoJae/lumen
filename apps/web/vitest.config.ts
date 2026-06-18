import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // Web Crypto (crypto.subtle) is available globally in Node 20+
    include: ['lib/**/*.test.ts'],
  },
});
