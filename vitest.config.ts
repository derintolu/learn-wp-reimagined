import { defineConfig } from 'vitest/config';
import { vendorRedirectsVite } from './scripts/vendor-shims.ts';

export default defineConfig({
  plugins: [vendorRedirectsVite()],
  test: { setupFiles: ['tests/setup-fetch.ts'], include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
});
