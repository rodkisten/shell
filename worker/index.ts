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
type Env = { LINUX_ASSETS?: LinuxBucket };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
