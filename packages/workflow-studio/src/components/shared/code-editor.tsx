import { autocompletion, startCompletion, completionKeymap } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, placeholder as hint } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { materialDark } from '@uiw/codemirror-theme-material';
const external = Annotation.define<boolean>();
export function CodeEditor({
  value,
  onChange,
  disabled = false,
  placeholder = '',
  script = false,
  expression = false,
  suggestions = [],
  ariaLabel = 'Code editor',
  completionDescription = 'Context reference',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  script?: boolean;
  expression?: boolean;
  suggestions?: string[];
  ariaLabel?: string;
  completionDescription?: string;
}) {
  const options = useRef(suggestions);
  options.current = suggestions;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const access = useRef(new Compartment());
  const hints = useRef(new Compartment());
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          ...(script || expression ? [] : [yaml()]),
          ...(expression
            ? [
                autocompletion({
                  override: [
                    (context) => {
                      if (context.state.readOnly) return null;
                      const token = context.matchBefore(/[\w.-]+/);
                      if (!token && !context.explicit) return null;
                      return {
                        from: token?.from ?? context.pos,
                        options: [...new Set(options.current)].map((label) => ({
                          label,
                          type: 'variable',
                          detail: label.split('.')[0],
                          info: completionDescription,
                        })),
                      };
                    },
                  ],
                  activateOnTyping: true,
                }),
                keymap.of(completionKeymap),
              ]
            : []),
          materialDark,
          EditorView.theme(
            {
              '&': { backgroundColor: '#212121' },
              '.cm-gutters': { backgroundColor: '#212121', color: '#999' },
              '.cm-activeLine,.cm-activeLineGutter': {
                backgroundColor: '#303030',
              },
            },
            { dark: true },
          ),
          EditorView.lineWrapping,
          access.current.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
          hints.current.of(hint(placeholder)),
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            autocapitalize: 'off',
            spellcheck: 'false',
            autocorrect: 'off',
          }),
          EditorView.theme({
            '&': { fontSize: '16px', borderRadius: '8px', overflow: 'hidden' },
            '.cm-scroller': {
              minHeight: script ? '160px' : '48px',
              maxHeight: script ? '45cqh' : '220px',
              overflow: 'auto',
            },
            '.cm-content': { padding: '6px 0' },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external)))
              change.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [script, expression, ariaLabel, completionDescription]);
  useEffect(() => {
    const e = view.current;
    if (e && e.state.doc.toString() !== value)
      e.dispatch({
        changes: { from: 0, to: e.state.doc.length, insert: value },
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: access.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
    });
  }, [disabled]);
  useEffect(() => {
    view.current?.dispatch({
      effects: hints.current.reconfigure(hint(placeholder)),
    });
  }, [placeholder]);
  return (
    <div>
      {expression && (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => {
            if (view.current) {
              view.current.focus();
              startCompletion(view.current);
            }
          }}
        >
          Autocomplete
        </Button>
      )}
      {expression && suggestions.length > 0 && (
        <select
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1 text-base"
          aria-label="Complete expression"
          value=""
          onChange={(e) => {
            const editor = view.current;
            if (!editor || disabled || !e.target.value) return;
            const pos = editor.state.selection.main.head;
            const prefix = editor.state.sliceDoc(0, pos).match(/[\w.]+$/)?.[0] ?? '';
            const insert = e.target.value;
            editor.dispatch({
              changes: { from: pos - prefix.length, to: pos, insert },
              selection: { anchor: pos - prefix.length + insert.length },
            });
          }}
          disabled={disabled}
        >
          <option value="">Complete reference…</option>
          {suggestions.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      <div ref={host} className="min-w-0 overflow-hidden rounded-lg border border-border" />
    </div>
  );
}
