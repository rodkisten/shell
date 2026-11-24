import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, WidgetType, hoverTooltip, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { shell } from '@codincod/codemirror-lang-shell';
import { basicSetup } from 'codemirror';

import { shellAutosuggestion, type Autosuggestion } from '../lib/autosuggest';
import { cliCompletions, cliValueRequest } from '../lib/cli-completions';
import { byName, SNIPPETS } from '../lib/commands';
import { valueCompletions } from '../lib/completion-values';
import { FLOW_COLORS } from '../lib/flow-colors';
import { embeddedShellHighlight } from '../lib/highlight';
import { explainKnownShellTokens, type SemanticToken } from '../lib/semantic-shell';
import { activeShellCommand } from '../lib/shell-command-ast';
import { checkShell, type Finding } from '../lib/shellcheck';
import { contextualHintsFromActive } from '../lib/suggestions';

/* ============================================================================
 * [EXTRAIR PARA CONSTANTES: src/constants/editor-config.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - Constantes de comportamento, limites numéricos, regexes de tokenização,
 *   prioridades (`boost`) do autocomplete, paleta visual do tema CodeMirror,
 *   classes CSS de decoração, constantes anti-zoom do Safari e textos de UI.
 *
 * Contratos a preservar:
 * - Classes CSS `.cm-autosuggestion`, `.shell-diagnostic`,
 *   `.shell-diagnostic-error`, `.shell-semantic-tooltip` e `.code-editor`.
 * - Tamanho base `16px` no elemento editável para evitar auto-zoom no iOS Safari.
 * ============================================================================ */

type AutosuggestionApplyMode = 'all' | 'word';

type EditorCallbacks = {
  onChange(value: string): void;
  onCursor(value: number): void;
  onInspect(command: string): void;
  onSemanticInspect(token: SemanticToken): void;
  onRun(): void;
};

export type ShellEditorHandle = {
  insert(text: string): void;
  focus(): void;
  reveal(from: number, to: number): void;
};

type Props = {
  code: string;
  fontSize: number;
  wordWrap: boolean;
  onChange(value: string): void;
  onCursor(value: number): void;
  onInspect(command: string): void;
  onSemanticInspect(token: SemanticToken): void;
  onRun(): void;
};

const EDITOR_LIMITS = {
  minFontSizePx: 8,
  maxFontSizePx: 32,
  iosSafariBaseFontSizePx: 16,
  doubleTapThresholdMs: 300,
  tabSizeSpaces: 2,
  maxSyntaxBreadcrumbs: 8,
  maxAutocompleteOptions: 8,
  hoverTooltipDelayMs: 250,
  diagnosticsDebounceMs: 450,
} as const;

const COMPLETION_BOOST = {
  value: 120,
  subcommand: 90,
  commandHint: 80,
  flagOption: 40,
  flagHint: 30,
  snippet: 10,
} as const;

const ZOOM_SHORTCUT_KEYS = new Set(['+', '=', '-', '_', '0']);
const LOCKED_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
const TOUCH_ACTION_PAN_ONLY = 'pan-x pan-y';

const COMPLETION_TOKEN_BEFORE_REGEX = /[\w.+-]*/;
const COMPLETION_VALID_FOR_REGEX = /^[\w.+-]*$/;
const WHITESPACE_CHAR_REGEX = /\s/;
const SYNTAX_ERROR_NODE_NAME = '⚠';
const SYNTAX_BREADCRUMB_SEPARATOR = ' › ';

const EDITOR_KEYBINDS = {
  acceptAutosuggestionAll: 'Tab',
  acceptAutosuggestionWord: 'ArrowRight',
  runScript: 'Mod-Enter',
} as const;

const EDITOR_COPY = {
  placeholder: 'Cole um script do ChatGPT ou comece a escrever…',
  ariaLabel: 'Editor de shell',
  autosuggestionTitle: 'Autosuggestion · toque para aceitar · Tab aceita tudo',
  autosuggestionAriaPrefix: 'Sugestão: ',
  syntaxBreadcrumbPrefix: '\n\nEstrutura sintática (CodeMirror): ',
  takesValueNotice: '\n\nEsta opção espera um valor.',
  examplePrefix: '\n\nExemplo: ',
} as const;

