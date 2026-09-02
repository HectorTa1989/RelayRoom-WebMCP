import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'evals/**/*.test.ts'],
    environment: 'node',
    coverage: { reporter: ['text', 'html'] },
  },
});
