interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }

const headers: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return json({ error: 'Método não permitido' }, 405);
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
    const asset = await env.ASSETS.fetch(request);
    const resultHeaders = new Headers(asset.headers);
    Object.entries(headers).forEach(([key, value]) => resultHeaders.set(key, value));
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: resultHeaders });
  },
};