const EDITOR_CSS_CLASSES = {
  root: 'code-editor',
  autosuggestionBase: 'cm-autosuggestion',
  autosuggestionSourcePrefix: 'cm-autosuggestion-',
  semanticTooltip: 'shell-semantic-tooltip',
  diagnosticWarning: 'shell-diagnostic',
  diagnosticError: 'shell-diagnostic shell-diagnostic-error',
} as const;

const EDITOR_THEME_PALETTE = {
  bgPrimary: '#090b0f',
  bgActiveLine: '#15181e',
  bgSurface: '#17181c',
  bgSelectedOption: '#303641',
  bgSelection: '#334155',
  borderSubtle: '#1e222a',
  borderElevated: '#34363e',
  textPrimary: '#f5f5f5',
  textCaret: '#f4f4f5',
  textCursor: '#ffffff',
  textMuted: '#a1a1aa',
  textGutter: '#4b5563',
  textCodeAccent: '#a5b4fc',
  shadowOverlay: '#0008',
  fontFamilyMono: "'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace",
} as const;

const TOOLTIP_INLINE_STYLES = {
  container: `max-width:min(85vw,360px);padding:10px 12px;white-space:normal;background:${EDITOR_THEME_PALETTE.bgSurface};color:${EDITOR_THEME_PALETTE.textPrimary};border:1px solid ${EDITOR_THEME_PALETTE.borderElevated};border-radius:10px;line-height:1.5`,
  exampleCode: `display:block;margin-top:6px;white-space:pre-wrap;color:${EDITOR_THEME_PALETTE.textCodeAccent}`,
} as const;

/* ============================================================================
 * [EXTRAIR PARA HOOK: src/hooks/usePreventPageZoom.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `usePreventPageZoom` e `UsePreventPageZoomOptions`.
 * - Intercepta pinch-to-zoom, gestos multi-touch (`touchstart`/`touchmove` com
 *   2+ dedos ou `scale !== 1`), eventos proprietários `gesture*` do Safari/WebKit,
 *   double-tap zoom, `Ctrl/Cmd + Wheel`, atalhos `Ctrl/Cmd + +/-/0`, auto-zoom
 *   de foco no iOS Safari e fornece a extensão CodeMirror que emula 16px no
 *   DOM enquanto mantém o tamanho visual idêntico ao `visualFontSize`.
 * ============================================================================ */

type UsePreventPageZoomOptions = {
  containerRef: RefObject<HTMLElement | null>;
  visualFontSize: number;
  enabled?: boolean;
};

