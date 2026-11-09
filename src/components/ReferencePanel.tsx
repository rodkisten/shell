import { useMemo, useState } from 'react';
import { Search, BookOpen, ArrowUpRight } from 'lucide-react';
import { COMMANDS, SNIPPETS, type ShellCommand } from '../lib/commands';
import { Button } from './ui/button';

const groups = ['Todos', 'Arquivos', 'Texto', 'Sistema', 'Rede', 'Shell', 'Dev'] as const;
export function ReferencePanel({ onInsert, onInspect }: { onInsert(value: string): void; onInspect(value: string): void }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('Todos');
  const filtered = useMemo(() => COMMANDS.filter((item) => (group === 'Todos' || item.group === group) &&
    (item.name + ' ' + item.title + ' ' + item.description).toLowerCase().includes(query.toLowerCase())), [query, group]);
  return <section className="reference-panel">
    <div className="section-header"><div><span className="eyebrow">APRENDA NA PRÁTICA</span><h2>Biblioteca de comandos</h2><p>Exemplos prontos, flags e acesso à documentação oficial.</p></div></div>
    <label className="search-field"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar: sed, jq, curl, find..." aria-label="Buscar comandos"/></label>
    <div className="group-filter">{groups.map(value => <button key={value} onClick={() => setGroup(value)} className={group === value ? 'selected' : ''}>{value}</button>)}</div>
    <div className="reference-grid">{filtered.map((item: ShellCommand) => <article className="reference-card" key={item.name}>
      <div className="reference-top"><code>{item.name}</code><span>{item.group}</span></div>
      <h3>{item.title}</h3><p>{item.description}</p><pre>{item.example}</pre>
      <div className="reference-actions">
        <Button variant="outline" size="sm" onClick={() => onInsert(item.example)}>Usar exemplo <ArrowUpRight size={13}/></Button>
        <button className="link-button" onClick={() => onInspect(item.name)}><BookOpen size={14}/> Manual</button>
      </div>
    </article>)}</div>
    {!filtered.length && <div className="empty-state">Nenhum comando encontrado.</div>}
    <div className="snippets-heading"><span className="eyebrow">BLOCOS DE SHELL</span><h3>Estruturas prontas</h3></div>
    <div className="snippet-grid">{SNIPPETS.map(item => <button className="snippet-card" key={item.id} onClick={() => onInsert(item.code)}>
      <code>{item.name}</code><span>{item.subtitle}</span><ArrowUpRight size={15}/></button>)}</div>
  </section>;
}
