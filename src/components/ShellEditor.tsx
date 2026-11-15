import * as React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { checkShell } from '../lib/shellcheck';
import { embeddedShellHighlight } from '../lib/highlight';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { shell } from '@codincod/codemirror-lang-shell';
import { oneDark } from '@codemirror/theme-one-dark';
import { contextualHints } from '../lib/suggestions';
import { byName, SNIPPETS } from '../lib/commands';

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

export type ShellEditorHandle = { insert(text: string): void; focus(): void };
type Props = {
  code: string;
  onChange(value: string): void;
  onCursor(value: number): void;
  onInspect(command: string): void;
  onRun(): void;
};

const shellTheme = EditorView.theme({
  '&': { fontSize: '11px', height: '100%', background: '#090b0f' },
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
  { code, onChange, onCursor, onInspect, onRun }, ref,
) {
  const node = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onCursor, onInspect, onRun });
  callbacks.current = { onChange, onCursor, onInspect, onRun };

  useImperativeHandle(ref, () => ({
    insert(text) {
      const view = editor.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    focus() { editor.current?.focus(); },
  }), []);

  useEffect(() => {
    if (!node.current) return;
    const complete = (context: CompletionContext) => {
      const before = context.matchBefore(/[\w.+-]*/);
      if (!before || (!context.explicit && before.from === before.to)) return null;
      const source = context.state.doc.toString();
      const hints = contextualHints(source, context.pos);
      const snippets = before.text ? SNIPPETS.filter(s => s.id.startsWith(before.text)) : [];
      const options = [
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
          diagnosticsField,
          shellTheme,
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          keymap.of([indentWithTab, { key: 'Mod-Enter', run() { callbacks.current.onRun(); return true; } }]),
          autocompletion({ override: [complete], activateOnTyping: true, maxRenderedOptions: 8, closeOnBlur: false }),
          placeholder('Cole um script do ChatGPT ou comece a escrever…'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) callbacks.current.onCursor(update.state.selection.main.head);
          }),
          EditorView.domEventHandlers({
            pointerup(event, instance) {
              const pos = instance.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              const line = instance.state.doc.lineAt(pos);
              const at = pos - line.from;
              const matcher = /(?:^|[|;&]\s*)(?:sudo\s+)?([\w.+-]+)/g;
              for (const match of line.text.matchAll(matcher)) {
                const index = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
                if (at >= index && at <= index + match[1].length && byName.has(match[1])) {
                  callbacks.current.onInspect(match[1]);
                  break;
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