export function usePreventPageZoom({
  containerRef,
  visualFontSize,
  enabled = true,
}: UsePreventPageZoomOptions) {
  // 1. Trava a meta viewport e define touch-action: pan-x pan-y no documento
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const previousContent = meta?.getAttribute('content') ?? null;

    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', LOCKED_VIEWPORT_CONTENT);

    const prevTouchAction = document.documentElement.style.touchAction;
    document.documentElement.style.touchAction = TOUCH_ACTION_PAN_ONLY;

    return () => {
      document.documentElement.style.touchAction = prevTouchAction;
      if (meta && previousContent !== null) {
        meta.setAttribute('content', previousContent);
      }
    };
  }, [enabled]);

  // 2. Intercepta gestos multi-touch, pinch, drag-zoom, double-tap, wheel-zoom e atalhos
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let lastTouchEnd = 0;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touchScale = (event as TouchEvent & { scale?: number }).scale;
      if (event.touches.length > 1 || (typeof touchScale === 'number' && touchScale !== 1)) {
        event.preventDefault();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= EDITOR_LIMITS.doubleTapThresholdMs) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    };

    const handleGesture = (event: Event) => {
      event.preventDefault();
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ZOOM_SHORTCUT_KEYS.has(event.key)) {
        event.preventDefault();
      }
    };

    const handleViewportResize = () => {
      const vv = window.visualViewport;
      if (vv && vv.scale > 1) {
        window.scrollTo(0, 0);
      }
    };

    const nonPassive: AddEventListenerOptions = { passive: false, capture: true };

    document.addEventListener('touchstart', handleTouchStart, nonPassive);
    document.addEventListener('touchmove', handleTouchMove, nonPassive);
    document.addEventListener('touchend', handleTouchEnd, nonPassive);
    document.addEventListener('gesturestart', handleGesture, nonPassive);
    document.addEventListener('gesturechange', handleGesture, nonPassive);
    document.addEventListener('gestureend', handleGesture, nonPassive);
    window.addEventListener('wheel', handleWheel, nonPassive);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('gesturestart', handleGesture, true);
      document.removeEventListener('gesturechange', handleGesture, true);
      document.removeEventListener('gestureend', handleGesture, true);
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, [enabled]);

  // 3. Garante computed font-size >= 16px em qualquer elemento focado dentro do container
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const computedSize = parseFloat(
        window.getComputedStyle(target).fontSize || String(EDITOR_LIMITS.iosSafariBaseFontSizePx),
      );
      if (computedSize < EDITOR_LIMITS.iosSafariBaseFontSizePx) {
        target.style.fontSize = `${EDITOR_LIMITS.iosSafariBaseFontSizePx}px`;
      }
    };

    container.addEventListener('focusin', handleFocusIn, true);
    return () => container.removeEventListener('focusin', handleFocusIn, true);
  }, [containerRef, enabled]);

  // 4. Emula 16px no .cm-content para o Safari e compensa visualmente via CSS zoom
  const safariNoZoomFontExtension = useMemo(() => {
    const clampedSize = Math.max(
      EDITOR_LIMITS.minFontSizePx,
      Math.min(EDITOR_LIMITS.maxFontSizePx, visualFontSize),
    );
    const scaleRatio = clampedSize / EDITOR_LIMITS.iosSafariBaseFontSizePx;
    const basePx = `${EDITOR_LIMITS.iosSafariBaseFontSizePx}px`;

    return EditorView.theme({
      '&': {
        fontSize: basePx,
        zoom: String(scaleRatio),
        touchAction: TOUCH_ACTION_PAN_ONLY,
      },
      '.cm-scroller': {
        touchAction: TOUCH_ACTION_PAN_ONLY,
        WebkitTextSizeAdjust: '100%',
      },
      '.cm-content': {
        fontSize: basePx,
        WebkitTextSizeAdjust: '100%',
      },
    });
  }, [visualFontSize]);

  return { safariNoZoomFontExtension };
}

/* ============================================================================
 * [EXTRAIR PARA UTILITÁRIO: src/lib/codemirror-syntax-context.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `withSyntaxContext` e `findTokenAtOffset`.
 * - Responsabilidade única: enriquecer `SemanticToken` com a trilha estrutural
 *   do parser incremental do CodeMirror sem acoplar ao React.
 * ============================================================================ */

/**
 * Lezer supplies structural context for the shell editor. This is a syntax
 * breadcrumb, not a claim that the editor grammar is a full semantic Bash AST.
 */
function withSyntaxContext(token: SemanticToken, state: EditorState): SemanticToken {
  const root = syntaxTree(state);
  if (token.from >= root.length) return token;

  let node: ReturnType<typeof root.resolveInner> | null = root.resolveInner(token.from, 1);
  const names: string[] = [];

  while (node && names.length < EDITOR_LIMITS.maxSyntaxBreadcrumbs) {
    if (!node.type.isAnonymous && node.name && node.name !== SYNTAX_ERROR_NODE_NAME) {
      names.push(node.name);
    }
    node = node.parent;
  }

  const path = names.reverse().join(SYNTAX_BREADCRUMB_SEPARATOR);
  if (!path) return token;

  return {
    ...token,
    description: `${token.description}${EDITOR_COPY.syntaxBreadcrumbPrefix}${path}`,
  };
}

function findTokenAtOffset(tokens: readonly SemanticToken[], pos: number): SemanticToken | undefined {
  return tokens.find((item) => item.from <= pos && pos < item.to);
}

/* ============================================================================
 * [EXTRAIR PARA EXTENSÃO CODEMIRROR: src/lib/codemirror-diagnostics.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `setDiagnostics`, `diagnosticsField` e `buildDiagnosticDecorations`.
 * - Encapsula toda a tradução de `(line, column, endColumn)` do ShellCheck para
 *   offsets absolutos e `Decoration.mark` do CodeMirror.
 * ============================================================================ */

