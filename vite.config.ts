import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { spacefast } from '@spacefast/vite-plugin';
import { apiPlugin } from './dev/apiPlugin.ts';

export default defineConfig({
  plugins: [preact(), spacefast({ mode: 'spa' }), apiPlugin()],
});
