import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        // Next.js framework files — exercised by build/e2e, not unit tests.
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
        // Thin singletons / framework glue with no logic of our own.
        'src/lib/db.ts',
        'src/lib/inngest.ts',
        'src/middleware.ts',
        // Generated / config-style.
        'src/db/schema.ts',
        'src/db/migrations/**',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
