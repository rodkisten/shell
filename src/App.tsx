import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  BookOpen,
  Bookmark,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  FileText,
  Github,
  Info,
  LoaderCircle,
  Menu,
  Play,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';

import { CommandHelp } from './components/CommandHelp';
import { ExecutionExplorer } from './components/ExecutionExplorer';
import { HistoryPanel } from './components/HistoryPanel';
import { LinuxPanel } from './components/LinuxPanel';
import { ManPopover } from './components/ManPopover';
import { ReferencePanel } from './components/ReferencePanel';
import { ShellEditor, type ShellEditorHandle } from './components/ShellEditor';
import { Button } from './components/ui/button';
import { WorkspacePanel } from './components/WorkspacePanel';
import './components/workspace.css';

import { commandHelp, type CommandHelpModel } from './lib/command-help';
import { SNIPPETS } from './lib/commands';
import { formatShell } from './lib/format';
import { buildSemanticFlow } from './lib/semantic-flow';
import { explainKnownShellTokensFromSnapshot, type SemanticToken } from './lib/semantic-shell';
import { analyzeShell } from './lib/shell-analysis';
import { inspectShellSnapshot, type ShellAstNode } from './lib/shell-ast';
import {
  analyzeShellWasm,
  initializeShellFlowWasm,
  subscribeShellFlowStatus,
  type FlowWasmStatus,
  type WasmFlowResult,
} from './lib/shell-flow-wasm';
import { parseShellSnapshot } from './lib/shell-parser';
import { applyAvailableFixes, checkShell, type Finding } from './lib/shellcheck';
import { getDraft, saveDraft, saveEntry } from './lib/storage';
import { contextualHints, type Hint } from './lib/suggestions';
import { cancelShell, executeScript, resetShell } from './lib/terminal';
import { cn } from './lib/utils';

/* ============================================================================
 * [EXTRAIR PARA UTILITÁRIO: src/lib/storage-prefs.ts & src/constants/editor.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - Constantes de configuração inicial (`STARTER_SCRIPT`, `KEYBOARD_SHORTCUTS`,
 *   chaves de `localStorage` e limites de tamanho de dock/fonte/painéis).
 * - Helpers seguros de leitura/escrita no `localStorage` (`readBoolPref`,
 *   `readClampedNumberPref`, `writePref`) para evitar blocos `try/catch`
 *   repetidos e falhas no modo privado do Safari.
 * - Tipos compartilhados de UI (`TerminalOutput`, `BusyOperation`, `ExplorerTab`,
 *   `DockPosition`).
 *
 * Contratos a preservar:
 * - Todas as chaves `shellconductor:*` no `localStorage`.
 * - A estrutura `{ id, script, stdout, stderr, exitCode, time }` de saída.
 * ============================================================================ */

type TerminalOutput = {
  id: number;
  script: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  time: number;
};

type BusyOperation = 'format' | 'check' | 'run' | 'explain' | null;
type ExplorerTab = 'flow' | 'ast' | 'explanation';
type DockPosition = 'left' | 'right';

const STORAGE_KEYS = {
  dockSize: 'shellconductor:dock-size',
  dockCollapsed: 'shellconductor:dock-collapsed',
  dockPosition: 'shellconductor:dock-position',
  sideBySide: 'shellconductor:side-by-side',
  splitRatio: 'shellconductor:split-ratio',
  autoRun: 'shellconductor:auto-run',
  autoCheck: 'shellconductor:auto-check',
  autoFormat: 'shellconductor:auto-format',
  editorFontSize: 'shellconductor:editor-font-size',
  editorWordWrap: 'shellconductor:editor-word-wrap',
  terminalHeight: 'shellconductor:terminal-height',
  editorHeight: 'shellconductor:editor-height',
} as const;

const STARTER_SCRIPT = `#!/usr/bin/env zsh
# Bem-vindo ao ShellConductor 👋
set -euo pipefail

nome="mundo"
for numero in 1 2 3; do
  printf "Olá, %s! Iteração %s\\n" "$nome" "$numero"
done
`;

const KEYBOARD_SHORTCUTS = [
  { label: 'Tab', value: '  ' },
  { label: '|', value: ' | ' },
  { label: '&&', value: ' && ' },
  { label: '$()', value: '$()' },
  { label: '${}', value: '${}' },
  { label: '""', value: '""' },
  { label: 'if', value: 'if [[  ]]; then\n  \nfi' },
  { label: 'for', value: 'for item in ; do\n  \ndone' },
] as const;

const DOCK_MIN_SIZE = 25;
const DOCK_MAX_SIZE = 80;
const DOCK_DEFAULT_SIZE = 47;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumberPref(key: string, fallback: number, min?: number, max?: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return fallback;
    return min !== undefined && max !== undefined ? clampNumber(parsed, min, max) : parsed;
  } catch {
    return fallback;
  }
}

function readBooleanPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage can be unavailable in private mode (e.g., Safari). */
  }
}

function resolvePageTitle(pathname: string): string {
  switch (pathname) {
    case '/historico':
      return 'Histórico';
    case '/biblioteca':
      return 'Biblioteca';
    case '/linux':
      return 'Alpine Linux';
    default:
      return 'Editor';
  }
}

/* ============================================================================
 * [EXTRAIR PARA COMPONENTE: src/components/layout/SidebarNav.tsx]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `NavContents` (e futuramente o `<aside className="sidebar">` + `.mobile-nav`).
 * - Lista declarativa de itens de navegação interna e externa para evitar
 *   duplicação entre `NavContents` e a barra inferior `.mobile-nav`.
 *
 * Contratos a preservar:
 * - Rotas exatas: `/`, `/biblioteca`, `/linux`, `/touch`, `/historico`.
 * - Classes CSS: `nav-group-label`, `side-link`, `active`, `shortcut-hint`,
 *   `external-mini`.
 * ============================================================================ */

