import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __EMBED__: 'false' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The full demo-world forge takes ~100 s; run it with `npm run test:slow`.
    exclude: process.env.SLOW ? [] : ['tests/**/*.slow.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
