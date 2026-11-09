import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, Check, Clock3, Copy, Edit3, ExternalLink,
  FilePlus2, Folder, History, Info, LoaderCircle, Plus, Search, Send,
  Shield, Star, Terminal, Trash2, Wifi, WifiOff, X,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import {
  TOUCH_CATEGORIES, TOUCH_PRESETS, isOneLine, needsConfirmation,
  type TouchCommand,
} from './lib/touch-presets';
import {
  clearTouchRecent, deleteTouchCommand, deleteTouchRecent, loadTouchData,
  putTouchCommand, recordTouchCommand, setTouchFavorite, type TouchRecent,
} from './lib/touch-storage';
import { useTouchBridge, type HostRecent, type SendMode } from './lib/touch-bridge';
import { formatShell } from './lib/format';
import { cn } from './lib/utils';

type Tab = 'commands' | 'favorites' | 'saved' | 'recent';
type FormData = { id?: string; title: string; description: string; category: string; command: string };
const blank: FormData = { title: '', description: '', category: 'Meus comandos', command: '' };
const tabs: Array<{ id: Tab; label: string; icon: typeof Search }> = [
  { id: 'commands', label: 'Comandos', icon: Terminal },
  { id: 'favorites', label: 'Favoritos', icon: Star },
  { id: 'saved', label: 'Salvos', icon: Folder },
  { id: 'recent', label: 'Recentes', icon: History },
];

type RecentRow = TouchCommand & { historyId?: string; source?: 'local'|'extension'; date?: number };

function recentToCommand(local: TouchRecent[], remote: HostRecent[]): RecentRow[] {
  const combined: RecentRow[] = [
    ...local.map(item => ({
      id: 'recent:' + item.id, historyId: item.id, source: 'local' as const,
      date: item.createdAt, title: item.title, command: item.command,
      description: item.disposition === 'sent' ? 'Enviado para o terminal' : 'Copiado',
      category: 'Histórico',
    })),
    ...remote.map((item, index) => ({
      id: 'host:' + index + ':' + item.createdAt, source: 'extension' as const,
      date: item.createdAt, title: item.title || 'Comando do VS Code',
      command: item.command, description: 'Histórico enviado pela extensão',
      category: 'Histórico',
    })),
  ];
  combined.sort((a, b) => (b.date || 0) - (a.date || 0));
  const seen = new Set<string>();
  return combined.filter(item => {
    if (seen.has(item.command)) return false;
    seen.add(item.command);
    return true;
  }).slice(0, 100);
}

function CommandTile({ item, pinned, busy, onSend, onFavorite, onCopy, onEdit, onSave, onDelete }: {
  item: RecentRow;
  pinned: boolean;
  busy: boolean;
  onSend(item: TouchCommand): void;
  onFavorite(item: TouchCommand): void;
  onCopy(item: TouchCommand): void;
  onEdit(item: TouchCommand): void;
  onSave(item: TouchCommand): void;
  onDelete?(id: string): void;
}) {
  return <article className="touch-command" aria-label={item.title}>
    <div className="touch-command-main">
      <button className="touch-command-send" disabled={busy} onClick={() => onSend(item)}
        title="Enviar ao terminal, ou copiar se desconectado">
        <span className="touch-command-name">{item.title}</span>
        <span className="touch-command-subtitle">{item.description}</span>
        <code className="touch-command-code">{item.command}</code>
      </button>
      <button className="touch-send-arrow" disabled={busy} title="Enviar" aria-label={'Enviar ' + item.title}
        onClick={() => onSend(item)}>{busy ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={17}/>}</button>
    </div>
    <div className="touch-command-bottom">
      <span className="touch-category-label">{item.category}</span>
      <div className="touch-command-actions">
        <button title={pinned ? 'Desfavoritar' : 'Favoritar'} aria-label={pinned ? 'Desfavoritar' : 'Favoritar'}
          onClick={() => onFavorite(item)} className={cn(pinned && 'is-pinned')}>
          <Star size={14} fill={pinned ? 'currentColor' : 'none'}/>
        </button>
        <button title="Copiar" aria-label="Copiar" onClick={() => onCopy(item)}><Copy size={14}/></button>
        {item.custom
          ? <button title="Editar" aria-label="Editar" onClick={() => onEdit(item)}><Edit3 size={14}/></button>
          : <button title="Salvar como personalizado" aria-label="Salvar" onClick={() => onSave(item)}><FilePlus2 size={14}/></button>}
        {item.historyId && onDelete && <button title="Remover do histórico" aria-label="Remover do histórico"
          onClick={() => onDelete(item.historyId!)}><Trash2 size={14}/></button>}
      </div>
    </div>
  </article>;
}

