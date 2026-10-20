import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { spacefast } from '@spacefast/vite-plugin';
import { apiPlugin } from './dev/apiPlugin.ts';

// The plugin stays in its default static mode: the SPA fallback is declared in sf.jsonc.
// Its 'spa' mode writes a `/* /index.html 200` rewrite into _redirects, and on Spacefast
// that rewrite runs before the functions router, so every /api route got index.html.
export default defineConfig({
  plugins: [preact(), spacefast(), apiPlugin()],
});
