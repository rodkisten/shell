import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// The SHA comes from the checked-out source, not a potentially stale CI variable.
const sourceSha = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
})();
const buildInfo = {
  sha: sourceSha,
  builtAt: new Date().toISOString(),
  environment: process.env.CF_PAGES_BRANCH ? 'cloudflare' : process.env.CI ? 'ci' : 'local',
};

export default defineConfig({
  define: { __SHELL_BUILD__: JSON.stringify(buildInfo) },
  plugins: [react(), tailwindcss(), cloudflare({ viteEnvironment: { name: 'worker' } })],
  build: { target: 'es2022', cssCodeSplit: true, sourcemap: true },
  // WASI and shell workers import split chunks, which IIFE bundles cannot load.
  worker: { format: 'es' },
  server: { host: '0.0.0.0' },
});