export function TouchTerminal() {
  const [tab, setTab] = useState<Tab>('commands');
  const [category, setCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState<TouchCommand[]>([]);
  const [recent, setRecent] = useState<TouchRecent[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mode, setMode] = useState<SendMode>('insert');
  const [form, setForm] = useState<FormData>(blank);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [storageOk, setStorageOk] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchInput = useRef<HTMLInputElement>(null);
  const { connected, hostHistory, send } = useTouchBridge();

  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 4200);
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await loadTouchData();
      setCustom(data.custom);
      setRecent(data.recent);
      setFavorites(data.favorites);
      setStorageOk(true);
    } catch {
      setStorageOk(false);
      notify('IndexedDB indisponível: salvos e histórico não serão persistidos.');
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { void reload(); return () => clearTimeout(timer.current); }, [reload]);

  const recentRows = useMemo(() => recentToCommand(recent, hostHistory), [recent, hostHistory]);
  const commands = useMemo(() => [...custom, ...TOUCH_PRESETS], [custom]);
  const categories = useMemo(() => {
    const all = new Set(commands.map(item => item.category));
    return ['Todos', ...TOUCH_CATEGORIES.filter(group => all.delete(group)), ...Array.from(all).sort()];
  }, [commands]);
  const shown = useMemo(() => {
    const base: RecentRow[] = tab === 'recent' ? recentRows :
      tab === 'saved' ? custom :
      tab === 'favorites' ? commands.filter(item => favorites.includes(item.id)) :
      commands;
    const needle = search.toLocaleLowerCase('pt-BR').trim();
    return base.filter(item =>
      (tab !== 'commands' || category === 'Todos' || category === item.category) &&
      (!needle || [item.title, item.command, item.category, item.description].some(value =>
        value.toLocaleLowerCase('pt-BR').includes(needle)
      ))
    ).slice(0, tab === 'commands' ? 150 : 100);
  }, [commands, custom, favorites, recentRows, tab, category, search]);

  const copy = async (item: TouchCommand) => {
    try {
      await navigator.clipboard.writeText(item.command);
      await recordTouchCommand(item.command, item.title, 'copied').catch(() => undefined);
      void reload();
      notify('Comando copiado.');
    } catch { notify('Não foi possível copiar. Verifique a permissão de clipboard.'); }
  };
  const sendCommand = async (item: TouchCommand) => {
    if (pending) return;
    if (mode === 'run' && needsConfirmation(item.command) &&
      !window.confirm('Executar este comando no terminal real?\n\n' + item.command)) return;
    setPending(item.id);
    try {
      const result = await send(item.command, mode);
      await recordTouchCommand(item.command, item.title, result === 'sent' ? 'sent' : 'copied')
        .catch(() => undefined);
      void reload();
      notify(result === 'sent' ?
        (mode === 'run' ? 'A extensão confirmou o envio com Enter.' : 'Comando inserido no terminal.') :
        'Extensão desconectada: comando copiado.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Falha ao enviar comando.');
    } finally { setPending(null); }
  };
  const toggleFavorite = async (item: TouchCommand) => {
    const shouldPin = !favorites.includes(item.id);
    setFavorites(current => shouldPin ? [...current, item.id] : current.filter(id => id !== item.id));
    try { await setTouchFavorite(item.id, shouldPin); }
    catch { void reload(); notify('Não foi possível salvar favorito.'); }
  };
  const startNew = (item?: TouchCommand) => {
    setForm(item ? {
      id: item.custom ? item.id : undefined, title: item.title, command: item.command,
      description: item.description, category: item.category,
    } : blank);
    setDialogOpen(true);
  };
  const persist = async () => {
    if (saving) return;
    if (!form.title.trim() || !form.command.trim() || !form.category.trim()) {
      notify('Informe nome, categoria e comando.'); return;
    }
    setSaving(true);
    try {
      const raw = form.command.trim();
      const command = isOneLine(raw) ? raw : (await formatShell(raw, true)).trim();
      if (!isOneLine(command)) throw new Error('Não é possível converter esse script em uma linha válida. Use o editor principal.');
      const existing = custom.find(item => item.id === form.id);
      const now = Date.now();
      await putTouchCommand({
        id: existing?.id || crypto.randomUUID(),
        title: form.title.trim().slice(0, 100),
        category: form.category.trim().slice(0, 50),
        description: form.description.trim().slice(0, 200),
        command, custom: true,
        createdAt: existing?.createdAt || now, updatedAt: now,
      });
      await reload(); setDialogOpen(false);
      notify(existing ? 'Comando atualizado.' : 'Comando salvo no dispositivo.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally { setSaving(false); }
  };
  const removeCustom = async () => {
    if (!form.id || !window.confirm('Excluir este comando personalizado?')) return;
    try { await deleteTouchCommand(form.id); setDialogOpen(false); await reload(); notify('Comando removido.'); }
    catch { notify('Não foi possível excluir.'); }
  };
  const removeRecent = async (id: string) => {
    try { await deleteTouchRecent(id); await reload(); }
    catch { notify('Não foi possível remover do histórico.'); }
  };
  const clearHistory = async () => {
    if (!window.confirm('Limpar o histórico local? O histórico da extensão não será alterado.')) return;
    try { await clearTouchRecent(); await reload(); notify('Histórico local limpo.'); }
    catch { notify('Não foi possível limpar.'); }
  };

  return <div className="touch-app">
    <header className="touch-header">
      <div className="touch-brand"><span className="touch-mark"><Terminal size={17} strokeWidth={2.7}/></span>
        <div><strong>Shell<span>Conductor</span></strong><small>TOUCH COMMANDS</small></div></div>
      <div className={cn('touch-connection', connected && 'connected')} title={connected ? 'Extensão conectada' : 'Extensão ainda não conectada'}>
        {connected ? <Wifi size={14}/> : <WifiOff size={14}/>}
        <span>{connected ? 'VS Code' : 'Copiar'}</span>
      </div>
    </header>
    <div className="touch-body">
      <div className="touch-topline">
        <div><span className="touch-eyebrow">COMAND CENTER / V1</span><h1>Comandos<span>.</span></h1>
          <p>Seu terminal a um toque de distância.</p></div>
        <button className="touch-new" onClick={() => startNew()} aria-label="Criar comando"><Plus size={20}/></button>
      </div>
      <div className="touch-mode">
        <span><Send size={14}/> Ao tocar</span>
        <div role="group" aria-label="Modo de envio">
          <button className={cn(mode === 'insert' && 'active')} onClick={() => setMode('insert')}>Inserir</button>
          <button className={cn(mode === 'run' && 'active')} onClick={() => setMode('run')}>Executar ↵</button>
        </div>
      </div>
      <label className="touch-search"><Search size={17}/>
        <input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Buscar comandos..." aria-label="Buscar comandos"/>
        {search && <button aria-label="Limpar busca" onClick={() => { setSearch(''); searchInput.current?.focus(); }}><X size={15}/></button>}
      </label>
      <nav className="touch-tabs" aria-label="Coleções de comandos">
        {tabs.map(item => <button key={item.id} onClick={() => { setTab(item.id); setCategory('Todos'); }}
          className={cn(tab === item.id && 'active')} aria-current={tab === item.id ? 'page' : undefined}>
          <item.icon size={15}/><span>{item.label}</span>
          {item.id === 'saved' && custom.length > 0 && <sup>{custom.length}</sup>}
        </button>)}
      </nav>
      {tab === 'commands' && <div className="touch-chips" aria-label="Categorias">
        {categories.map(item => <button key={item} className={cn(category === item && 'active')}
          onClick={() => setCategory(item)}>{item}</button>)}
      </div>}
      <div className="touch-list-heading">
        <span>{tab === 'commands' ? (category === 'Todos' ? 'TODOS OS COMANDOS' : category.toLocaleUpperCase('pt-BR'))
          : tab === 'favorites' ? 'SEUS FAVORITOS'
          : tab === 'saved' ? 'PERSONALIZADOS' : 'HISTÓRICO DO TERMINAL'}</span>
        <div>{tab === 'recent' && recent.length > 0 &&
          <button className="touch-link" onClick={() => void clearHistory()}><Trash2 size={12}/> Limpar</button>}
          <span>{shown.length} {shown.length === 1 ? 'item' : 'itens'}</span></div>
      </div>
      <div className="touch-list">
        {loading ? <div className="touch-empty"><LoaderCircle className="spin" size={24}/><p>Carregando comandos...</p></div> :
          shown.length > 0 ? shown.map(item => <CommandTile key={item.id} item={item}
            pinned={favorites.includes(item.id)} busy={pending !== null}
            onSend={item => { void sendCommand(item); }}
            onFavorite={item => { void toggleFavorite(item); }}
            onCopy={item => { void copy(item); }}
            onEdit={startNew}
            onSave={startNew}
            onDelete={id => { void removeRecent(id); }}/>) :
          <div className="touch-empty">
            {tab === 'favorites' ? <Star size={26}/> : tab === 'recent' ? <Clock3 size={26}/> : <Search size={26}/>}
            <strong>{search ? 'Nenhum resultado' :
              tab === 'favorites' ? 'Favorite seus comandos' :
              tab === 'recent' ? 'Sem comandos recentes' :
              tab === 'saved' ? 'Crie seu primeiro comando' : 'Nenhum comando nesta categoria'}</strong>
            <p>{search ? 'Tente outra busca.' :
              tab === 'recent' ? 'Os comandos enviados ou copiados aparecerão aqui.' :
              'Use a estrela para favoritar ou + para criar um comando personalizado.'}</p>
            {tab === 'saved' && <Button size="sm" onClick={() => startNew()}><Plus size={14}/> Novo comando</Button>}
          </div>}
      </div>
    </div>
    <footer className="touch-footer">
      <div className="touch-footer-status"><span className={cn('touch-dot',connected && 'connected')}/>
        <span>{connected ? 'Bridge conectada' : 'Sem bridge: copiar'}{!storageOk ? ' · Sem IndexedDB' : ' · Local'}</span></div>
      <button title="Como integrar" aria-label="Como integrar" onClick={() => setShowHelp(value => !value)}><Info size={15}/></button>
      <Link to="/" title="Editor completo" aria-label="Editor completo"><ExternalLink size={15}/></Link>
    </footer>
    {showHelp && <div className="touch-help"><button onClick={() => setShowHelp(false)} aria-label="Fechar"><X size={14}/></button>
      <strong>Integração VS Code</strong>
      <p>Abra <code>/touch</code> no Webview. A extensão deve responder ao handshake e receber <code>terminal.send</code>. Enquanto estiver desconectada, tocar em um comando o copia.</p>
      <a href="https://github.com/rodkisten/shell/blob/main/docs/vscode-touch-bridge.md" target="_blank" rel="noreferrer">Ver contrato de mensagens ↗</a>
    </div>}
    {notice && <div className="touch-toast" role="status"><Check size={15}/>{notice}<button onClick={() => setNotice('')} aria-label="Dispensar"><X size={14}/></button></div>}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="touch-dialog">
        <div className="touch-dialog-head">
          <div><span className="touch-eyebrow">SUA BIBLIOTECA</span>
            <DialogTitle>{form.id ? 'Editar comando' : 'Novo comando'}</DialogTitle>
            <DialogDescription>Um comando reutilizável em uma única linha de Shell.</DialogDescription></div>
          <button onClick={() => setDialogOpen(false)} aria-label="Fechar"><X size={18}/></button>
        </div>
        <form onSubmit={event => { event.preventDefault(); void persist(); }}>
          <label>Nome<input required maxLength={100} value={form.title}
            onChange={event => setForm(old => ({...old,title:event.target.value}))} placeholder="Ex: Atualizar projeto"/></label>
          <label>Categoria<input required maxLength={50} list="touch-category-options" value={form.category}
            onChange={event => setForm(old => ({...old,category:event.target.value}))} placeholder="Ex: Git"/></label>
          <datalist id="touch-category-options">{TOUCH_CATEGORIES.map(item => <option key={item} value={item}/>)}</datalist>
          <label>Descrição<input maxLength={200} value={form.description}
            onChange={event => setForm(old => ({...old,description:event.target.value}))} placeholder="O que esse comando faz?"/></label>
          <label>Comando Shell<textarea required rows={3} value={form.command} spellCheck={false}
            onChange={event => setForm(old => ({...old,command:event.target.value}))}
            placeholder="git status --short"/></label>
          <p className="touch-dialog-tip"><Shield size={13}/> Ao salvar, o shfmt tentará transformar o script em uma linha válida. Nada é executado aqui.</p>
          <div className="touch-dialog-actions">
            {form.id && <Button type="button" variant="ghost" size="sm" className="touch-delete" onClick={() => void removeCustom()}><Trash2 size={14}/> Excluir</Button>}
            <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={saving}>{saving && <LoaderCircle className="spin" size={13}/>} Salvar comando</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
