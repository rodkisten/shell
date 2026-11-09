import { useEffect, useState } from 'react';
import { Clock3, Copy, RotateCcw, Trash2, Bookmark, Play } from 'lucide-react';
import { Button } from './ui/button';
import { getEntries, clearEntries, deleteEntry, type Entry } from '../lib/storage';
import { truncate } from '../lib/utils';

export function HistoryPanel({ revision, onRestore, notify }: {
  revision: number; onRestore(code: string): void; notify(text: string): void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tab, setTab] = useState<'all' | 'save' | 'run'>('all');
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    try { setEntries(await getEntries()); }
    catch { notify('Seu navegador bloqueou o IndexedDB.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [revision]);
  const visible = entries.filter(e => tab === 'all' || e.kind === tab);
  return <section className="history-panel">
    <div className="section-header"><div><span className="eyebrow">SEU ESPAÇO</span><h2>Histórico local</h2><p>Seus scripts ficam neste dispositivo, sem conta e sem sincronização.</p></div>
      <Button variant="ghost" size="sm" disabled={!entries.length} onClick={async () => { if (!window.confirm('Apagar todos os scripts do histórico deste dispositivo?')) return; await clearEntries(); await reload(); notify('Histórico apagado.'); }}><Trash2 size={14} /> Limpar</Button>
    </div>
    <div className="filter-tabs">
      {(['all', 'save', 'run'] as const).map(value => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{value === 'all' ? 'Todos' : value === 'save' ? 'Salvos' : 'Executados'}</button>)}
    </div>
    <div className="history-list">
      {loading ? <p className="muted">Carregando…</p> : !visible.length ? <div className="empty-state"><Clock3 size={26} /><strong>Nenhum script ainda</strong><span>Experimente executar ou salvar um comando no editor.</span></div> :
        visible.map(item => <article className="history-item" key={item.id}>
          <div className="history-item-top"><span className="history-kind">{item.kind === 'save' ? <Bookmark size={13}/> : <Play size={13}/>} {item.kind === 'save' ? 'Salvo' : 'Execução'}</span><time>{new Intl.DateTimeFormat('pt-BR', {dateStyle:'short',timeStyle:'short'}).format(item.date)}</time></div>
          <pre>{truncate(item.script, 450)}</pre>
          <div className="history-actions">
            <Button size="sm" variant="outline" onClick={() => onRestore(item.script)}><RotateCcw size={13} /> Restaurar</Button>
            <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(item.script); notify('Copiado!'); }}><Copy size={13} /> Copiar</Button>
            <Button size="icon" variant="ghost" title="Excluir" onClick={async () => { await deleteEntry(item.id); await reload(); }}><Trash2 size={14}/></Button>
          </div>
        </article>)
      }
    </div>
  </section>;
}
