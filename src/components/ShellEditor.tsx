import * as React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { checkShell } from '../lib/shellcheck';
import { embeddedShellHighlight } from '../lib/highlight';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { shell } from '@codincod/codemirror-lang-shell';
import { syntaxTree } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { contextualHints } from '../lib/suggestions';
import figCurl from '../lib/specs/fig-curl.json';
import { fromFigWords } from '../lib/completion-sources';
import { activeShellCommand } from '../lib/shell-command-ast';
import { explainKnownShellTokens, type SemanticToken } from '../lib/semantic-shell';
import { hoverTooltip } from '@codemirror/view';
import { byName, SNIPPETS } from '../lib/commands';

/**
 * Lezer supplies structural context for the shell editor. This is a syntax
 * breadcrumb, not a claim that the editor grammar is a full semantic Bash AST.
 */
function withSyntaxContext(token: SemanticToken, state: EditorState): SemanticToken {
  const root = syntaxTree(state);
  if (token.from >= root.length) return token;
  let node: ReturnType<typeof root.resolveInner> | null = root.resolveInner(token.from, 1);
  const names: string[] = [];
  while (node && names.length < 8) {
    if (!node.type.isAnonymous && node.name && node.name !== '⚠') names.push(node.name);
    node = node.parent;
  }
  const path = names.reverse().join(' › ');
  if (!path) return token;
  return {
    ...token,
    description: token.description + '\\n\\nEstrutura sintática (CodeMirror): ' + path,
  };
}

const setDiagnostics = StateEffect.define<DecorationSet>();
const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setDiagnostics)) value = effect.value;
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

export type ShellEditorHandle = { insert(text: string): void; focus(): void; reveal(from: number, to: number): void };
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

const shellTheme = EditorView.theme({
  '&': { height: '100%', background: '#090b0f' },
  '.cm-scroller': { fontFamily: "'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace", overflow: 'auto' },
  '.cm-content': { minHeight: '390px', padding: '8px 3px 10px', caretColor: '#f4f4f5' },
  '.cm-line': { padding: '0 4px' },
  '.cm-gutters': { background: '#090b0f', borderRight: '1px solid #1e222a', color: '#4b5563' },
  '.cm-activeLine': { background: '#15181e' },
  '.cm-activeLineGutter': { background: '#15181e' },
  '.cm-cursor': { borderLeftColor: '#fff' },
  '.cm-selectionBackground': { background: '#334155 !important' },
  '.cm-tooltip-autocomplete': { background: '#17181c', color: '#f5f5f5', border: '1px solid #34363e', borderRadius: '10px', overflow: 'hidden', maxWidth: 'min(92vw, 440px)', boxShadow: '0 12px 40px #0008' },
  '.cm-tooltip-autocomplete ul': { fontFamily: 'inherit', maxHeight: '220px' },
  '.cm-tooltip-autocomplete ul li': { padding: '7px 11px', lineHeight: '1.6' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: '#303641', color: '#fff' },
  '.cm-completionDetail': { fontStyle: 'normal', color: '#a1a1aa', paddingLeft: '14px' },
  '.cm-tooltip.cm-completionInfo': { background: '#17181c', border: '1px solid #34363e', maxWidth: '280px', whiteSpace: 'pre-wrap' },
  '.cm-focused': { outline: 'none' },
  '.shell-diagnostic': { textDecoration: 'underline wavy #f59e0b', textUnderlineOffset: '3px' },
  '.shell-diagnostic-error': { textDecorationColor: '#fb7185' },
}, { dark: true });