function NavContents() {
  return (
    <>
      <div className="nav-group-label">WORKSPACE</div>
      <NavLink end to="/" className={({ isActive }) => cn('side-link', isActive && 'active')}>
        <Code2 size={17} /> Editor <span className="shortcut-hint">⌘ 1</span>
      </NavLink>
      <NavLink to="/biblioteca" className={({ isActive }) => cn('side-link', isActive && 'active')}>
        <BookOpen size={17} /> Biblioteca
      </NavLink>
      <NavLink to="/linux" className={({ isActive }) => cn('side-link', isActive && 'active')}>
        <Terminal size={17} /> Alpine Linux <span className="shortcut-hint">v86</span>
      </NavLink>
      <NavLink to="/touch" className={({ isActive }) => cn('side-link', isActive && 'active')}>
        <Terminal size={17} /> Touch Commands
      </NavLink>
      <NavLink to="/historico" className={({ isActive }) => cn('side-link', isActive && 'active')}>
        <Clock3 size={17} /> Histórico
      </NavLink>

      <div className="nav-group-label second">REFERÊNCIA</div>
      <a className="side-link" href="https://www.shellcheck.net/wiki/" target="_blank" rel="noreferrer">
        <ShieldCheck size={17} /> ShellCheck <ArrowDownToLine className="external-mini" size={13} />
      </a>
      <a className="side-link" href="https://www.mankier.com/" target="_blank" rel="noreferrer">
        <FileText size={17} /> Man pages <ArrowDownToLine className="external-mini" size={13} />
      </a>
    </>
  );
}

