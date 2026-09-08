import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.ts'],
      exclude: ['shared/models.ts', 'shared/index.ts'],
    },
  },
});
