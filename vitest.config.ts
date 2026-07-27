import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*/test/**/*.test.ts', 'verification/checks/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'verification/fixtures/**'],
    // Los casos de fallo lanzan dependency-cruiser y ESLint como procesos aparte.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
