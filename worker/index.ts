declare const __SHELL_BUILD__: { sha: string; builtAt: string; environment: string };

// Only API routes reach this Worker. Cloudflare serves the SPA and assets directly.

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=1200' },
  });
}
async function getFromMankier(target: string, acceptJson = true) {
  const response = await fetch(target, {
    headers: { 'Accept': acceptJson ? 'application/json' : 'text/plain' },
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error('Manual externo indisponível (' + response.status + ')');
  return response;
}
async function manPage(name: string) {
  if (!/^[a-z0-9][a-z0-9_.+-]{0,49}$/i.test(name)) return json({ error: 'Nome inválido' }, 400);
  for (const section of ['1', '8', '7']) {
    try {
      const r = await getFromMankier('https://www.mankier.com/api/v2/mans/' + encodeURIComponent(name) + '.' + section);
      const page = (await r.json()) as { sections?: Array<{ id: string }>; [key: string]: unknown };
      if (!page || !page.name) continue;
      const selected = (page.sections || []).filter((s) => /^(synopsis|description|examples)$/i.test(s.id)).slice(0, 3);
      const parts = await Promise.all(selected.map(async (s) => {
        try {
          const res = await getFromMankier('https://www.mankier.com/api/v2/mans/' + encodeURIComponent(name) + '.' + section + '/sections/' + encodeURIComponent(s.id));
          const data = (await res.json()) as { html?: string; title?: string };
          return { title: data.title || s.id, html: (data.html || '').slice(0, 30000) };
        } catch { return { title: s.id, html: '' }; }
      }));
      return json({ ...page, content: parts });
    } catch { /* try a different section */ }
  }
  return json({ error: 'Man page não encontrada' }, 404);
}

type LinuxBucket = {
  get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }): Promise<{
    body: ReadableStream; size: number; httpEtag: string;
    range?: { offset: number; length: number };
    writeHttpMetadata(headers: Headers): void;
  } | null>;
};
type Env = { LINUX_ASSETS?: LinuxBucket; EITA_PREVIEWS?: LinuxBucket; ASSETS: { fetch(request: Request): Promise<Response> } };
const linuxAssets = new Set(['libv86.js', 'v86.wasm', 'seabios.bin', 'vgabios.bin', 'alpine.iso']);

async function linuxAsset(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const filename = new URL(request.url).pathname.slice('/v86/'.length);
  if (!linuxAssets.has(filename)) return new Response('Not found', { status: 404 });
  if (!env.LINUX_ASSETS) return new Response('Linux R2 bucket not configured', { status: 503 });
  const rangeHeader = request.headers.get('Range');
  let range: { offset?: number; length?: number; suffix?: number } | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return new Response(null, { status: 416 });
      range = { suffix };
    }
    else {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : undefined;
      if (!Number.isSafeInteger(start) || (end !== undefined && (!Number.isSafeInteger(end) || end < start))) return new Response(null, { status: 416 });
      range = end === undefined ? { offset: start } : { offset: start, length: end - start + 1 };
    }
  }
  const key = 'v86/' + filename;
  const object = await env.LINUX_ASSETS.get(key, range ? { range } : undefined);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');
  const contentType: Record<string, string> = {
    'libv86.js': 'text/javascript; charset=utf-8',
    'v86.wasm': 'application/wasm',
    'alpine.iso': 'application/octet-stream',
    'seabios.bin': 'application/octet-stream',
    'vgabios.bin': 'application/octet-stream',
  };
  headers.set('Content-Type', contentType[filename]);
  // R2 returns the original object size and the actual bounded interval.
  let start = 0;
  let length = object.size;
  if (range) {
    if (object.range) {
      start = object.range.offset;
      length = object.range.length;
    } else if (range.suffix !== undefined) {
      length = Math.min(range.suffix, object.size);
      start = object.size - length;
    } else {
      start = range.offset ?? 0;
      length = Math.min(range.length ?? object.size, Math.max(0, object.size - start));
    }
    if (!length || start >= object.size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + object.size } });
    headers.set('Content-Range', 'bytes ' + start + '-' + (start + length - 1) + '/' + object.size);
  }
  headers.set('Content-Length', String(length));
  return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
}