const setAstReveal = StateEffect.define<DecorationSet>();
const astRevealField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setAstReveal)) value = effect.value;
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
const setDiagnostics = StateEffect.define<DecorationSet>();

const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnostics)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildDiagnosticDecorations(state: EditorState, findings: readonly Finding[]): DecorationSet {
  const marks = findings.flatMap((finding) => {
    const clampedLine = Math.max(1, Math.min(finding.line, state.doc.lines));
    const line = state.doc.line(clampedLine);
    const from = Math.min(line.to, line.from + Math.max(0, finding.column - 1));
    const rawEndColumn = finding.endColumn ?? finding.column + 1;
    const to = Math.min(line.to, Math.max(from + 1, line.from + rawEndColumn - 1));

    if (from >= to) return [];

    return [
      Decoration.mark({
        class:
          finding.level === 'error'
            ? EDITOR_CSS_CLASSES.diagnosticError
            : EDITOR_CSS_CLASSES.diagnosticWarning,
        attributes: {
          title: finding.message,
          'aria-label': finding.message,
        },
      }).range(from, to),
    ];
  });

  return Decoration.set(marks, true);
}

/* ============================================================================
 * [EXTRAIR PARA EXTENSÃO CODEMIRROR: src/lib/codemirror-autosuggest.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `setAutosuggestion`, `autosuggestionField`, `autosuggestionDecorations`,
 *   `AutosuggestionWidget` e `applyAutosuggestion`.
 * ============================================================================ */

const setAutosuggestion = StateEffect.define<Autosuggestion | null>();

function extractNextWordSlice(text: string): string {
  let end = 0;
  while (end < text.length && WHITESPACE_CHAR_REGEX.test(text[end])) end++;
  while (end < text.length && !WHITESPACE_CHAR_REGEX.test(text[end])) end++;
  return text.slice(0, Math.max(1, end));
}

function applyAutosuggestion(view: EditorView, mode: AutosuggestionApplyMode): boolean {
  const suggestion = view.state.field(autosuggestionField, false);
  const selection = view.state.selection.main;
  if (!suggestion || !selection.empty || selection.head !== suggestion.from) return false;

  const insert = mode === 'word' ? extractNextWordSlice(suggestion.insert) : suggestion.insert;
  if (!insert) return false;

  view.dispatch({
    changes: { from: suggestion.from, insert },
    selection: { anchor: suggestion.from + insert.length },
    effects: setAutosuggestion.of(null),
    userEvent: 'input.complete',
  });
  return true;
}

class AutosuggestionWidget extends WidgetType {
  constructor(readonly suggestion: Autosuggestion) {
    super();
  }

  eq(other: AutosuggestionWidget): boolean {
    return (
      other.suggestion.insert === this.suggestion.insert &&
      other.suggestion.source === this.suggestion.source
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('span');
    dom.className = `${EDITOR_CSS_CLASSES.autosuggestionBase} ${EDITOR_CSS_CLASSES.autosuggestionSourcePrefix}${this.suggestion.source}`;
    dom.textContent = this.suggestion.insert;
    dom.title = EDITOR_COPY.autosuggestionTitle;
    dom.setAttribute('aria-label', `${EDITOR_COPY.autosuggestionAriaPrefix}${this.suggestion.insert}`);
    dom.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyAutosuggestion(view, 'all');
      view.focus();
    });
    return dom;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const autosuggestionField = StateField.define<Autosuggestion | null>({
  create: () => null,
  update(value, transaction) {
    let next = transaction.docChanged || transaction.selection ? null : value;
    for (const effect of transaction.effects) {
      if (effect.is(setAutosuggestion)) next = effect.value;
    }
    return next;
  },
});

const autosuggestionDecorations = EditorView.decorations.compute([autosuggestionField], (state) => {
  const suggestion = state.field(autosuggestionField);
  if (!suggestion || suggestion.from < 0 || suggestion.from > state.doc.length) return Decoration.none;
  return Decoration.set([
    Decoration.widget({
      widget: new AutosuggestionWidget(suggestion),
      side: 1,
    }).range(suggestion.from),
  ]);
});

/* ============================================================================
 * [EXTRAIR PARA PROVEDORES CODEMIRROR: src/lib/codemirror-providers.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `shellCompletionSource` e `shellHoverTooltip`.
 * ============================================================================ */

async function shellCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  const before = context.matchBefore(COMPLETION_TOKEN_BEFORE_REGEX);
  if (!before) return null;

