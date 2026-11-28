import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
const origin = process.env.MODULE_ORIGIN,
  sha = process.env.MODULE_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/);
assert.ok(origin && new URL(origin).origin === origin);
async function get(path, type, method = 'GET') {
  const response = await fetch(origin + path, {
    method,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, path + ' HTTP');
  assert.match(response.headers.get('content-type') || '', type, path + ' MIME');
  assert.equal(response.headers.get('access-control-allow-origin'), '*', path + ' CORS');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin', path + ' CORP');
  return response;
}
let business, lastError;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const response = await get('/workflow/rod-module.json', /application\/json/);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    business = await response.json();
    assert.equal(business.gitSha, sha);
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
if (lastError) throw lastError;
const prefix = `/modules/code/${sha}/`;
assert.equal(business.id, 'code');
assert.equal(business.name, 'rod_code');
assert.equal(business.contractMajor, 1);
assert.equal(business.entry, origin + prefix + 'mf-manifest.json');
assert.equal(business.standaloneUrl, origin + '/workflow/');
const federation = await (await get(prefix + 'mf-manifest.json', /application\/json/)).json();
assert.equal(federation.metaData.publicPath, origin + prefix);
assert.equal(federation.metaData.remoteEntry.type, 'module');
assert.ok(federation.exposes.some((item) => item.path === './App'));
const entry = await get(prefix + 'remoteEntry.js', /javascript/, 'HEAD');
assert.match(entry.headers.get('cache-control') || '', /immutable/);
const files = (await readdir('dist/client' + prefix + 'assets')).filter((name) => /\.(?:js|css)$/.test(name));
for (const file of files)
  await get(prefix + 'assets/' + file, file.endsWith('.css') ? /text\/css/ : /javascript/, 'HEAD');
const standalone = await fetch(origin + '/workflow/', { redirect: 'error', signal: AbortSignal.timeout(15000) });
assert.equal(standalone.status, 200);
assert.match(await standalone.text(), /Workflow Studio/);
console.log(
  `Verified Code ${sha}: standalone, business/federation manifests, ESM entry, ${files.length} chunks, CORS/CORP, MIME and immutable cache (${origin})`,
);
