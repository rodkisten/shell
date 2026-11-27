import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {federation} from '@module-federation/vite';
import {execFileSync} from 'node:child_process';
export default defineConfig({
 base:process.env.SHELL_REMOTE_BASE || '/shell-remote/',
 define:{__SHELL_BUILD__:JSON.stringify({sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),builtAt:new Date().toISOString(),environment:'federation'})},
 plugins:[react(),tailwind(),federation({name:'code_shell',filename:'remoteEntry.js',manifest:true,exposes:{'./Shell':'./src/remote.tsx'},shared:{react:{singleton:true},'react-dom':{singleton:true}}})],
 worker:{format:'es'},build:{target:'esnext',outDir:'dist-federation',rollupOptions:{input:'src/remote.tsx'}}
});