export function App() {
  const navigation = useNavigate();
  const location = useLocation();

  /* ==========================================================================
   * [EXTRAIR PARA HOOK: src/hooks/useToast.ts]
   * --------------------------------------------------------------------------
   * O que mover:
   * - Estado `toast`, `noticeTimer`, callback `notify` e `clearToast`.
   * - Pode evoluir para um `<ToastBanner message={toast} onClose={clearToast} />`.
   * ========================================================================== */
  const [toast, setToast] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(''), 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  /* ==========================================================================
   * [EXTRAIR PARA HOOK: src/hooks/useShellDocument.ts]
   * --------------------------------------------------------------------------
   * O que mover:
   * - Estado do documento ativo (`script`, `cursor`, `hydrated`), carregamento
   *   inicial via `getDraft()` e autosave debounced via `saveDraft()`.
   * - Ações de manipulação de texto (`change`, `insert`, `restore`, `copy`,
   *   `paste`, `save`) e revisão de histórico (`historyRevision`).
   *
   * Contratos a preservar:
   * - Ref `editor` (`ShellEditorHandle`) para `.insert()`, `.focus()` e `.reveal()`.
   * - Incremento de `analysisRevision` ao alterar o código para invalidar
   *   análises assíncronas em voo.
   * ========================================================================== */
  const [script, setScript] = useState(STARTER_SCRIPT);
  const [cursor, setCursor] = useState(STARTER_SCRIPT.length);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [busy, setBusy] = useState<BusyOperation>(null);

  const editor = useRef<ShellEditorHandle>(null);
  const hydrated = useRef(false);
  const analysisRevision = useRef(0);

  useEffect(() => {
    let active = true;
    getDraft()
      .then((saved) => {
        if (active && saved) setScript(saved);
      })
      .catch(() => {
        /* Private Safari sessions may block IndexedDB. */
      })
      .finally(() => {
        hydrated.current = true;
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      void saveDraft(script).catch(() => undefined);
    }, 450);
    return () => clearTimeout(timer);
  }, [script]);

  /* ==========================================================================
   * [EXTRAIR PARA HOOK: src/hooks/useShellAnalysis.ts]
   * --------------------------------------------------------------------------
   * O que mover:
   * - Estados de inspeção, lint, AST, fluxo CFG/WASM e ajuda contextual:
   *   `inspected`, `semanticSelection`, `quickHelp`, `findings`, `explanation`,
   *   `astNodes`, `analysisTokens`, `flowResult`, `flowError`, `flowStatus`,
   *   `hints`.
   * - Efeitos de inicialização do WASM (`initializeShellFlowWasm`), hints por
   *   cursor (`contextualHints`, `commandHelp`), auto-check e auto-format.
   * - Funções `convert`, `check`, `fix` e `explain`.
   *
   * Contratos a preservar:
   * - Nunca enviar o código do usuário para endpoints remotos (`parseShellSnapshot`
   *   e `analyzeShellWasm` rodam localmente).
   * - `analysisRevision` garante descarte de resultados obsoletos em race conditions.
   * ========================================================================== */
  const [inspected, setInspected] = useState<string | null>(null);
  const [semanticSelection, setSemanticSelection] = useState<SemanticToken | null>(null);
  const [quickHelp, setQuickHelp] = useState<CommandHelpModel | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [astNodes, setAstNodes] = useState<ShellAstNode[]>([]);
  const [analysisTokens, setAnalysisTokens] = useState<SemanticToken[]>([]);
  const [flowResult, setFlowResult] = useState<WasmFlowResult | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<FlowWasmStatus>({ state: 'idle' });
  const [hints, setHints] = useState<Hint[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeShellFlowStatus(setFlowStatus);
    initializeShellFlowWasm();
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    void contextualHints(script, cursor).then((next) => {
      if (active) setHints(next);
    });
    return () => {
      active = false;
    };
  }, [script, cursor]);

  useEffect(() => {
    let active = true;
    void commandHelp(script, cursor)
      .then((next) => {
        if (active) setQuickHelp(next);
      })
      .catch(() => {
        if (active) setQuickHelp(null);
      });
    return () => {
      active = false;
    };
  }, [script, cursor]);

  const change = useCallback((text: string) => {
    analysisRevision.current += 1;
    setScript(text);
    setFindings([]);
    setExplanation(null);
    setAstNodes([]);
    setAnalysisTokens([]);
    setFlowResult(null);
    setFlowError(null);
    setSemanticSelection(null);
  }, []);

  const insert = useCallback(
    (text: string) => {
      navigation('/');
      // Editor may not be mounted yet when opened from the library.
      if (location.pathname !== '/') {
        setScript((previous) => (previous.trim() ? `${previous.trimEnd()}\n\n${text}` : text));
      } else {
        editor.current?.insert(text);
      }
    },
    [location.pathname, navigation],
  );

  const restore = useCallback(
    (text: string) => {
      setScript(text);
      setCursor(text.length);
      navigation('/');
      notify('Script restaurado no editor.');
    },
    [navigation, notify],
  );

  /* ==========================================================================
   * [EXTRAIR PARA HOOK: src/hooks/useWorkspaceLayout.ts]
   * --------------------------------------------------------------------------
   * O que mover:
   * - Preferências visuais persistidas (`sideBySide`, `splitRatio`,
   *   `editorFontSize`, `editorWordWrap`, `editorHeight`, `terminalHeight`,
   *   `showSnippets`, `showOutput`, `mobileMenu`) e automações (`autoRun`,
   *   `autoCheck`, `autoFormat`).
   * - Handlers de redimensionamento por Pointer Events (`splitResize` e `resize`).
   *
   * Contratos a preservar:
   * - Variáveis CSS inline `--editor-share` e `--terminal-share`.
   * - Limites de altura `[150, 1100]` px e proporção `[25, 75]` %.
   * ========================================================================== */
  const [showSnippets, setShowSnippets] = useState(false);
  const [showOutput, setShowOutput] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);

  const [sideBySide, setSideBySide] = useState(() => readBooleanPref(STORAGE_KEYS.sideBySide, false));
  const [splitRatio, setSplitRatio] = useState(() => readNumberPref(STORAGE_KEYS.splitRatio, 50));
  const [autoRun, setAutoRun] = useState(() => readBooleanPref(STORAGE_KEYS.autoRun, false));
  const [autoCheck, setAutoCheck] = useState(() => readBooleanPref(STORAGE_KEYS.autoCheck, false));
  const [autoFormat, setAutoFormat] = useState(() => readBooleanPref(STORAGE_KEYS.autoFormat, false));
  const [editorFontSize, setEditorFontSize] = useState(() => readNumberPref(STORAGE_KEYS.editorFontSize, 11, 9, 14));
  const [editorWordWrap, setEditorWordWrap] = useState(() => readBooleanPref(STORAGE_KEYS.editorWordWrap, true));
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(() => readNumberPref(STORAGE_KEYS.terminalHeight, 260));

  useEffect(() => {
    writePref(STORAGE_KEYS.autoCheck, String(autoCheck));
    writePref(STORAGE_KEYS.autoFormat, String(autoFormat));
  }, [autoCheck, autoFormat]);

  useEffect(() => writePref(STORAGE_KEYS.editorFontSize, String(editorFontSize)), [editorFontSize]);
  useEffect(() => writePref(STORAGE_KEYS.editorWordWrap, String(editorWordWrap)), [editorWordWrap]);
  useEffect(() => writePref(STORAGE_KEYS.sideBySide, String(sideBySide)), [sideBySide]);
  useEffect(() => writePref(STORAGE_KEYS.splitRatio, String(splitRatio)), [splitRatio]);

  useEffect(() => {
    if (!autoCheck || !script.trim()) return;
    let cancelled = false;
    const revision = analysisRevision.current;
    const timer = setTimeout(() => {
      void checkShell(script)
        .then((diagnostics) => {
          if (!cancelled && revision === analysisRevision.current) setFindings(diagnostics);
        })
        .catch(() => {
          /* Keep manual validation available when WASM is unavailable. */
        });
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [script, autoCheck]);

  useEffect(() => {
    if (!autoFormat || !script.trim()) return;
    let cancelled = false;
    const revision = analysisRevision.current;
    const timer = setTimeout(() => {
      void formatShell(script, false)
        .then((formatted) => {
          if (!cancelled && revision === analysisRevision.current && formatted && formatted !== script) {
            change(formatted);
          }
        })
        .catch(() => {
          /* Do not modify incomplete or invalid shell input. */
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [script, autoFormat, change]);

  /* ==========================================================================
   * [EXTRAIR PARA HOOK: src/hooks/useSandboxRunner.ts]
   * --------------------------------------------------------------------------
   * O que mover:
   * - Estado `output`, refs `runningRef`, `pendingAutoRun`, `runScriptRef`,
   *   `runRevision` e lógica de fila de auto-execução.
   * - Funções `runScript`, `run` e `clearOutput` / `resetSandbox`.
   *
   * Contratos a preservar:
   * - Limite máximo de 20 execuções no buffer `output`.
   * - Debounce de 850ms para `autoRun` e fila única (`pendingAutoRun`) caso o
   *   usuário continue digitando enquanto o WASM está ocupado.
   * ========================================================================== */
  const [output, setOutput] = useState<Output[]>([]);
  const [runRevision, setRunRevision] = useState(0);
  const runningRef = useRef(false);
  const pendingAutoRun = useRef<string | null>(null);
  const runScriptRef = useRef<(source: string, automatic?: boolean) => Promise<void>>(async () => undefined);

  const runScript = useCallback(
    async (source: string, automatic = false) => {
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
        setOutput((current) => [{ ...result, script: source, id: now, time: now }, ...current].slice(0, 20));

        if (!automatic) {
          try {
            await saveEntry(source, 'run', result.stdout + result.stderr);
            setHistoryRevision((n) => n + 1);
          } catch {
            /* Execution works without history storage. */
          }
          notify(result.exitCode === 0 ? 'Executado no sandbox WASM.' : `Finalizado com código ${result.exitCode}.`);
        }
      } catch (error) {
        const now = Date.now();
        setOutput((current) =>
          [
            {
              id: now,
              time: now,
              script: source,
              stdout: '',
              stderr: error instanceof Error ? error.message : String(error),
              exitCode: 1,
            },
            ...current,
          ].slice(0, 20),
        );
        if (!automatic) notify('Falha na execução. Veja a saída.');
      } finally {
        runningRef.current = false;
        setBusy(null);
        setRunRevision((n) => n + 1);
      }
    },
    [notify],
  );

  runScriptRef.current = runScript;

  const run = useCallback(() => {
    pendingAutoRun.current = null;
    void runScriptRef.current(script);
  }, [script]);

  useEffect(() => {
    writePref(STORAGE_KEYS.autoRun, String(autoRun));
    if (!autoRun) {
      pendingAutoRun.current = null;
      return;
    }
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

  /* ==========================================================================
   * [EXTRAIR PARA HOOK: src/hooks/useExplorerDock.ts]
   * --------------------------------------------------------------------------
   * O que mover:
   * - Estados `explorerTab`, `explorerOpen`, `dockSize`, `dockCollapsed`,
   *   `dockPosition` e ref `dockDrag`.
   * - Handlers de arraste e acessibilidade por teclado (`resizeDock`, `moveDock`,
   *   `finishDock`, `handleDockKeyDown`) e persistência no `localStorage`.
   *
   * Contratos a preservar:
   * - Limites `[25, 80]` % e padrão `47` %.
   * - Suporte a orientação horizontal no mobile (`max-width: 700px`) e vertical
   *   no desktop (`left` / `right`).
   * ========================================================================== */
  const [explorerTab, setExplorerTab] = useState<ExplorerTab>('flow');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [dockSize, setDockSize] = useState(() =>
    readNumberPref(STORAGE_KEYS.dockSize, DOCK_DEFAULT_SIZE, DOCK_MIN_SIZE, DOCK_MAX_SIZE),
  );
  const [dockCollapsed, setDockCollapsed] = useState(() => readBooleanPref(STORAGE_KEYS.dockCollapsed, false));
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.dockPosition) === 'left' ? 'left' : 'right';
    } catch {
      return 'right';
    }
  });
  const dockDrag = useRef<{ pointerId: number; start: number; size: number; mobile: boolean } | null>(null);

  useEffect(() => {
    writePref(STORAGE_KEYS.dockCollapsed, String(dockCollapsed));
    writePref(STORAGE_KEYS.dockPosition, dockPosition);
  }, [dockCollapsed, dockPosition]);

  useEffect(() => {
    writePref(STORAGE_KEYS.dockSize, String(Math.round(dockSize)));
  }, [dockSize]);

  const resizeDock = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const mobile = window.matchMedia('(max-width: 700px)').matches;
    event.preventDefault();
    dockDrag.current = {
      pointerId: event.pointerId,
      start: mobile ? event.clientY : event.clientX,
      size: dockSize,
      mobile,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDock = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dockDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dimension = drag.mobile ? (window.visualViewport?.height ?? window.innerHeight) : window.innerWidth;
    const direction = drag.mobile || dockPosition === 'right' ? 1 : -1;
    const delta = ((direction * (drag.start - (drag.mobile ? event.clientY : event.clientX))) / Math.max(1, dimension)) * 100;
    setDockSize(clampNumber(drag.size + delta, DOCK_MIN_SIZE, DOCK_MAX_SIZE));
  };

  const finishDock = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dockDrag.current?.pointerId !== event.pointerId) return;
    dockDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleDockResizerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (dockCollapsed) return;
    if (event.key === 'Home') {
      event.preventDefault();
      setDockSize(DOCK_MIN_SIZE);
    } else if (event.key === 'End') {
      event.preventDefault();
      setDockSize(DOCK_MAX_SIZE);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      setDockSize((v) => Math.min(DOCK_MAX_SIZE, v + 5));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setDockSize((v) => Math.max(DOCK_MIN_SIZE, v - 5));
    }
  };

  /* ==========================================================================
   * AÇÕES DO EDITOR E FERRAMENTAS DE ANÁLISE
   * (Candidatas a permanecerem nos hooks `useShellDocument` e `useShellAnalysis`)
   * ========================================================================== */
  const copy = async (text = script) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copiado para a área de transferência.');
    } catch {
      notify('Não foi possível copiar. Selecione o texto manualmente.');
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return notify('A área de transferência está vazia.');
      change(text);
      notify('Script colado.');
    } catch {
      notify('Use Colar do teclado do Safari para permitir acesso.');
      editor.current?.focus();
    }
  };

  const convert = async (singleLine: boolean) => {
    setBusy('format');
    try {
      const formatted = await formatShell(script, singleLine);
      if (!formatted) return notify('Escreva um comando primeiro.');
      change(formatted);
      if (singleLine && formatted.includes('\n')) {
        notify('Este script possui estruturas que precisam de múltiplas linhas para manter a sintaxe.');
      } else {
        notify(singleLine ? 'Convertido para uma linha pelo sh-syntax.' : 'Formatado pelo sh-syntax.');
      }
    } catch (error) {
      notify(`Erro de sintaxe ou formatação: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('check');
    try {
      const diagnostics = await checkShell(script);
      setFindings(diagnostics);
      notify(
        diagnostics.length
          ? `${diagnostics.length} aviso(s) de sintaxe.`
          : 'Parser Zsh: nenhum problema sintático encontrado.',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Erro no parser Zsh.');
    } finally {
      setBusy(null);
    }
  };

  const fix = () => {
    const result = applyAvailableFixes(script, findings);
    if (result.count) {
      change(result.code);
      notify(`${result.count} correção(ões) automática(s) aplicada(s). Valide novamente.`);
    } else {
      notify('Nenhuma correção segura automática. Consulte as dicas abaixo.');
    }
  };

  const save = async () => {
    if (!script.trim()) return notify('O editor está vazio.');
    try {
      await saveEntry(script, 'save');
      setHistoryRevision((n) => n + 1);
      notify('Script salvo no IndexedDB deste dispositivo.');
    } catch {
      notify('IndexedDB indisponível neste navegador.');
    }
  };

  const explain = useCallback(
    async (preserveTab = false) => {
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
        setFlowResult(buildSemanticFlow(snapshot));
        setFlowError(null);

        void analyzeShellWasm(script)
          .then((result) => {
            const hasCompoundControlFlow = overview.nodes.some(
              (node) =>
                node.kind === 'BinaryCmd' ||
                node.kind === 'IfClause' ||
                node.kind === 'ForClause' ||
                node.kind === 'WhileClause' ||
                node.kind === 'CaseClause',
            );
            if (revision === analysisRevision.current && !hasCompoundControlFlow) {
              setFlowResult(result);
            }
          })
          .catch((error) => {
            if (revision === analysisRevision.current) {
              setFlowError(error instanceof Error ? error.message : String(error));
            }
          });

        const steps = tokens.map(
          (token, index) =>
            `${index + 1}. ${token.text} · ${token.title}\n   ${token.description}${token.example ? `\n   Exemplo: ${token.example}` : ''}`,
        );

        setExplanation(
          steps.length
            ? [
                'AST real (sh-syntax / mvdan)',
                `${overview.navigableCount}/${overview.count} nós com posição verificável`,
                ...overview.lines,
                overview.truncated ? '… árvore truncada para proteger o desempenho no celular.' : '',
                '',
                'Análise semântica parcial (catálogo + operadores)',
                '',
                ...steps,
                '',
                'A AST é estrutural; efeitos de expansões dinâmicas e comandos externos não são inferidos.',
              ].join('\n')
            : [
                'AST real (sh-syntax / mvdan)',
                ...overview.lines,
                '',
                'Nenhum comando reconhecido pelo catálogo semântico local.',
              ].join('\n'),
        );
      } catch (error) {
        if (revision !== analysisRevision.current) return;
        setAstNodes([]);
        setAnalysisTokens([]);
        setExplanation(`Não foi possível analisar a sintaxe Zsh: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (revision === analysisRevision.current) setBusy(null);
      }
    },
    [notify, script],
  );

  useEffect(() => {
    if (!explorerOpen || !explanation) return;
    const timer = window.setTimeout(() => {
      void explain(true);
    }, 450);
    return () => window.clearTimeout(timer);
    // Recompute only when source changes while dock is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, explorerOpen]);

  const splitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const parent = element.parentElement;
    if (!parent) return;

    element.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const bounds = parent.getBoundingClientRect();
      setSplitRatio(clampNumber(((e.clientX - bounds.left) / Math.max(1, bounds.width)) * 100, 25, 75));
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

  const resize = (target: 'editor' | 'terminal', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = event.clientY;
    const initial =
      target === 'editor'
        ? (editorHeight ?? document.querySelector('.editor-inner')?.getBoundingClientRect().height ?? 52)
        : terminalHeight;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => {
      const height = clampNumber(initial + e.clientY - origin, 150, 1100);
      if (target === 'editor') setEditorHeight(height);
      else setTerminalHeight(height);
    };
    const finish = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
      const selector = target === 'editor' ? '.editor-inner' : '.terminal-body';
      const storageKey = target === 'editor' ? STORAGE_KEYS.editorHeight : STORAGE_KEYS.terminalHeight;
      const currentHeight = document.querySelector(selector)?.getBoundingClientRect().height;
      if (currentHeight) writePref(storageKey, String(Math.round(currentHeight)));
    };

    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
  };

  /* ==========================================================================
   * VALORES DERIVADOS PARA RENDERIZAÇÃO
   * ========================================================================== */
  const scriptLines = useMemo(() => script.split('\n'), [script]);
  const autoEditorLines = Math.max(2, scriptLines.length);

  const shellAnalysis = useMemo(() => {
    if (explorerTab === 'explanation' || astNodes.length === 0) return null;
    return analyzeShell(script, astNodes, analysisTokens);
  }, [explorerTab, astNodes, script, analysisTokens]);

  const isMobileViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;

  const mainColumnStyle = explorerOpen
    ? ({
        '--dock-size': `${dockSize}%`,
        '--explorer-reserved-width': `${dockSize}vw`,
      } as CSSProperties)
    : undefined;

  const workspaceLayoutStyle = sideBySide
    ? ({
        '--editor-share': `${splitRatio}fr`,
        '--terminal-share': `${100 - splitRatio}fr`,
      } as CSSProperties)
    : undefined;

  /* ==========================================================================
   * [EXTRAIR PARA COMPONENTES DE PÁGINA E SHELL]
   * --------------------------------------------------------------------------
   * O JSX abaixo pode ser fatiado em componentes puros/controlados sem alterar
   * nenhuma classe CSS ou comportamento:
   *
   * 1. `src/components/layout/AppShell.tsx`:
   *    - `<aside className="sidebar">`, `<header className="topbar">`,
   *      `.mobile-menu-sheet` e `<nav className="mobile-nav">`.
   *
   * 2. `src/components/playground/EditorPane.tsx`:
   *    - `<section className="editor-panel">`: cabeçalho (`script.zsh`, fonte,
   *      wrap, colar/copiar/salvar), toolbar (`Executar`, `Formatar`, `Validar`,
   *      `Explicar`, `Fluxo`), `<ShellEditor>`, `<CommandHelp>`, card
   *      `.semantic-selection-card`, `.pane-resizer`, `.editor-keyboard` e rodapé.
   *
   * 3. `src/components/playground/TerminalPane.tsx`:
   *    - `<section className="terminal-panel">`: cabeçalho retrátil, lista de
   *      execuções (`.terminal-run`), estado vazio (`.terminal-empty`),
   *      `.pane-resizer` e controles de reiniciar/limpar sandbox.
   *
   * 4. `src/components/playground/SuggestionsPane.tsx` & `DiagnosticsList.tsx`:
   *    - `.actions-panel` (dicas contextuais + blocos prontos `SNIPPETS`) e
   *      `.diagnostic-panel` (erros ShellCheck + botão de auto-fix).
   *
   * 5. `src/components/explorer/ExplorerDock.tsx`:
   *    - `<section className="explain-panel explorer-dock">`: divisor arrastável,
   *      presets `35% | 50% | 70%`, alternância esquerda/direita, abas
   *      `Fluxo | AST | Explicação` e renderização do `<ExecutionExplorer>`.
   * ========================================================================== */
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Terminal size={20} strokeWidth={2.4} />
          </span>
          <span>
            Shell<span className="brand-muted">Conductor</span>
          </span>
        </Link>
        <div className="workspace-pill">
          <span className="workspace-dot" />
          <span>Meu workspace</span>
          <ChevronDown size={14} />
        </div>
        <nav className="side-nav">
          <NavContents />
        </nav>
        <div className="sidebar-spacer" />
        <div className="side-note">
          <span className="side-note-icon">
            <ShieldCheck size={15} />
          </span>
          <div>
            <strong>Sandbox local</strong>
            <p>O shell roda em WebAssembly, sem acesso ao seu sistema real.</p>
          </div>
        </div>
        <div className="side-bottom">
          <a href="https://github.com/rodkisten/shell" target="_blank" rel="noreferrer">
            <Github size={16} /> GitHub
          </a>
          <span>v0.1</span>
        </div>
      </aside>

      <div
        className={cn(
          'main-column',
          explorerOpen && !dockCollapsed && 'with-explorer-dock',
          explorerOpen && !dockCollapsed && `dock-${dockPosition}`,
        )}
        style={mainColumnStyle}
      >
        <header className="topbar">
          <div className="breadcrumbs">
            <button className="mobile-menu-button" aria-label="Abrir menu" onClick={() => setMobileMenu((v) => !v)}>
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{resolvePageTitle(location.pathname)}</strong>
          </div>
          <div className="topbar-right">
            <span className="privacy-label">
              <span className="status-light" /> Armazenamento local
            </span>
            <ManPopover command={inspected} onClose={() => setInspected(null)} onInsert={insert} />
            <a
              className="github-small"
              href="https://github.com/rodkisten/shell"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <Github size={17} />
            </a>
          </div>
        </header>

        {mobileMenu && (
          <div className="mobile-menu-sheet" onClick={() => setMobileMenu(false)}>
            <NavContents />
          </div>
        )}

        <main className="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <div className="page-heading">
                    <div className="heading-top">
                      <span className="eyebrow">
                        {/** <span className="live-dot"/> SHELL PLAYGROUND</span>
                        <span className="release-pill">ZSH + WEBASSEMBLY</span><span role="status" aria-live="polite" className="release-pill" title={flowStatus.message ?? "Analisador CFG em Web Worker"}>CFG WASM: {flowStatus.state === "ready" ? "✓ pronto" : flowStatus.state === "loading" ? "⏳ carregando" : flowStatus.state === "error" ? "✕ falhou" : "aguardando"}</span></div>
                        <h1>Seu shell, <span>seu playground.</span></h1> **/}
                      </span>
                    </div>
                  </div>

                  <div className="compact-workspace-controls" aria-label="Automação e visualização">
                    <label title="Executar após 850 ms sem digitar">
                      <input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} />
                      <Play size={15} />
                      <span>Autoexecutar</span>
                    </label>
                    <label title="Validação sintática automática após 900 ms">
                      <input type="checkbox" checked={autoCheck} onChange={(event) => setAutoCheck(event.target.checked)} />
                      <ShieldCheck size={15} />
                      <span>Auto sintaxe</span>
                    </label>
                    <label title="Formatar automaticamente após 1,5 s sem digitar">
                      <input type="checkbox" checked={autoFormat} onChange={(event) => setAutoFormat(event.target.checked)} />
                      <WandSparkles size={15} />
                      <span>Autoformatar</span>
                    </label>
                    <Link to="/linux" className="compact-control-icon" title="Alpine Linux" aria-label="Alpine Linux">
                      <Terminal size={16} />
                    </Link>
                    <button
                      type="button"
                      className="compact-control-icon"
                      aria-label={sideBySide ? 'Empilhar painéis' : 'Painéis lado a lado'}
                      aria-pressed={sideBySide}
                      title={sideBySide ? 'Empilhar painéis' : 'Painéis lado a lado'}
                      onClick={() => setSideBySide((value) => !value)}
                    >
                      <ArrowLeftRight size={16} />
                    </button>
                  </div>

                  <div className={cn('workspace-layout', sideBySide && 'is-split')} style={workspaceLayoutStyle}>
                    <section className="editor-panel" style={sideBySide ? { gridColumn: 1, gridRow: 1 } : undefined}>
                      <div className="panel-header">
                        <div className="panel-tabs">
                          <span className="file-icon">
                            <FileCode2 size={15} />
                          </span>
                          <span>script.zsh</span>
                          <span className="unsaved-dot" aria-label="Rascunho local" />
                        </div>
                        <div className="panel-header-actions">
                          <label
                            title="Tamanho da fonte do editor"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, flexShrink: 0 }}
                          >
                            <span className="editor-font-label">Fonte</span>
                            <select
                              aria-label="Tamanho da fonte"
                              value={editorFontSize}
                              onChange={(event) => setEditorFontSize(Number(event.target.value))}
                              style={{
                                background: '#141519',
                                color: '#eee',
                                border: '1px solid #34363d',
                                borderRadius: 5,
                                padding: '4px 2px',
                                fontSize: 16,
                                maxWidth: 74,
                              }}
                            >
                              {[9, 10, 11, 12, 13, 14].map((size) => (
                                <option key={size} value={size}>
                                  {size}px
                                </option>
                              ))}
                            </select>
                          </label>
                          <label
                            title="Quebrar linhas longas"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={editorWordWrap}
                              onChange={(event) => setEditorWordWrap(event.target.checked)}
                            />{' '}
                            Wrap
                          </label>
                          <span className="language-label">Zsh</span>
                          <button title="Colar texto" onClick={paste} aria-label="Colar">
                            <Clipboard size={15} />
                          </button>
                          <button title="Copiar script" onClick={() => void copy()} aria-label="Copiar">
                            <Copy size={15} />
                          </button>
                          <button title="Salvar script" onClick={save} aria-label="Salvar">
                            <Bookmark size={15} />
                          </button>
                        </div>
                      </div>

                      <nav className="editor-command-toolbar" aria-label="Ferramentas do editor">
                        <button type="button" title="Executar" aria-label="Executar" onClick={run} disabled={!!busy}>
                          <Play size={17} />
                          <span className="command-label">Executar</span>
                        </button>
                        <button
                          type="button"
                          title="Formatar"
                          aria-label="Formatar"
                          onClick={() => void convert(false)}
                          disabled={!!busy}
                        >
                          <WandSparkles size={17} />
                          <span className="command-label">Formatar</span>
                        </button>
                        <button
                          type="button"
                          title="Validar sintaxe Zsh"
                          aria-label="Validar sintaxe Zsh"
                          onClick={() => void check()}
                          disabled={!!busy}
                        >
                          <ShieldCheck size={17} />
                          <span className="command-label">Validar</span>
                        </button>
                        <button
                          type="button"
                          className="editor-command-primary"
                          title="Explicar"
                          aria-label="Explicar"
                          onClick={() => void explain()}
                          disabled={!!busy}
                        >
                          <BookOpen size={17} />
                          <span className="command-label">Explicar</span>
                        </button>
                        <button
                          type="button"
                          title="Fluxo"
                          aria-label="Fluxo"
                          onClick={() => {
                            setExplorerTab('flow');
                            setExplorerOpen(true);
                            if (!explanation) void explain();
                          }}
                          disabled={!!busy}
                        >
                          <Activity size={17} />
                          <span className="command-label">Fluxo</span>
                        </button>
                      </nav>

                      <div
                        className="editor-inner editor-auto-grow"
                        style={{ height: editorHeight ?? `clamp(52px, ${autoEditorLines * 1.55 + 1.5}em, 65dvh)` }}
                      >
                        <ShellEditor
                          ref={editor}
                          code={script}
                          fontSize={editorFontSize}
                          wordWrap={editorWordWrap}
                          onChange={change}
                          onCursor={setCursor}
                          onInspect={setInspected}
                          onSemanticInspect={setSemanticSelection}
                          onRun={run}
                        />
                      </div>

                      <CommandHelp help={quickHelp} onManual={setInspected} />

                      {semanticSelection && (
                        <section
                          className="semantic-selection-card"
                          aria-label="Explicação do trecho selecionado"
                          aria-live="polite"
                        >
                          <div className="semantic-selection-head">
                            <strong>{semanticSelection.title}</strong>
                            <button
                              type="button"
                              aria-label="Fechar explicação"
                              onClick={() => setSemanticSelection(null)}
                            >
                              <X size={17} />
                            </button>
                          </div>
                          <button
                            className="semantic-selection-target"
                            type="button"
                            onClick={() => editor.current?.reveal(semanticSelection.from, semanticSelection.to)}
                            title="Selecionar trecho no editor"
                          >
                            <code>{semanticSelection.text}</code> <span aria-hidden="true">↗</span>
                          </button>
                          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {semanticSelection.description.replace(/\\n/g, '\n')}
                          </p>
                          {semanticSelection.example && <pre>{semanticSelection.example}</pre>}
                          <small>
                            Fonte:{' '}
                            {semanticSelection.source === 'cli-spec'
                              ? 'especificação CLI local'
                              : semanticSelection.source === 'shell'
                                ? 'operador shell'
                                : 'catálogo local'}
                            . Análise parcial.
                          </small>
                        </section>
                      )}

                      <div
                        className="pane-resizer"
                        role="separator"
                        aria-label="Redimensionar editor"
                        aria-orientation="horizontal"
                        onPointerDown={(event) => resize('editor', event)}
                      />

                      <div className="editor-keyboard">
                        {KEYBOARD_SHORTCUTS.map((item, i) => (
                          <button key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(item.value)}>
                            {item.label}
                          </button>
                        ))}
                      </div>

                      <div className="editor-footer">
                        <div className="footer-meta">
                          <span>
                            <span className="status-light" /> Pronto
                          </span>
                          <span>{scriptLines.length} linhas</span>
                          <span>UTF-8</span>
                        </div>
                        <span>⌘ ↵ para executar</span>
                      </div>
                    </section>

                    {sideBySide && (
                      <div
                        className="split-divider"
                        role="separator"
                        aria-label="Redimensionar painéis lado a lado"
                        aria-orientation="vertical"
                        onPointerDown={splitResize}
                        style={{
                          gridColumn: 2,
                          gridRow: 1,
                          alignSelf: 'stretch',
                          cursor: 'col-resize',
                          touchAction: 'none',
                          background: '#292b30',
                          borderRadius: 6,
                          minHeight: 220,
                        }}
                      />
                    )}

                    <section
                      className="terminal-panel"
                      style={sideBySide ? { gridColumn: 3, gridRow: 1, marginTop: 0 } : undefined}
                    >
                      <button
                        className="terminal-heading"
                        onClick={() => setShowOutput((v) => !v)}
                        aria-expanded={showOutput}
                      >
                        <span>
                          <Terminal size={17} /> Terminal <span className="terminal-secondary">/ sandbox</span>
                        </span>
                        <div>
                          <span className="mini-status">
                            <span className="status-light" /> WASM
                          </span>
                          <ChevronDown className={cn(!showOutput && 'rotate')} size={16} />
                        </div>
                      </button>

                      {showOutput && (
                        <>
                          <div className="terminal-body" style={{ height: terminalHeight, overflow: 'auto' }}>
                            {output.length ? (
                              output.map((item) => (
                                <div className="terminal-run" key={item.id}>
                                  <div className="terminal-prompt">
                                    <span>❯</span>{' '}
                                    {item.script.split('\n').find((line) => line.trim() && !line.startsWith('#')) ||
                                      'script.zsh'}
                                  </div>
                                  {item.stdout && <pre>{item.stdout}</pre>}
                                  {item.stderr && <pre className="terminal-error">{item.stderr}</pre>}
                                  <div className={cn('terminal-exit', item.exitCode !== 0 && 'bad')}>
                                    Processo finalizado com código {item.exitCode} ·{' '}
                                    {new Date(item.time).toLocaleTimeString('pt-BR')}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="terminal-empty">
                                <span className="terminal-prompt">
                                  <span>❯</span> shellconductor@browser ~ %
                                </span>
                                <p>O terminal está pronto. Execute seu script para ver a saída aqui.</p>
                                <p className="muted">
                                  Sistema de arquivos virtual, sem acesso ao disco ou rede do iPhone.
                                </p>
                              </div>
                            )}
                          </div>

                          <div
                            className="pane-resizer"
                            role="separator"
                            aria-label="Redimensionar terminal"
                            aria-orientation="horizontal"
                            onPointerDown={(event) => resize('terminal', event)}
                          />

                          <div className="terminal-bottom">
                            <span>
                              <ShieldCheck size={13} /> Ambiente isolado
                            </span>
                            <div>
                              <button
                                onClick={async () => {
                                  try {
                                    await resetShell();
                                    notify('Sandbox zerado.');
                                  } catch {
                                    notify('Não foi possível reiniciar.');
                                  }
                                }}
                              >
                                <RotateCcw size={13} /> Reiniciar
                              </button>
                              <button onClick={() => setOutput([])}>
                                <Trash2 size={13} /> Limpar saída
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </section>

                    <section
                      className="actions-panel compact-reference-panel"
                      style={sideBySide ? { gridColumn: '1 / -1', gridRow: 2 } : undefined}
                    >
                      <div className="toolbox-section-title">
                        <span className="eyebrow">SUGESTÕES</span>
                        <Activity size={15} />
                      </div>
                      <div className="suggestions-list">
                        {hints.length ? (
                          hints.slice(0, 4).map((hint, i) => (
                            <button
                              key={hint.label + i}
                              className="hint-item"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                if (hint.kind === 'command') setInspected(hint.label);
                                insert(hint.example);
                              }}
                            >
                              <div className="hint-head">
                                <code>{hint.label}</code>
                                <span>{hint.title}</span>
                              </div>
                              <p>{hint.description}</p>
                              <small>{hint.example}</small>
                            </button>
                          ))
                        ) : (
                          <p className="muted">Digite um comando para ver exemplos e opções.</p>
                        )}
                      </div>

                      <button
                        className="snippet-toggle"
                        onClick={() => setShowSnippets((v) => !v)}
                        aria-expanded={showSnippets}
                      >
                        <span>
                          <Code2 size={15} /> Blocos prontos
                        </span>
                        <ChevronDown className={cn(showSnippets && 'rotate')} size={15} />
                      </button>

                      {showSnippets && (
                        <div className="snippet-compact">
                          {SNIPPETS.slice(0, 8).map((item) => (
                            <button key={item.id} onClick={() => insert(item.code)}>
                              {item.name}
                              <span>+</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  {busy === 'check' && (
                    <p className="inline-status">
                      <LoaderCircle className="spin" size={14} /> Validando sintaxe Zsh…
                    </p>
                  )}

                  {!!findings.length && (
                    <section className="diagnostic-panel">
                      <div className="subpanel-heading">
                        <h3>
                          <CircleAlert size={17} /> Diagnósticos <span className="count-pill">{findings.length}</span>
                        </h3>
                        <Button variant="outline" size="sm" onClick={fix}>
                          <WandSparkles size={14} /> Aplicar correções possíveis
                        </Button>
                      </div>
                      {findings.map((finding, i) => (
                        <div className="diagnostic-item" key={i}>
                          <span className={cn('severity', finding.level)}>{finding.level}</span>
                          <div>
                            <strong>
                              SC{finding.code}{' '}
                              <span>
                                L{finding.line}:{finding.column}
                              </span>
                            </strong>
                            <p>{finding.message}</p>
                            <a href={`https://www.shellcheck.net/wiki/SC${finding.code}`} target="_blank" rel="noreferrer">
                              Entenda esse diagnóstico ↗
                            </a>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  <WorkspacePanel />

                  <div className="footer-advice">
                    <Info size={15} />
                    <span>
                      O terminal executa Zsh em WebAssembly com filesystem virtual persistente.{' '}
                      <strong>Não executa comandos no seu iPhone, servidor ou Codespace.</strong> Requisições HTTP
                      externas não são habilitadas no sandbox.
                    </span>
                  </div>
                </>
              }
            />
            <Route path="/linux" element={<LinuxPanel />} />
            <Route path="/biblioteca" element={<ReferencePanel onInsert={insert} onInspect={setInspected} />} />
            <Route
              path="/historico"
              element={<HistoryPanel revision={historyRevision} onRestore={restore} notify={notify} />}
            />
            <Route
              path="*"
              element={
                <div className="empty-state">
                  <h2>Página não encontrada</h2>
                  <Link to="/">Voltar ao editor</Link>
                </div>
              }
            />
          </Routes>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegação principal">
        <NavLink to="/" end className={({ isActive }) => cn(isActive && 'active')}>
          <Code2 size={20} />
          <span>Editor</span>
        </NavLink>
        <NavLink to="/biblioteca" className={({ isActive }) => cn(isActive && 'active')}>
          <BookOpen size={20} />
          <span>Biblioteca</span>
        </NavLink>
        <NavLink to="/linux" className={({ isActive }) => cn(isActive && 'active')}>
          <Terminal size={20} />
          <span>Linux</span>
        </NavLink>
        <NavLink to="/touch" className={({ isActive }) => cn(isActive && 'active')}>
          <Terminal size={20} />
          <span>Touch</span>
        </NavLink>
        <NavLink to="/historico" className={({ isActive }) => cn(isActive && 'active')}>
          <Clock3 size={20} />
          <span>Histórico</span>
        </NavLink>
      </nav>

      {toast && (
        <div role="status" className="toast">
          <CircleCheck size={16} /> {toast}
          <button onClick={() => setToast('')} aria-label="Fechar aviso">
            <X size={14} />
          </button>
        </div>
      )}

      {explorerOpen && (
        <section
          className={cn('explain-panel explorer-dock', `dock-${dockPosition}`, dockCollapsed && 'dock-collapsed')}
          role="dialog"
          aria-label="Explorador de análise"
          aria-modal="false"
          style={{ '--dock-size': `${dockSize}%`, '--dock-height': `${dockSize}dvh` } as CSSProperties}
        >
          <div
            className="explorer-dock-resizer"
            role="separator"
            aria-label="Redimensionar explorador"
            aria-orientation={isMobileViewport ? 'horizontal' : 'vertical'}
            aria-valuemin={DOCK_MIN_SIZE}
            aria-valuemax={DOCK_MAX_SIZE}
            aria-valuenow={dockSize}
            aria-disabled={dockCollapsed}
            tabIndex={dockCollapsed ? -1 : 0}
            onPointerDown={dockCollapsed ? undefined : resizeDock}
            onPointerMove={moveDock}
            onPointerUp={finishDock}
            onPointerCancel={finishDock}
            onKeyDown={handleDockResizerKeyDown}
          />

          <div className="subpanel-heading">
            <h3>
              <BookOpen size={15} /> Explorador
            </h3>
            <div className="dock-header-actions">
              <button
                type="button"
                className="subtle-icon"
                onClick={() => setDockPosition((value) => (value === 'left' ? 'right' : 'left'))}
                title="Alternar lado do Dock"
                aria-label="Alternar lado do Dock"
              >
                <ArrowLeftRight size={15} />
              </button>
              <button
                type="button"
                className="subtle-icon"
                onClick={() => setDockCollapsed((value) => !value)}
                title={dockCollapsed ? 'Expandir Dock' : 'Recolher Dock'}
                aria-label={dockCollapsed ? 'Expandir Dock' : 'Recolher Dock'}
              >
                {dockCollapsed ? '+' : '−'}
              </button>
              {!dockCollapsed && (
                <div className="dock-size-presets" role="group" aria-label="Tamanho do Dock">
                  {([35, 50, 70] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={dockSize === size ? 'active' : ''}
                      onClick={() => setDockSize(size)}
                      aria-pressed={dockSize === size}
                      title={`Dock ${size}%`}
                    >
                      {size}%
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="subtle-icon"
                onClick={() => setDockSize(DOCK_DEFAULT_SIZE)}
                title="Restaurar tamanho"
                aria-label="Restaurar tamanho"
              >
                <ArrowLeftRight size={15} />
              </button>
              <button
                type="button"
                className="subtle-icon"
                onClick={() => setExplorerOpen(false)}
                title="Fechar"
                aria-label="Fechar explorador"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {!dockCollapsed && (
            <>
              <div className="explorer-tabs" role="tablist" aria-label="Visualização da análise">
                {(['flow', 'ast', 'explanation'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={explorerTab === tab}
                    onClick={() => setExplorerTab(tab)}
                  >
                    {tab === 'flow' ? 'Fluxo' : tab === 'ast' ? 'AST' : 'Explicação'}
                  </button>
                ))}
              </div>

              {explorerTab !== 'explanation' && shellAnalysis && (
                <ExecutionExplorer
                  cursorOffset={cursor}
                  view={explorerTab}
                  analysis={shellAnalysis}
                  flow={flowResult}
                  flowStatus={flowStatus}
                  flowError={flowError}
                  source={script}
                  tokens={analysisTokens}
                  onReveal={(from, to) => editor.current?.reveal(from, to)}
                />
              )}

              {explorerTab === 'explanation' && (
                <pre className="explorer-explanation-text">{explanation?.replace(/\\\\n/g, '\n') ?? 'Analisando…'}</pre>
              )}

              <p>Fonte: catálogo local e parser sh-syntax. Nenhum código é enviado para análise remota.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
