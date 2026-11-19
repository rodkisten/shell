import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import {
  Activity, ArrowDownToLine, ArrowLeftRight, BookOpen, Bookmark, ChevronDown, CircleAlert,
  CircleCheck, Clipboard, Clock3, Code2, Copy, FileCode2, FileText, Github, Info,
  LoaderCircle, Menu, Play, RotateCcw, ShieldCheck, Sparkles, Square, Terminal,
  Trash2, WandSparkles, X,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { ManPopover } from './components/ManPopover';
import { ShellEditor, type ShellEditorHandle } from './components/ShellEditor';
import { CommandHelp } from './components/CommandHelp';
import { ExecutionExplorer } from './components/ExecutionExplorer';
import { analyzeShell } from './lib/shell-analysis';
import { analyzeShellWasm, initializeShellFlowWasm, subscribeShellFlowStatus, type FlowWasmStatus, type WasmFlowResult } from './lib/shell-flow-wasm';
import { HistoryPanel } from './components/HistoryPanel';
import { LinuxPanel } from './components/LinuxPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import './components/workspace.css';
import { ReferencePanel } from './components/ReferencePanel';
import { SNIPPETS } from './lib/commands';
import { contextualHints, type Hint } from './lib/suggestions';
import { explainKnownShellTokensFromSnapshot, type SemanticToken } from './lib/semantic-shell';
import { inspectShellSnapshot, type ShellAstNode } from './lib/shell-ast';
import { parseShellSnapshot } from './lib/shell-parser';
import { formatShell } from './lib/format';
import { checkShell, applyAvailableFixes, type Finding } from './lib/shellcheck';
import { cancelShell, executeScript, resetShell } from './lib/terminal';
import { getDraft, saveDraft, saveEntry } from './lib/storage';
import { cn } from './lib/utils';
import { commandHelp, type CommandHelpModel } from './lib/command-help';

const starter = `#!/usr/bin/env zsh
# Bem-vindo ao ShellConductor 👋
set -euo pipefail

nome="mundo"
for numero in 1 2 3; do
  printf "Olá, %s! Iteração %s\\n" "$nome" "$numero"
done
`;
type Output = { id: number; script: string; stdout: string; stderr: string; exitCode: number; time: number };
const shortcuts = [
  { label: 'Tab', value: '  ' }, { label: '|', value: ' | ' }, { label: '&&', value: ' && ' },
  { label: '$()', value: '$()' }, { label: '${}', value: '${}' }, { label: '""', value: '""' },
  { label: 'if', value: 'if [[  ]]; then\n  \nfi' }, { label: 'for', value: 'for item in ; do\n  \ndone' },
];

function NavContents() {
  return <>
    <div className="nav-group-label">WORKSPACE</div>
    <NavLink end to="/" className={({ isActive }) => cn('side-link', isActive && 'active')}><Code2 size={17} /> Editor <span className="shortcut-hint">⌘ 1</span></NavLink>
    <NavLink to="/biblioteca" className={({ isActive }) => cn('side-link', isActive && 'active')}><BookOpen size={17} /> Biblioteca</NavLink>
    <NavLink to="/linux" className={({ isActive }) => cn('side-link', isActive && 'active')}><Terminal size={17} /> Alpine Linux <span className="shortcut-hint">v86</span></NavLink>
    <NavLink to="/touch" className={({ isActive }) => cn('side-link', isActive && 'active')}><Terminal size={17} /> Touch Commands</NavLink>
    <NavLink to="/historico" className={({ isActive }) => cn('side-link', isActive && 'active')}><Clock3 size={17} /> Histórico</NavLink>
    <div className="nav-group-label second">REFERÊNCIA</div>
    <a className="side-link" href="https://www.shellcheck.net/wiki/" target="_blank" rel="noreferrer"><ShieldCheck size={17} /> ShellCheck <ArrowDownToLine className="external-mini" size={13}/></a>
    <a className="side-link" href="https://www.mankier.com/" target="_blank" rel="noreferrer"><FileText size={17}/> Man pages <ArrowDownToLine className="external-mini" size={13}/></a>
  </>;
}

export function App() {
  const [script, setScript] = useState(starter);
  const [cursor, setCursor] = useState(starter.length);
  const [inspected, setInspected] = useState<string | null>(null);
  const [semanticSelection, setSemanticSelection] = useState<SemanticToken | null>(null);
  const [quickHelp, setQuickHelp] = useState<CommandHelpModel | null>(null);
  const [busy, setBusy] = useState<'format' | 'check' | 'run' | 'explain' | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [output, setOutput] = useState<Output[]>([]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explorerTab, setExplorerTab] = useState<'flow' | 'ast' | 'explanation'>('flow');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [astNodes, setAstNodes] = useState<ShellAstNode[]>([]);
  const [analysisTokens, setAnalysisTokens] = useState<SemanticToken[]>([]);
  const [flowResult, setFlowResult] = useState<WasmFlowResult | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<FlowWasmStatus>({ state: 'idle' });
  useEffect(() => {
    const unsubscribe = subscribeShellFlowStatus(setFlowStatus);
    initializeShellFlowWasm();
    return unsubscribe;
  }, []);
  const analysisRevision = useRef(0);
  const [toast, setToast] = useState('');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [showSnippets, setShowSnippets] = useState(false);
  const [showOutput, setShowOutput] = useState(true);
  const [sideBySide, setSideBySide] = useState(() => localStorage.getItem('shellconductor:side-by-side') === 'true');
  const [splitRatio, setSplitRatio] = useState(() => Number(localStorage.getItem('shellconductor:split-ratio')) || 50);
  const [autoRun, setAutoRun] = useState(() => localStorage.getItem('shellconductor:auto-run') === 'true');
  const [editorFontSize, setEditorFontSize] = useState(() => Math.max(9, Math.min(14, Number(localStorage.getItem('shellconductor:editor-font-size')) || 11)));
  const [editorWordWrap, setEditorWordWrap] = useState(() => localStorage.getItem('shellconductor:editor-word-wrap') !== 'false');
  const [editorHeight, setEditorHeight] = useState(() => Number(localStorage.getItem('shellconductor:editor-height')) || 390);
  const [terminalHeight, setTerminalHeight] = useState(() => Number(localStorage.getItem('shellconductor:terminal-height')) || 260);
  const [runRevision, setRunRevision] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const editor = useRef<ShellEditorHandle>(null);
  const runningRef = useRef(false);
  const pendingAutoRun = useRef<string | null>(null);
  const runScriptRef = useRef<(source: string, automatic?: boolean) => Promise<void>>(async () => undefined);
  const hydrated = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigation = useNavigate();
  const location = useLocation();
  const [hints, setHints] = useState<Hint[]>([]);
  useEffect(() => {
    let active = true;
    void contextualHints(script, cursor).then(next => {
      if (active) setHints(next);
    });
    return () => { active = false; };
  }, [script, cursor]);

  useEffect(() => {
    let active = true;
    void commandHelp(script, cursor)
      .then(next => { if (active) setQuickHelp(next); })
      .catch(() => { if (active) setQuickHelp(null); });
    return () => { active = false; };
  }, [script, cursor]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(''), 3600);
  }, []);

  useEffect(() => {
    let active = true;
    getDraft().then((saved) => { if (active && saved) setScript(saved); })
      .catch(() => { /* Private Safari sessions may block IndexedDB. */ })
      .finally(() => { hydrated.current = true; });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => { void saveDraft(script).catch(() => undefined); }, 450);
    return () => clearTimeout(timer);
  }, [script]);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const change = (text: string) => { analysisRevision.current++; setScript(text); setFindings([]); setExplanation(null); setAstNodes([]); setAnalysisTokens([]); setFlowResult(null); setFlowError(null); setSemanticSelection(null); };
  const insert = (text: string) => {
    navigation('/');
    // Editor may not be mounted yet when opened from the library.
    if (location.pathname !== '/') {
      setScript((previous) => previous.trim() ? previous.trimEnd() + '\n\n' + text : text);
    } else editor.current?.insert(text);
  };
  const restore = (text: string) => { setScript(text); setCursor(text.length); navigation('/'); notify('Script restaurado no editor.'); };

  const copy = async (text = script) => {
    try { await navigator.clipboard.writeText(text); notify('Copiado para a área de transferência.'); }
    catch { notify('Não foi possível copiar. Selecione o texto manualmente.'); }
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return notify('A área de transferência está vazia.');
      change(text);
      notify('Script colado.');
    } catch { notify('Use Colar do teclado do Safari para permitir acesso.'); editor.current?.focus(); }
  };
  const convert = async (singleLine: boolean) => {
    setBusy('format');
    try {
      const formatted = await formatShell(script, singleLine);
      if (!formatted) return notify('Escreva um comando primeiro.');
      change(formatted);
      if (singleLine && formatted.includes('\n')) notify('Este script possui estruturas que precisam de múltiplas linhas para manter a sintaxe.');
      else notify(singleLine ? 'Convertido para uma linha pelo sh-syntax.' : 'Formatado pelo sh-syntax.');
    } catch (error) { notify('Erro de sintaxe ou formatação: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setBusy(null); }
  };
  const check = async () => {
    setBusy('check');
    try {
      const diagnostics = await checkShell(script);
      setFindings(diagnostics);
      notify(diagnostics.length ? diagnostics.length + ' apontamento(s) do ShellCheck.' : 'Nenhum problema encontrado pelo ShellCheck.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Erro no ShellCheck.'); }
    finally { setBusy(null); }
  };
  const fix = () => {
    const result = applyAvailableFixes(script, findings);
    if (result.count) { change(result.code); notify(result.count + ' correção(ões) automática(s) aplicada(s). Valide novamente.'); }
    else notify('Nenhuma correção segura automática. Consulte as dicas abaixo.');
  };
  const save = async () => {
    if (!script.trim()) return notify('O editor está vazio.');
    try { await saveEntry(script, 'save'); setHistoryRevision(n => n + 1); notify('Script salvo no IndexedDB deste dispositivo.'); }
    catch { notify('IndexedDB indisponível neste navegador.'); }
  };
  const runScript = useCallback(async (source: string, automatic = false) => {
    if (!source.trim()) return;
    if (runningRef.current) {
      if (automatic) pendingAutoRun.current = source;
      return;
    }
    runningRef.current = true;
    setBusy('run');
    setShowOutput(true);
    try {
      const result = await executeScript(source);
      const now = Date.now();
      setOutput(current => [{ ...result, script: source, id: now, time: now }, ...current].slice(0, 20));
      if (!automatic) {
        try { await saveEntry(source, 'run', result.stdout + result.stderr); setHistoryRevision(n => n + 1); }
        catch { /* Execution works without history storage. */ }
        notify(result.exitCode === 0 ? 'Executado no sandbox WASM.' : 'Finalizado com código ' + result.exitCode + '.');
      }
    } catch (error) {
      const now = Date.now();
      setOutput(current => [{ id: now, time: now, script: source, stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1 }, ...current].slice(0, 20));
      if (!automatic) notify('Falha na execução. Veja a saída.');
    } finally {
      runningRef.current = false;
      setBusy(null);
      setRunRevision(n => n + 1);
    }
  }, [notify]);
  runScriptRef.current = runScript;
  const run = () => { pendingAutoRun.current = null; void runScriptRef.current(script); };

  useEffect(() => {
    localStorage.setItem('shellconductor:auto-run', String(autoRun));
    if (!autoRun) { pendingAutoRun.current = null; return; }
    if (!hydrated.current || !script.trim()) return;
    const timer = setTimeout(() => {
      if (runningRef.current) pendingAutoRun.current = script;
      else void runScriptRef.current(script, true);
    }, 850);
    return () => clearTimeout(timer);
  }, [script, autoRun]);

  useEffect(() => {
    if (!autoRun || !pendingAutoRun.current || runningRef.current) return;
    const next = pendingAutoRun.current;
    pendingAutoRun.current = null;
    const timer = setTimeout(() => void runScriptRef.current(next, true), 150);
    return () => clearTimeout(timer);
  }, [runRevision, autoRun]);

  const splitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const parent = element.parentElement;
    if (!parent) return;
    element.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const bounds = parent.getBoundingClientRect();
      const available = Math.max(1, bounds.width - 300);
      setSplitRatio(Math.max(25, Math.min(75, ((e.clientX - bounds.left) / Math.max(1, bounds.width)) * 100)));
    };
    const finish = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
  };
  useEffect(() => { localStorage.setItem('shellconductor:editor-font-size', String(editorFontSize)); }, [editorFontSize]);
  useEffect(() => { localStorage.setItem('shellconductor:editor-word-wrap', String(editorWordWrap)); }, [editorWordWrap]);
  useEffect(() => { localStorage.setItem('shellconductor:side-by-side', String(sideBySide)); }, [sideBySide]);
  useEffect(() => { localStorage.setItem('shellconductor:split-ratio', String(splitRatio)); }, [splitRatio]);

  const resize = (target: 'editor' | 'terminal', event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = event.clientY;
    const initial = target === 'editor' ? editorHeight : terminalHeight;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const height = Math.max(150, Math.min(1100, initial + e.clientY - origin));
      if (target === 'editor') setEditorHeight(height);
      else setTerminalHeight(height);
    };
    const finish = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
      const currentHeight = target === 'editor' ? document.querySelector('.editor-inner')?.getBoundingClientRect().height : document.querySelector('.terminal-body')?.getBoundingClientRect().height;
      if (currentHeight) localStorage.setItem('shellconductor:' + target + '-height', String(Math.round(currentHeight)));
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
  };
  const explain = async (preserveTab = false) => {
    if (!preserveTab) setExplorerTab('flow');
    setExplorerOpen(true);
    if (!script.trim()) return notify('Cole ou escreva um comando primeiro.');
    setBusy('explain');
    const revision = ++analysisRevision.current;
    try {
      // Validate with the already-installed shell parser. Do not send scripts
      // (which may contain credentials) to the remote documentation endpoint.
      const snapshot = await parseShellSnapshot(script);
      const overview = inspectShellSnapshot(snapshot);
      const tokens = explainKnownShellTokensFromSnapshot(snapshot);
      if (revision !== analysisRevision.current) return;
      setAstNodes(overview.nodes);
      setAnalysisTokens(tokens);
      setFlowResult(null);
      setFlowError(null);
      void analyzeShellWasm(script).then(result => {
        if (revision === analysisRevision.current) setFlowResult(result);
      }).catch(error => {
        if (revision === analysisRevision.current) setFlowError(error instanceof Error ? error.message : String(error));
      });
      const steps = tokens.map((token, index) =>
        `${index + 1}. ${token.text} · ${token.title}\n   ${token.description}${token.example ? '\n   Exemplo: ' + token.example : ''}`
      );
      setExplanation(steps.length
        ? ['AST real (sh-syntax / mvdan)', `${overview.navigableCount}/${overview.count} nós com posição verificável`, ...overview.lines, overview.truncated ? '… árvore truncada para proteger o desempenho no celular.' : '', '', 'Análise semântica parcial (catálogo + operadores)', '', ...steps, '', 'A AST é estrutural; efeitos de expansões dinâmicas e comandos externos não são inferidos.'].join('\n')
        : ['AST real (sh-syntax / mvdan)', ...overview.lines, '', 'Nenhum comando reconhecido pelo catálogo semântico local.'].join('\n'));
    } catch (error) {
      if (revision !== analysisRevision.current) return;
      setAstNodes([]);
      setAnalysisTokens([]);
      setExplanation('Não foi possível analisar a sintaxe Zsh: ' + (error instanceof Error ? error.message : String(error)));
    } finally { if (revision === analysisRevision.current) setBusy(null); }
  };

  useEffect(() => {
    if (!explorerOpen || !explanation) return;
    const timer = window.setTimeout(() => { void explain(true); }, 450);
    return () => window.clearTimeout(timer);
    // Recompute only when source changes while dock is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, explorerOpen]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand"><span className="brand-icon"><Terminal size={20} strokeWidth={2.4}/></span><span>Shell<span className="brand-muted">Conductor</span></span></Link>
        <div className="workspace-pill"><span className="workspace-dot"/><span>Meu workspace</span><ChevronDown size={14}/></div>
        <nav className="side-nav"><NavContents /></nav>
        <div className="sidebar-spacer"/>
        <div className="side-note"><span className="side-note-icon"><ShieldCheck size={15}/></span><div><strong>Sandbox local</strong><p>O shell roda em WebAssembly, sem acesso ao seu sistema real.</p></div></div>
        <div className="side-bottom"><a href="https://github.com/rodkisten/shell" target="_blank" rel="noreferrer"><Github size={16}/> GitHub</a><span>v0.1</span></div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs"><button className="mobile-menu-button" aria-label="Abrir menu" onClick={() => setMobileMenu(v=>!v)}><Menu size={20}/></button><span>Workspace</span><span className="slash">/</span><strong>{location.pathname === '/historico' ? 'Histórico' : location.pathname === '/biblioteca' ? 'Biblioteca' : location.pathname === '/linux' ? 'Alpine Linux' : 'Editor'}</strong></div>
          <div className="topbar-right"><span className="privacy-label"><span className="status-light"/> Armazenamento local</span><ManPopover command={inspected} onClose={() => setInspected(null)} onInsert={insert}/><a className="github-small" href="https://github.com/rodkisten/shell" target="_blank" rel="noreferrer" aria-label="GitHub"><Github size={17}/></a></div>
        </header>
        {mobileMenu && <div className="mobile-menu-sheet" onClick={() => setMobileMenu(false)}><NavContents /></div>}
        <main className="main-content">
          <Routes>
            <Route path="/" element={<>
              <div className="page-heading"><div className="heading-top"><span className="eyebrow"><span className="live-dot"/> SHELL PLAYGROUND</span><span className="release-pill">ZSH + WEBASSEMBLY</span><span role="status" aria-live="polite" className="release-pill" title={flowStatus.message ?? "Analisador CFG em Web Worker"}>CFG WASM: {flowStatus.state === "ready" ? "✓ pronto" : flowStatus.state === "loading" ? "⏳ carregando" : flowStatus.state === "error" ? "✕ falhou" : "aguardando"}</span></div>
                <h1>Seu shell, <span>sob controle.</span></h1>
                <p>Escreva, entenda e execute scripts. Tudo em um lugar, sem sair do navegador.</p>
              </div>
              <label className="auto-run-toggle"><input type="checkbox" checked={autoRun} onChange={event => setAutoRun(event.target.checked)} /> Executar automaticamente <span>850 ms após parar de digitar</span></label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <Link to="/linux" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", color: "#ddd", fontSize: 12 }}><Terminal size={15}/> Alpine Linux</Link><button type="button" aria-pressed={sideBySide} onClick={() => setSideBySide(value => !value)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid #34363d', borderRadius: 7, background: '#141519', color: '#ddd', fontSize: 12 }}><ArrowLeftRight size={15}/> {sideBySide ? 'Painéis empilhados' : 'Painéis lado a lado'}</button>
              </div>
              <div className={cn("workspace-layout", sideBySide && "is-split")} style={sideBySide ? { "--editor-share": `${splitRatio}fr`, "--terminal-share": `${100 - splitRatio}fr` } as React.CSSProperties : undefined}>
                <section className="editor-panel" style={sideBySide ? { gridColumn: 1, gridRow: 1 } : undefined}>
                  <div className="panel-header">
                    <div className="panel-tabs"><span className="file-icon"><FileCode2 size={15}/></span><span>script.zsh</span><span className="unsaved-dot" aria-label="Rascunho local"/></div>
                    <div className="panel-header-actions"><label title="Tamanho da fonte do editor" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, flexShrink: 0 }}><span className="editor-font-label">Fonte</span><select aria-label="Tamanho da fonte" value={editorFontSize} onChange={event => setEditorFontSize(Number(event.target.value))} style={{ background: "#141519", color: "#eee", border: "1px solid #34363d", borderRadius: 5, padding: "4px 2px", fontSize: 16, maxWidth: 74 }}>{[9,10,11,12,13,14].map(size => <option key={size} value={size}>{size}px</option>)}</select></label><label title="Quebrar linhas longas" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}><input type="checkbox" checked={editorWordWrap} onChange={event => setEditorWordWrap(event.target.checked)} /> Wrap</label><span className="language-label">Zsh</span><button title="Colar texto" onClick={paste} aria-label="Colar"><Clipboard size={15}/></button><button title="Copiar script" onClick={() => void copy()} aria-label="Copiar"><Copy size={15}/></button><button title="Salvar script" onClick={save} aria-label="Salvar"><Bookmark size={15}/></button></div>
                  </div>
                  <nav className="editor-command-toolbar" aria-label="Ferramentas do editor">
                    <button type="button" onClick={() => { void run(); }} disabled={!!busy}><Play size={15}/> Executar</button>
                    <button type="button" onClick={() => void convert(false)} disabled={!!busy}><WandSparkles size={15}/> Formatar</button>
                    <button type="button" onClick={() => void check()} disabled={!!busy}><ShieldCheck size={15}/> Validar</button>
                    <button type="button" className="editor-command-primary" onClick={() => void explain()} disabled={!!busy}><BookOpen size={15}/> Explicar</button>
                    <button type="button" onClick={() => { setExplorerTab('flow'); setExplorerOpen(true); if (!explanation) void explain(); }} disabled={!!busy}><Activity size={15}/> Fluxo</button>
                  </nav>
                  <div className="editor-inner" style={{ height: editorHeight }}><ShellEditor ref={editor} code={script} fontSize={editorFontSize} wordWrap={editorWordWrap} onChange={change} onCursor={setCursor} onInspect={setInspected} onSemanticInspect={setSemanticSelection} onRun={() => { void run(); }}/></div>
                  <CommandHelp help={quickHelp} onManual={setInspected}/>
                  {semanticSelection && <section className="semantic-selection-card" aria-label="Explicação do trecho selecionado" aria-live="polite">
                    <div className="semantic-selection-head">
                      <strong>{semanticSelection.title}</strong>
                      <button type="button" aria-label="Fechar explicação" onClick={() => setSemanticSelection(null)}><X size={17}/></button>
                    </div>
                    <button className="semantic-selection-target" type="button" onClick={() => editor.current?.reveal(semanticSelection.from, semanticSelection.to)} title="Selecionar trecho no editor"><code>{semanticSelection.text}</code> <span aria-hidden="true">↗</span></button>
                    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{semanticSelection.description.replace(/\\n/g, '\n')}</p>
                    {semanticSelection.example && <pre>{semanticSelection.example}</pre>}
                    <small>Fonte: {semanticSelection.source === 'cli-spec' ? 'especificação CLI local' : semanticSelection.source === 'shell' ? 'operador shell' : 'catálogo local'}. Análise parcial.</small>
                  </section>}
                  <div className="pane-resizer" role="separator" aria-label="Redimensionar editor" aria-orientation="horizontal" onPointerDown={event => resize('editor', event)} />
                  <div className="editor-keyboard">{shortcuts.map((item,i) => <button key={i} onMouseDown={e => e.preventDefault()} onClick={() => insert(item.value)}>{item.label}</button>)}</div>
                  <div className="editor-footer"><div className="footer-meta"><span><span className="status-light"/> Pronto</span><span>{script.split('\n').length} linhas</span><span>UTF-8</span></div><span>⌘ ↵ para executar</span></div>
                </section>
              {sideBySide && <div className="split-divider" role="separator" aria-label="Redimensionar painéis lado a lado" aria-orientation="vertical" onPointerDown={splitResize} style={{ gridColumn: 2, gridRow: 1, alignSelf: 'stretch', cursor: 'col-resize', touchAction: 'none', background: '#292b30', borderRadius: 6, minHeight: 220 }} />}
              <section className="terminal-panel" style={sideBySide ? { gridColumn: 3, gridRow: 1, marginTop: 0 } : undefined}>
                <button className="terminal-heading" onClick={() => setShowOutput(v => !v)} aria-expanded={showOutput}><span><Terminal size={17}/> Terminal <span className="terminal-secondary">/ sandbox</span></span><div><span className="mini-status"><span className="status-light"/> WASM</span><ChevronDown className={cn(!showOutput && 'rotate')} size={16}/></div></button>
                {showOutput && <><div className="terminal-body" style={{ height: terminalHeight, overflow: 'auto' }}>
                  {output.length ? output.map(item => <div className="terminal-run" key={item.id}><div className="terminal-prompt"><span>❯</span> {item.script.split('\n').find(line => line.trim() && !line.startsWith('#')) || 'script.zsh'}</div>{item.stdout && <pre>{item.stdout}</pre>}{item.stderr && <pre className="terminal-error">{item.stderr}</pre>}<div className={cn('terminal-exit',item.exitCode !== 0 && 'bad')}>Processo finalizado com código {item.exitCode} · {new Date(item.time).toLocaleTimeString('pt-BR')}</div></div>) :
                    <div className="terminal-empty"><span className="terminal-prompt"><span>❯</span> shellconductor@browser ~ %</span><p>O terminal está pronto. Execute seu script para ver a saída aqui.</p><p className="muted">Sistema de arquivos virtual, sem acesso ao disco ou rede do iPhone.</p></div>}</div>
                  <div className="pane-resizer" role="separator" aria-label="Redimensionar terminal" aria-orientation="horizontal" onPointerDown={event => resize('terminal', event)} />
                  <div className="terminal-bottom"><span><ShieldCheck size={13}/> Ambiente isolado</span><div><button onClick={async () => { try { await resetShell(); notify('Sandbox zerado.'); } catch { notify('Não foi possível reiniciar.'); } }}><RotateCcw size={13}/> Reiniciar</button><button onClick={() => setOutput([])}><Trash2 size={13}/> Limpar saída</button></div></div></>}
              </section>
                <section className="actions-panel" style={sideBySide ? { gridColumn: '1 / -1', gridRow: 2 } : undefined}>
                  <div className="toolbox-title"><span className="eyebrow">FERRAMENTAS</span><h3>Ações rápidas <Sparkles size={15}/></h3></div>
                  <div className="tool-primary">
                    <Button onClick={() => { void run(); }} disabled={!!busy} className="run-button">{busy === 'run' ? <LoaderCircle className="spin" size={16}/> : <Play size={16} fill="currentColor" />} Executar no sandbox</Button>
                    {busy === 'run' && <Button onClick={() => { cancelShell(); setBusy(null); }} variant="outline" size="sm"><Square size={13}/> Interromper</Button>}
                  </div>
                  <div className="tool-group">
                    <button className="tool-action" onClick={() => void convert(false)} disabled={!!busy}><span className="tool-icon"><WandSparkles size={17}/></span><span><strong>Formatar script</strong><small>sh-syntax • Zsh experimental</small></span><span className="tool-kbd">⌘ ⇧ F</span></button>
                    <button className="tool-action" onClick={() => void check()} disabled={!!busy}><span className="tool-icon"><ShieldCheck size={17}/></span><span><strong>Validar e diagnosticar</strong><small>sh-syntax • análise sintática</small></span><span className="arrow-small">↗</span></button>
                    <button className="tool-action" onClick={() => void explain()} disabled={!!busy}><span className="tool-icon"><BookOpen size={17}/></span><span><strong>Explicar comando</strong><small>Passo a passo local · sem IA</small></span><span className="arrow-small">↗</span></button>
                  </div>
                  <div className="toolbox-divider"/>
                  <span className="eyebrow">CONVERSOR</span>
                  <div className="convert-buttons"><Button variant="outline" size="sm" onClick={() => void convert(true)} disabled={!!busy}><ArrowLeftRight size={14}/> Uma linha</Button><Button variant="outline" size="sm" onClick={() => void convert(false)} disabled={!!busy}><Menu size={14}/> Multilinha</Button></div>
                  <div className="toolbox-divider"/>
                  <div className="toolbox-section-title"><span className="eyebrow">SUGESTÕES CONTEXTUAIS</span><Activity size={15}/></div>
                  <div className="suggestions-list">{hints.length ? hints.slice(0, 4).map((hint,i) => <button key={hint.label+i} className="hint-item" onMouseDown={e => e.preventDefault()} onClick={() => { if (hint.kind === 'command') setInspected(hint.label); insert(hint.example); }}>
                    <div className="hint-head"><code>{hint.label}</code><span>{hint.title}</span></div><p>{hint.description}</p><small>{hint.example}</small></button>) : <p className="muted">Digite um comando para ver exemplos e opções.</p>}</div>
                  <div className="toolbox-divider"/>
                  <button className="snippet-toggle" onClick={() => setShowSnippets(v => !v)}><span><Code2 size={15}/> Blocos prontos</span><ChevronDown className={cn(showSnippets && 'rotate')} size={15}/></button>
                  {showSnippets && <div className="snippet-compact">{SNIPPETS.slice(0, 8).map(s => <button key={s.id} onClick={() => insert(s.code)}>{s.name}<span>+</span></button>)}</div>}
                </section>
              </div>

              {busy === 'check' && <p className="inline-status"><LoaderCircle className="spin" size={14}/> Analisando com ShellCheck…</p>}
              {!!findings.length && <section className="diagnostic-panel">
                <div className="subpanel-heading"><h3><CircleAlert size={17}/> Diagnósticos <span className="count-pill">{findings.length}</span></h3><Button variant="outline" size="sm" onClick={fix}><WandSparkles size={14}/> Aplicar correções possíveis</Button></div>
                {findings.map((finding,i) => <div className="diagnostic-item" key={i}><span className={cn('severity',finding.level)}>{finding.level}</span><div><strong>SC{finding.code} <span>L{finding.line}:{finding.column}</span></strong><p>{finding.message}</p><a href={'https://www.shellcheck.net/wiki/SC'+finding.code} target="_blank" rel="noreferrer">Entenda esse diagnóstico ↗</a></div></div>)}
              </section>}
              <WorkspacePanel />
              <div className="footer-advice"><Info size={15}/><span>O terminal executa Zsh em WebAssembly com filesystem virtual persistente. <strong>Não executa comandos no seu iPhone, servidor ou Codespace.</strong> Requisições HTTP externas não são habilitadas no sandbox.</span></div>
            </>} />
            <Route path="/linux" element={<LinuxPanel />} />
            <Route path="/biblioteca" element={<ReferencePanel onInsert={insert} onInspect={setInspected}/>} />
            <Route path="/historico" element={<HistoryPanel revision={historyRevision} onRestore={restore} notify={notify}/>} />
            <Route path="*" element={<div className="empty-state"><h2>Página não encontrada</h2><Link to="/">Voltar ao editor</Link></div>} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navegação principal">
        <NavLink to="/" end className={({isActive}) => cn(isActive && 'active')}><Code2 size={20}/><span>Editor</span></NavLink>
        <NavLink to="/biblioteca" className={({isActive}) => cn(isActive && 'active')}><BookOpen size={20}/><span>Biblioteca</span></NavLink>
        <NavLink to="/linux" className={({isActive}) => cn(isActive && 'active')}><Terminal size={20}/><span>Linux</span></NavLink>
        <NavLink to="/touch" className={({isActive}) => cn(isActive && 'active')}><Terminal size={20}/><span>Touch</span></NavLink>
        <NavLink to="/historico" className={({isActive}) => cn(isActive && 'active')}><Clock3 size={20}/><span>Histórico</span></NavLink>
      </nav>
      {toast && <div role="status" className="toast"><CircleCheck size={16}/> {toast}<button onClick={() => setToast('')} aria-label="Fechar aviso"><X size={14}/></button></div>}
              {explorerOpen && <section className="explain-panel explorer-dock" role="dialog" aria-label="Explorador de análise" aria-modal="false"><div className="subpanel-heading"><h3><BookOpen size={17}/> Explicação contextual</h3><button className="subtle-icon" onClick={() => setExplorerOpen(false)} title="Fechar"><X size={17}/></button></div><div className="explorer-tabs" role="tablist" aria-label="Visualização da análise">
                {(['flow','ast','explanation'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={explorerTab === tab} onClick={() => setExplorerTab(tab)}>{tab === 'flow' ? 'Fluxo' : tab === 'ast' ? 'AST' : 'Explicação'}</button>)}
              </div>
              {explorerTab !== 'explanation' && astNodes.length > 0 && <ExecutionExplorer view={explorerTab} analysis={analyzeShell(script, astNodes, analysisTokens)} flow={flowResult} flowStatus={flowStatus} flowError={flowError} source={script} onReveal={(from, to) => editor.current?.reveal(from, to)} />}
              {explorerTab === 'explanation' && <pre className="explorer-explanation-text">{explanation?.replace(/\\\\n/g, '\n') ?? 'Analisando…'}</pre>}<p>Fonte: catálogo local e parser sh-syntax. Nenhum código é enviado para análise remota.</p></section>}
    </div>
  );
}