// Small bootstrap script lives in codespaces; releases carry the immutable ZIP.
// Never fetch release assets in the Worker: the client verifies GitHub's SHA256.
async function debianInstaller(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const match = /^\/debian\/installer(?:\/(v?[0-9]+\.[0-9]+\.[0-9]+))?\/?$/.exec(path);
  if (!match) return new Response('Invalid installer version', { status: 404 });
  const version = match[1] ?? 'latest';
  const source = 'https://raw.githubusercontent.com/rodkisten/codespaces/main/debian/release-installer.sh';
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return new Response('Installer source unavailable', { status: 502 });
    const body = await response.text();
    if (!body.startsWith('#!/usr/bin/env bash') || !body.includes('__ROD_VERSION__')) {
      return new Response('Installer source invalid', { status: 502 });
    }
    return new Response(request.method === 'HEAD' ? null : body.replace('VERSION="__ROD_VERSION__"', 'VERSION="' + version + '"'), {
      status: 200,
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Content-Disposition': 'inline; filename="rod-debian-installer.sh"',
        'Cache-Control': version === 'latest' ? 'public, max-age=60' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Installer source unavailable', { status: 502 });
  }
}


// Preview artifacts are immutable within an upload, but the PR pointer moves.
// The worker never executes uploaded scripts and never falls back to SPA HTML.
async function eitaPreview(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  if (!env.EITA_PREVIEWS) return new Response('Preview storage unavailable', { status: 503 });
  const path = new URL(request.url).pathname;
  const match = /^\/install\/eita\/(pr\/([1-9][0-9]*)|preview)(?:\/(artifact|checksum|manifest.json))?\/?$/.exec(path);
  if (!match) return new Response('Unknown Eita preview route', { status: 404 });
  const prefix = match[2] ? 'pr/' + match[2] : 'preview';
  const target = match[3] ?? 'installer';
  const archive = 'eita-x86_64-unknown-linux-gnu.tar.gz';
  const key = prefix + '/' + (target === 'artifact' ? archive : target === 'checksum' ? archive + '.sha256' : 'manifest.json');
  const object = await env.EITA_PREVIEWS.get(key);
  if (!object) return new Response('Preview artifact not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (target === 'installer') {
    const manifest = await new Response(object.body).json() as { sha256?: string };
    if (!manifest.sha256 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return new Response('Invalid preview manifest', { status: 502 });
    const base = path.replace(/\/$/, '');
    const script = [
      '#!/bin/sh', 'set -eu',
      'tmp="$(mktemp -d)"',
      'trap \'rm -rf "$tmp"\' EXIT',
      'curl -fsSL ' + JSON.stringify('https://shell.migos.club' + base + '/artifact') + ' -o "$tmp/eita.tar.gz"',
      'printf "%s  %s\\n" ' + JSON.stringify(manifest.sha256) + ' "$tmp/eita.tar.gz" | sha256sum -c -',
      'mkdir -p "$HOME/.local/bin"',
      'tar -xzf "$tmp/eita.tar.gz" -C "$tmp" ./eita',
      'install -m 0755 "$tmp/eita" "$HOME/.local/bin/eita"',
      'printf "Eita preview installed to %s\\n" "$HOME/.local/bin/eita"',
      '',
    ].join('\n');
    return new Response(request.method === 'HEAD' ? null : script, { headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', target === 'artifact' ? 'application/gzip' : target === 'checksum' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/workflow' || url.pathname === '/workflow/' || (url.pathname.startsWith('/workflow/') && !url.pathname.startsWith('/workflow/assets/') && !url.pathname.split('/').at(-1)?.includes('.'))) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      return env.ASSETS.fetch(new Request(new URL('/workflow/index.html', url), request));
    }
    if (url.pathname.startsWith('/workflow/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/debian' || url.pathname === '/debian/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      // Return the SPA entrypoint, preserving the browser URL for React Router.
      const indexUrl = new URL('/index.html', url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }
    if (url.pathname.startsWith('/debian/')) return debianInstaller(request, url.pathname);
    if (url.pathname.startsWith('/install/eita/')) return eitaPreview(request, env);
    if (url.pathname === '/install' || url.pathname.startsWith('/install/')) {
      return new Response('Installer artifact not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname.startsWith('/v86/')) return linuxAsset(request, env);
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return json({ error: 'Método não permitido' }, 405);
      if (url.pathname === '/api/version') {
        return new Response(JSON.stringify(__SHELL_BUILD__), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      if (url.pathname.startsWith('/api/man/')) return manPage(decodeURIComponent(url.pathname.slice('/api/man/'.length)));
      if (url.pathname === '/api/explain') {
        const line = (url.searchParams.get('q') || '').slice(0, 1200);
        if (!line.trim()) return json({ explanation: '' });
        try {
          const data = await getFromMankier('https://www.mankier.com/api/v2/explain/?cols=90&q=' + encodeURIComponent(line), false);
          return json({ explanation: (await data.text()).slice(0, 12000) });
        } catch { return json({ error: 'Explicação remota indisponível' }, 502); }
      }
      return json({ error: 'Rota não encontrada' }, 404);
    }
    // Non-API paths are handled by Cloudflare Static Assets, not this Worker.
    return json({ error: 'Rota não encontrada' }, 404);
  },
};
