import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // @ig-harness/{ig-sdk,shared} ship main=dist/index.js but dist may not
      // exist in the worktree; point Vitest directly at the TS sources so
      // tests resolve without a build step.
      '@ig-harness/ig-sdk': path.resolve(__dirname, '../../packages/ig-sdk/src/index.ts'),
      '@ig-harness/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
