import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['tests/setup-fetch.ts'], include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
});
