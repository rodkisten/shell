import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';
import { execFileSync } from 'node:child_process';
export default defineConfig(({ mode }) => {
  const remote = mode === 'federation';
  const sha = process.env.MODULE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const origin = process.env.MODULE_ORIGIN || 'https://shell.migos.club';
  if (!/^[a-f0-9]{40}$/.test(sha) || new URL(origin).origin !== origin)
    throw Error('Invalid Code module build context');
  return {
    base: remote ? `${origin}/modules/code/${sha}/` : '/workflow/',
    plugins: [
      react(),
      tailwind(),
      ...(remote
        ? [
            federation({
              name: 'rod_code',
              filename: 'remoteEntry.js',
              manifest: true,
              exposes: { './App': './src/remote.tsx' },
              shared: {
                react: { singleton: true, requiredVersion: '^19.2.4', strictVersion: true },
                'react-dom': { singleton: true, requiredVersion: '^19.2.4', strictVersion: true },
              },
              dts: false,
            }),
          ]
        : []),
    ],
    preview: { cors: true, port: 4175 },
    build: { target: 'es2022', outDir: remote ? 'dist-module' : 'dist' },
  };
});
