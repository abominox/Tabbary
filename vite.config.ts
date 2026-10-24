import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': new URL('src', import.meta.url).pathname,
    },
  },
  build: {
    target: 'chrome116',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: [
        'popup.html',
        'index.html',
        'window.html',
        'onboarding.html',
        'sidepanel.html',
        'options.html',
        'offscreen.html',
        'tags.html',
        'bookmarks.html',
      ],
    },
  },
});