  const source = context.state.doc.toString();
  // mvdan/sh owns command/subcommand scope. Fig and the curated local specs
  // are metadata sources only and never re-parse shell text.
  const active = await activeShellCommand(source, context.pos);
  const cliItems = cliCompletions(active, context.pos);
  const valueItems = await valueCompletions(cliValueRequest(active, context.pos));
  const editingCommand = !active || context.pos <= active.executableTo;
  const hints = editingCommand ? contextualHintsFromActive(active, context.pos) : [];
  const snippets =
    editingCommand && before.text ? SNIPPETS.filter((snippet) => snippet.id.startsWith(before.text)) : [];

  if (!context.explicit && before.from === before.to && !cliItems.length && !valueItems.length) {
    return null;
  }

  const seen = new Set<string>();
  const rawOptions: Completion[] = [
    ...valueItems.map((item) => ({
      label: item.label,
      type: 'variable',
      detail: item.detail,
      info: item.info,
      apply: item.label,
      boost: COMPLETION_BOOST.value,
    })),
    ...cliItems.map((item) => ({
      label: item.label,
      type: item.kind === 'subcommand' ? 'keyword' : 'property',
      detail: item.detail,
      info: `${item.description}${item.takesValue ? EDITOR_COPY.takesValueNotice : ''}`,
      apply: item.label,
      boost: item.kind === 'subcommand' ? COMPLETION_BOOST.subcommand : COMPLETION_BOOST.flagOption,
    })),
    ...hints.map((hint) => ({
      label: hint.label,
      type: hint.kind === 'flag' ? 'property' : 'function',
      detail: hint.title,
      info: `${hint.description}${EDITOR_COPY.examplePrefix}${hint.example}`,
      apply: hint.label,
      boost: hint.kind === 'command' ? COMPLETION_BOOST.commandHint : COMPLETION_BOOST.flagHint,
    })),
    ...snippets.map((snippet) => ({
      label: snippet.id,
      type: 'keyword',
      detail: snippet.subtitle,
      info: snippet.code,
      apply: snippet.code,
      boost: COMPLETION_BOOST.snippet,
    })),
  ];

  const options = rawOptions.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });

  return options.length ? { from: before.from, options, validFor: COMPLETION_VALID_FOR_REGEX } : null;
}

const shellHoverTooltip = hoverTooltip(
  async (view, pos) => {
    const source = view.state.doc.toString();
    const match = findTokenAtOffset(await explainKnownShellTokens(source), pos);
    if (view.state.doc.toString() !== source || !match) return null;

    const token = withSyntaxContext(match, view.state);
    return {
      pos: token.from,
      end: token.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = EDITOR_CSS_CLASSES.semanticTooltip;
        dom.style.cssText = TOOLTIP_INLINE_STYLES.container;

        const title = document.createElement('strong');
        title.textContent = token.title;

        const detail = document.createElement('div');
        detail.textContent = token.description;

        dom.append(title, detail);

        if (token.example) {
          const example = document.createElement('code');
          example.textContent = token.example;
          example.style.cssText = TOOLTIP_INLINE_STYLES.exampleCode;
          dom.append(example);
        }

        return { dom };
      },
    };
  },
  { hoverTime: EDITOR_LIMITS.hoverTooltipDelayMs },
);

/* ============================================================================
 * [EXTRAIR PARA TEMA: src/lib/codemirror-theme.ts]
 * ----------------------------------------------------------------------------
 * O que mover:
 * - `shellTheme`.
 * ============================================================================ */

