import { useEffect, useState } from 'react';
import { ExternalLink, BookOpen, Copy, LoaderCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { byName } from '../lib/commands';

type ManData = {
  name: string;
  description: string;
  url: string;
  content?: { title: string; html: string }[];
  anchors?: { anchor: string; description: string }[];
};
const clean = (value = '') => {
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

export function ManPopover({ command, onClose, onInsert }: {
  command: string | null; onClose(): void; onInsert(text: string): void;
}) {
  const [page, setPage] = useState<ManData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const local = command ? byName.get(command) : null;

  useEffect(() => {
    if (!command) return;
    const controller = new AbortController();
    setPage(null); setError(''); setLoading(true);
    fetch('/api/man/' + encodeURIComponent(command), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Manual não encontrado.');
        return await response.json() as ManData;
      })
      .then(setPage)
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message || 'Sem conexão com a man page.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [command]);

  return (
    <Popover open={!!command} onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverTrigger asChild>
        <button type="button" className="manual-anchor" aria-label="Referência do comando atual">
          <BookOpen size={15} /> {command || 'Manual'}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="manual-popover">
        <div className="manual-head">
          <div><span className="eyebrow">MAN PAGE / COMANDO</span><h3>{command} <span className="dim">{page ? '(' + (page as any).section + ')' : ''}</span></h3></div>
          <div className="manual-buttons">
            {local && <Button size="icon" variant="ghost" title="Inserir exemplo" onClick={() => onInsert(local.example)}><Copy size={15} /></Button>}
            <a target="_blank" rel="noreferrer" href={page?.url || 'https://www.mankier.com/1/' + encodeURIComponent(command || '')} title="Abrir manual completo"><ExternalLink size={16} /></a>
          </div>
        </div>
        <p className="manual-summary">{local?.description || page?.description || 'Consulte os detalhes no manual.'}</p>
        {local && <div className="example-block"><span>EXEMPLO RÁPIDO</span><code>{local.example}</code></div>}
        {loading && <div className="muted flex-center"><LoaderCircle className="spin" size={15} /> Consultando man page…</div>}
        {error && <p className="muted">{error} Os exemplos locais continuam disponíveis.</p>}
        {!!page?.content?.length && <div className="manual-sections">{page.content.map((part) => (
          <div key={part.title}><h4>{part.title}</h4><p>{clean(part.html).slice(0, 650)}</p></div>
        ))}</div>}
        {!!page?.anchors?.length && <div className="manual-options"><h4>Opções mais comuns</h4>
          {page.anchors.slice(0, 7).map((anchor, i) => (
            <div key={i}><code>{clean(anchor.anchor)}</code><p>{clean(anchor.description).slice(0, 145)}</p></div>
          ))}
        </div>}
        <div className="manual-foot">Fonte: ManKier • Referência externa, não uma explicação gerada por IA.</div>
      </PopoverContent>
    </Popover>
  );
}
