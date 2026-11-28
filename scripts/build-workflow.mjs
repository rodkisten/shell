import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const sha = process.env.MODULE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const origin = process.env.MODULE_ORIGIN || 'https://shell.migos.club';
if (!/^[a-f0-9]{40}$/.test(sha) || new URL(origin).origin !== origin) throw Error('Invalid module build context');
function pnpm(args) {
  execFileSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, MODULE_SHA: sha, MODULE_ORIGIN: origin },
  });
}
pnpm(['--filter', '@code/workflow-core', 'build']);
pnpm(['--filter', '@code/workflow-core', 'test']);
pnpm(['--filter', '@code/workflow-studio', 'typecheck']);
pnpm(['--filter', '@code/workflow', 'typecheck']);
pnpm(['--filter', '@code/workflow', 'build']);
pnpm(['--filter', '@code/workflow', 'exec', 'vite', 'build', '--mode', 'federation']);
const html = await readFile('apps/workflow/dist/index.html', 'utf8');
if (!html.includes('Workflow Studio') || !html.includes('/workflow/assets/'))
  throw Error('Invalid Workflow Studio build');
const shellHtml = await readFile('dist/client/index.html', 'utf8');
if (!shellHtml.includes('<html')) throw Error('Shell client entrypoint missing');
await rm('dist/client/workflow', { recursive: true, force: true });
await cp('apps/workflow/dist', 'dist/client/workflow', { recursive: true });
const path = `/modules/code/${sha}/`;
await mkdir(`dist/client${path}`, { recursive: true });
await cp('apps/workflow/dist-module', `dist/client${path}`, { recursive: true });
const manifest = {
  schemaVersion: 1,
  id: 'code',
  name: 'rod_code',
  version: '0.2.0',
  gitSha: sha,
  contractMajor: 1,
  entry: origin + path + 'mf-manifest.json',
  standaloneUrl: origin + '/workflow/',
  exposes: ['./App'],
  capabilities: ['workflow.edit', 'workflow.parse', 'registry.read'],
};
await writeFile(`dist/client${path}rod-module.json`, JSON.stringify(manifest, null, 2));
await writeFile('dist/client/workflow/rod-module.json', JSON.stringify(manifest, null, 2));
console.log(`Staged standalone /workflow/ and immutable Code module ${sha} (${origin})`);