const shellTheme = EditorView.theme(
  {
    '&': { minHeight: '0', background: EDITOR_THEME_PALETTE.bgPrimary },
    '.cm-scroller': { fontFamily: EDITOR_THEME_PALETTE.fontFamilyMono, overflow: 'auto' },
    '.cm-content': { minHeight: '0', padding: '8px 3px 10px', caretColor: EDITOR_THEME_PALETTE.textCaret },
    '.cm-line': { padding: '0 4px' },
    '.cm-gutters': {
      background: EDITOR_THEME_PALETTE.bgPrimary,
      borderRight: `1px solid ${EDITOR_THEME_PALETTE.borderSubtle}`,
      color: EDITOR_THEME_PALETTE.textGutter,
    },
    '.cm-activeLine': { background: EDITOR_THEME_PALETTE.bgActiveLine },
    '.cm-activeLineGutter': { background: EDITOR_THEME_PALETTE.bgActiveLine },
    '.cm-cursor': { borderLeftColor: EDITOR_THEME_PALETTE.textCursor },
    '.cm-selectionBackground': { background: `${EDITOR_THEME_PALETTE.bgSelection} !important` },
    '.cm-tooltip-autocomplete': {
      background: EDITOR_THEME_PALETTE.bgSurface,
      color: EDITOR_THEME_PALETTE.textPrimary,
      border: `1px solid ${EDITOR_THEME_PALETTE.borderElevated}`,
      borderRadius: '10px',
      overflow: 'hidden',
      maxWidth: 'min(92vw, 440px)',
      boxShadow: `0 12px 40px ${EDITOR_THEME_PALETTE.shadowOverlay}`,
    },
    '.cm-tooltip-autocomplete ul': { fontFamily: 'inherit', maxHeight: '220px' },
    '.cm-tooltip-autocomplete ul li': { padding: '7px 11px', lineHeight: '1.6' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      background: EDITOR_THEME_PALETTE.bgSelectedOption,
      color: EDITOR_THEME_PALETTE.textCursor,
    },
    '.cm-completionDetail': { fontStyle: 'normal', color: EDITOR_THEME_PALETTE.textMuted, paddingLeft: '14px' },
    '.cm-tooltip.cm-completionInfo': {
      background: EDITOR_THEME_PALETTE.bgSurface,
      border: `1px solid ${EDITOR_THEME_PALETTE.borderElevated}`,
      maxWidth: '280px',
      whiteSpace: 'pre-wrap',
    },
    '.cm-focused': { outline: 'none' },
    '.cm-ast-reveal-line': { backgroundColor: 'rgba(167,139,250,.18)', boxShadow: 'inset 3px 0 #a78bfa' },
    [`.${EDITOR_CSS_CLASSES.diagnosticWarning}`]: {
      textDecoration: `underline wavy ${FLOW_COLORS.condition}`,
      textUnderlineOffset: '3px',
    },
    '.shell-diagnostic-error': { textDecorationColor: FLOW_COLORS.failure },
  },
  { dark: true },
);

/* ============================================================================
 * COMPONENTE PRINCIPAL: ShellEditor
 * ============================================================================ */