export const ShellEditor = forwardRef<ShellEditorHandle, Props>(function ShellEditor(
  { code, fontSize, wordWrap, onChange, onCursor, onInspect, onSemanticInspect, onRun }, ref,
) {
  const node = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const fontCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onCursor, onInspect, onSemanticInspect, onRun });
  callbacks.current = { onChange, onCursor, onInspect, onSemanticInspect, onRun };

  useImperativeHandle(ref, () => ({
    insert(text) {
      const view = editor.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    focus() { editor.current?.focus(); },
    reveal(from, to) {
      const view = editor.current;
      if (!view) return;
      if (from < 0 || to < from || to > view.state.doc.length) return;
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      view.focus();
    },
  }), []);

  useEffect(() => {
    if (!node.current) return;
    const complete = async (context: CompletionContext) => {
      const before = context.matchBefore(/[\w.+-]*/);
      if (!before || (!context.explicit && before.from === before.to)) return null;
      const source = context.state.doc.toString();
      const hints = contextualHints(source, context.pos);
      const snippets = before.text ? SNIPPETS.filter(s => s.id.startsWith(before.text)) : [];
      // mvdan/sh AST determines the active command and its argument boundaries.
      // No regex pipeline splitting, quote guessing or shell token scanner.
      const active = await activeShellCommand(source, context.pos);
      const figOptions = active?.executable === 'curl' && before.text.startsWith('-')
        && !active.words.includes('--')
        ? fromFigWords(figCurl, active.words)
          .filter(item => item.kind === 'option' && item.name.startsWith(before.text))
          .map(item => ({ label: item.name, type: 'property', detail: 'Fig · curl', info: item.description, apply: item.name }))
        : [];
      const options = [
        ...figOptions,
        ...hints.map(h => ({
          label: h.label,
          type: h.kind === 'flag' ? 'property' : 'function',
          detail: h.title,
          info: h.description + '\n\nExemplo: ' + h.example,
          apply: h.label,
        })),
        ...snippets.map(s => ({ label: s.id, type: 'keyword', detail: s.subtitle, info: s.code, apply: s.code })),
      ];
      return { from: before.from, options, validFor: /^[\w.+-]*$/ };
    };
    const view = new EditorView({
      parent: node.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          oneDark,
          shell(),
          embeddedShellHighlight,
          hoverTooltip((view, pos) => {
            const match = explainKnownShellTokens(view.state.doc.toString())
              .find((item) => item.from <= pos && pos < item.to);
            if (!match) return null;
            const token = withSyntaxContext(match, view.state);
            return {
              pos: token.from,
              end: token.to,
              above: true,
              create() {
                const dom = document.createElement('div');
                dom.className = 'shell-semantic-tooltip';
                dom.style.cssText = 'max-width:min(85vw,360px);padding:10px 12px;white-space:normal;background:#17181c;color:#f5f5f5;border:1px solid #34363e;border-radius:10px;line-height:1.5';
                const title = document.createElement('strong');
                title.textContent = token.title;
                const detail = document.createElement('div');
                detail.textContent = token.description;
                dom.append(title, detail);
                if (token.example) {
                  const example = document.createElement('code');
                  example.textContent = token.example;
                  example.style.cssText = 'display:block;margin-top:6px;white-space:pre-wrap;color:#a5b4fc';
                  dom.append(example);
                }
                return { dom };
              },
            };
          }, { hoverTime: 250 }),
          diagnosticsField,
          shellTheme,
          fontCompartment.current.of(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
          wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
          EditorState.tabSize.of(2),
          keymap.of([indentWithTab, { key: 'Mod-Enter', run() { callbacks.current.onRun(); return true; } }]),
          autocompletion({ override: [complete], activateOnTyping: true, maxRenderedOptions: 8, closeOnBlur: false }),
          placeholder('Cole um script do ChatGPT ou comece a escrever…'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              const pos = update.state.selection.main.head;
              callbacks.current.onCursor(pos);
              // Keyboard navigation and iOS caret movement use the same
              // semantic selection as pointer interaction.
              const token = explainKnownShellTokens(update.state.doc.toString())
                .find((item) => item.from <= pos && pos < item.to);
              if (token) callbacks.current.onSemanticInspect(withSyntaxContext(token, update.state));
            }
          }),
          EditorView.domEventHandlers({
            pointerup(event, instance) {
              const pos = instance.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              const token = explainKnownShellTokens(instance.state.doc.toString())
                .find((item) => item.from <= pos && pos < item.to);
              if (token) {
                callbacks.current.onSemanticInspect(withSyntaxContext(token, instance.state));
                if (token.kind === 'command' && byName.has(token.text)) {
                  callbacks.current.onInspect(token.text);
                }
              }
              return false;
            },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => { view.destroy(); editor.current = null; };
  // Editor must be created once. New values are synchronized by the effect below.
  }, []);

  useEffect(() => {
    editor.current?.dispatch({ effects: fontCompartment.current.reconfigure(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })) });
  }, [fontSize]);

  useEffect(() => {
    editor.current?.dispatch({ effects: wrapCompartment.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
  }, [wordWrap]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const view = editor.current;
      if (!view) return;
      const source = view.state.doc.toString();
      const findings = await checkShell(source).catch(() => []);
      if (cancelled || editor.current !== view || view.state.doc.toString() !== source) return;
      const marks = findings.flatMap(finding => {
        const line = view.state.doc.line(Math.max(1, Math.min(finding.line, view.state.doc.lines)));
        const from = Math.min(line.to, line.from + Math.max(0, finding.column - 1));
        const to = Math.min(line.to, Math.max(from + 1, line.from + (finding.endColumn ?? finding.column + 1) - 1));
        return from < to ? [Decoration.mark({ class: finding.level === 'error' ? 'shell-diagnostic shell-diagnostic-error' : 'shell-diagnostic', attributes: { title: finding.message, 'aria-label': finding.message } }).range(from, to)] : [];
      });
      view.dispatch({ effects: setDiagnostics.of(Decoration.set(marks, true)) });
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === code) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  }, [code]);

  return <div ref={node} className="code-editor" role="textbox" aria-label="Editor de shell" />;
});
