import * as React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { embeddedShellHighlight } from '../lib/highlight';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { shell } from '@codincod/codemirror-lang-shell';
import { oneDark } from '@codemirror/theme-one-dark';
import { contextualHints } from '../lib/suggestions';
import { byName, SNIPPETS } from '../lib/commands';

export type ShellEditorHandle = { insert(text: string): void; focus(): void };
type Props = {
  code: string;
  onChange(value: string): void;
  onCursor(value: number): void;
  onInspect(command: string): void;
  onRun(): void;
};

const shellTheme = EditorView.theme({
  '&': { fontSize: '13px', height: '100%', background: '#090b0f' },
  '.cm-scroller': { fontFamily: "'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace", overflow: 'auto' },
  '.cm-content': { minHeight: '390px', padding: '17px 8px 30px', caretColor: '#f4f4f5' },
  '.cm-line': { padding: '0 8px' },
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
    const view = editor.current;
    if (!view || view.state.doc.toString() === code) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  }, [code]);

  return <div ref={node} className="code-editor" role="textbox" aria-label="Editor de shell" />;
});
