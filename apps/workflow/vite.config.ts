import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
  base: process.env.WORKFLOW_BASE_URL || '/workflow/',
  plugins: [react(), tailwind(), federation({
    name: 'code_workflow',
    filename: 'remoteEntry.js',
    manifest: true,
    exposes: { './WorkflowStudio': './src/remote.tsx' },
    shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
  })],
  build: { target: 'esnext' },
});