export const ShellEditor = forwardRef<ShellEditorHandle, Props>(function ShellEditor(
  { code, fontSize, wordWrap, onChange, onCursor, onInspect, onSemanticInspect, onRun },
  ref,
) {
  const node = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { safariNoZoomFontExtension } = usePreventPageZoom({
    containerRef: node,
    visualFontSize: fontSize,
  });

  const fontCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const callbacks = useRef<EditorCallbacks>({ onChange, onCursor, onInspect, onSemanticInspect, onRun });
  callbacks.current = { onChange, onCursor, onInspect, onSemanticInspect, onRun };

  useImperativeHandle(
    ref,
    () => ({
      insert(text) {
        const view = editor.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      focus() {
        editor.current?.focus();
      },
      reveal(from, to) {
        const view = editor.current;
        if (!view) return;
        if (from < 0 || to < from || to > view.state.doc.length) return;
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: [EditorView.scrollIntoView(from, { y: 'center' }), setAstReveal.of(Decoration.set(Array.from({ length: view.state.doc.lineAt(Math.max(from, to - 1)).number - view.state.doc.lineAt(from).number + 1 }, (_, i) => Decoration.line({ class: 'cm-ast-reveal-line' }).range(view.state.doc.line(view.state.doc.lineAt(from).number + i).from))))],
          scrollIntoView: true,
        });
        if (revealTimer.current !== null) clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => { if (editor.current === view) view.dispatch({ effects: setAstReveal.of(Decoration.none) }); }, 3500);
        node.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }),
    [],
  );

  useEffect(() => {
    if (!node.current) return;
    let autosuggestRequest = 0;

    const view = new EditorView({
      parent: node.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          oneDark,
          shell(),
          embeddedShellHighlight,
          shellHoverTooltip,
          diagnosticsField,
          astRevealField,
          autosuggestionField,
          autosuggestionDecorations,
          shellTheme,
          fontCompartment.current.of(safariNoZoomFontExtension),
          wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
          EditorState.tabSize.of(EDITOR_LIMITS.tabSizeSpaces),
          keymap.of([
            { key: EDITOR_KEYBINDS.acceptAutosuggestionAll, run: (v) => applyAutosuggestion(v, 'all') },
            { key: EDITOR_KEYBINDS.acceptAutosuggestionWord, run: (v) => applyAutosuggestion(v, 'word') },
            indentWithTab,
            {
              key: EDITOR_KEYBINDS.runScript,
              run() {
                callbacks.current.onRun();
                return true;
              },
            },
          ]),
          autocompletion({
            override: [shellCompletionSource],
            activateOnTyping: true,
            maxRenderedOptions: EDITOR_LIMITS.maxAutocompleteOptions,
            closeOnBlur: false,
          }),
          placeholder(EDITOR_COPY.placeholder),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }

            if (update.docChanged || update.selectionSet) {
              const selection = update.state.selection.main;
              const pos = selection.head;
              const source = update.state.doc.toString();
              callbacks.current.onCursor(pos);

              const request = ++autosuggestRequest;
              if (selection.empty) {
                void shellAutosuggestion(source, pos).then((suggestion) => {
                  const current = editor.current;
                  if (
                    request !== autosuggestRequest ||
                    !current ||
                    current.state.doc.toString() !== source ||
                    !current.state.selection.main.empty ||
                    current.state.selection.main.head !== pos
                  ) {
                    return;
                  }
                  current.dispatch({ effects: setAutosuggestion.of(suggestion) });
                });
              }

              // Keyboard navigation and iOS caret movement use the same
              // semantic selection as pointer interaction.
              void explainKnownShellTokens(source).then((tokens) => {
                const current = editor.current;
                if (!current || current.state.doc.toString() !== source || current.state.selection.main.head !== pos) {
                  return;
                }
                const token = findTokenAtOffset(tokens, pos);
                if (token) {
                  callbacks.current.onSemanticInspect(withSyntaxContext(token, current.state));
                }
              });
            }
          }),
          EditorView.domEventHandlers({
            pointerup(event, instance) {
              const pos = instance.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              const source = instance.state.doc.toString();

              void explainKnownShellTokens(source).then((tokens) => {
                const current = editor.current;
                if (!current || current.state.doc.toString() !== source) return;
                const token = findTokenAtOffset(tokens, pos);
                if (!token) return;
                callbacks.current.onSemanticInspect(withSyntaxContext(token, current.state));
                if (token.kind === 'command' && byName.has(token.text)) {
                  callbacks.current.onInspect(token.text);
                }
              });

              return false;
            },
          }),
        ],
      }),
    });

    editor.current = view;
    return () => {
      if (revealTimer.current !== null) clearTimeout(revealTimer.current);
      view.destroy();
      editor.current = null;
    };
    // Editor must be created once. New values are synchronized by the effects below.
  }, []);

  useEffect(() => {
    editor.current?.dispatch({
      effects: fontCompartment.current.reconfigure(safariNoZoomFontExtension),
    });
  }, [safariNoZoomFontExtension]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const view = editor.current;
      if (!view) return;
      const source = view.state.doc.toString();
      const findings = await checkShell(source).catch(() => []);
      if (cancelled || editor.current !== view || view.state.doc.toString() !== source) return;

      view.dispatch({
        effects: setDiagnostics.of(buildDiagnosticDecorations(view.state, findings)),
      });
    }, EDITOR_LIMITS.diagnosticsDebounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === code) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  }, [code]);

  return (
    <div
      ref={node}
      className={EDITOR_CSS_CLASSES.root}
      role="textbox"
      aria-label={EDITOR_COPY.ariaLabel}
      style={{ touchAction: TOUCH_ACTION_PAN_ONLY }}
    />
  );
});
