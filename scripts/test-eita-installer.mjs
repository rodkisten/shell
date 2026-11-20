import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const workerSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(workerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const worker = (await import('data:text/javascript;base64,' + Buffer.from(transpiled).toString('base64'))).default;
const upstreamScript = '#!/bin/sh\nrelease="§{EITA_VERSION:-latest}"\necho installed\n'.replaceAll('§', '$');
const priorFetch = globalThis.fetch;
let upstreamCalls = [];

test.before(() => {
  globalThis.fetch = async (url) => {
    upstreamCalls.push(url);
    return new Response(upstreamScript, { status: 200 });
  };
});
test.after(() => { globalThis.fetch = priorFetch; });

function request(path, method = 'GET') {
  return worker.fetch(new Request('https://shell.migos.club' + path, { method }), {
    ASSETS: { fetch: async () => new Response('SPA') },
  });
}

test('stable short installer uses official main source without version override', async () => {
  upstreamCalls = [];
  const response = await request('/install/eita');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), upstreamScript);
  assert.match(response.headers.get('content-type'), /shellscript/);
  assert.deepEqual(upstreamCalls, ['https://raw.githubusercontent.com/rodkisten/eita/main/install.sh']);
});

test('PR installer keeps stable path and pins the preview tag', async () => {
  const response = await request('/install/eita/pr/2');
  assert.equal(response.status, 200);
  const script = await response.text();
  assert.match(script, /^#!\/bin\/sh\nEITA_VERSION=pr-2\nexport EITA_VERSION\n/);
  assert.ok(script.endsWith(upstreamScript));
});

test('versioned installer accepts only strict commit tag', async () => {
  const response = await request('/install/eita/main-0123456789ab');
  assert.match(await response.text(), /EITA_VERSION=main-0123456789ab/);
});

test('HEAD is supported without returning a body', async () => {
  const response = await request('/install/eita/pr/25', 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('unknown apps and unsafe path tokens fail closed', async () => {
  const cases = ['/install/opa', '/install/eita/pr/0', '/install/eita/pr/2;rm',
    '/install/eita/main-abcdef', '/install/eita/pr/2/garbage'];
  for (const item of cases) {
    const response = await request(item);
    assert.equal(response.status, 404, item);
  }
});

test('rejects unsafe methods', async () => {
  const response = await request('/install/eita', 'POST');
  assert.equal(response.status, 405);
});

test('returns a gateway error if upstream is invalid', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>not a shell script</html>', { status: 200 });
  try {
    const response = await request('/install/eita/pr/2');
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = old;
  }
});

test('short artifact URL redirects to the GitHub prerelease archive', async () => {
  const response = await request('/install/eita/pr/3/artifact');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'),
    'https://github.com/rodkisten/eita/releases/download/pr-3/eita-x86_64-unknown-linux-gnu.tar.gz');
});

test('stable checksum and target-specific archives use allowlisted URLs', async () => {
  const checksum = await request('/install/eita/checksum');
  assert.equal(checksum.status, 302);
  assert.equal(checksum.headers.get('location'),
    'https://github.com/rodkisten/eita/releases/latest/download/eita-x86_64-unknown-linux-gnu.tar.gz.sha256');
  const arm = await request('/install/eita/pr/3/artifact?target=aarch64-unknown-linux-gnu');
  assert.equal(arm.status, 302);
  assert.match(arm.headers.get('location'), /eita-aarch64-unknown-linux-gnu\.tar\.gz$/);
  const unsafe = await request('/install/eita/pr/3/artifact?target=../../evil');
  assert.equal(unsafe.status, 400);
});
