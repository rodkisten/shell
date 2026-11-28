import { autocompletion } from '@codemirror/autocomplete';
import { references } from './expression-fields';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { materialDark } from '@uiw/codemirror-theme-material';
import type { ParserDiagnostic } from './live-parser';
const externalUpdate = Annotation.define<boolean>();
const selectionEffect = StateEffect.define<{ from: number; to: number }>();
const selectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged || tr.selection) value = Decoration.none;
    for (const effect of tr.effects)
      if (effect.is(selectionEffect)) {
        const { from, to } = effect.value;
        value =
          from < to
            ? Decoration.set([Decoration.mark({ class: 'orb-linked-range' }).range(from, to)])
            : Decoration.none;
      }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const diagnosticsEffect = StateEffect.define<ParserDiagnostic[]>();
const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const effect of tr.effects)
      if (effect.is(diagnosticsEffect)) {
        value = Decoration.set(
          effect.value.flatMap((d) =>
            d.offset !== null && d.offset >= 0 && d.offset < tr.state.doc.length
              ? [
                  Decoration.mark({
                    class: 'orb-diagnostic-' + d.severity,
                    attributes: { title: d.message },
                  }).range(d.offset, d.offset + 1),
                ]
              : [],
          ),
          true,
        );
      }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
export type SourceEditorHandle = {
  select: (from: number, to: number, reveal?: boolean) => void;
};
export const SourceEditor = forwardRef<
  SourceEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onCursor?: (offset: number) => void;
    diagnostics?: ParserDiagnostic[];
    contextBody?: string;
  }
>(function SourceEditor({ value, onChange, onCursor, diagnostics, contextBody }, ref) {
  const context = useRef(contextBody);
  context.current = contextBody;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const cursor = useRef(onCursor);
  cursor.current = onCursor;
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          diagnosticsField,
          selectionField,
          basicSetup,
          yaml(),
          autocompletion({
            override: [
              (ctx) => {
                const before = ctx.state.sliceDoc(0, ctx.pos);
                const open = before.lastIndexOf('$' + '{{');
                if (open < 0 || before.lastIndexOf('}}') > open) return null;
                const token = ctx.matchBefore(/[\w.-]+/);
                if (!token && !ctx.explicit) return null;
                let job = '',
                  step: number | undefined;
                try {
                  const model = JSON.parse(context.current ?? '{}') as {
                    nodes?: {
                      path: (string | number)[];
                      range: { from: number; to: number } | null;
                    }[];
                  };
                  const nodes = model.nodes ?? [];
                  const within = nodes.filter(
                    (n) => n.range && n.range.from <= open && open < n.range.to && n.path[0] === 'jobs',
                  );
                  const j = within.find((n) => n.path.length === 2);
                  if (typeof j?.path[1] === 'string') job = j.path[1];
                  const st = within.find((n) => n.path.length === 4 && n.path[2] === 'steps');
                  if (typeof st?.path[3] === 'number') step = st.path[3];
                } catch {
                  /* Incomplete source has no inspector data; the parser displays diagnostics. */
                }
                const options = references(context.current ?? '', job, step).map((r) => ({
                  label: r.value,
                  type: 'variable',
                  detail: r.group,
                  info: 'Reference from current workflow',
                }));
                return { from: token?.from ?? ctx.pos, options };
              },
            ],
          }),
          materialDark,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'YAML source',
            autocapitalize: 'off',
            spellcheck: 'false',
            autocorrect: 'off',
          }),
          EditorView.theme({
            '&': { minHeight: '300px' },
            '.cm-scroller': { maxHeight: '65cqh', overflow: 'auto' },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(externalUpdate)))
              change.current(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) cursor.current?.(u.state.selection.main.from);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useEffect(() => {
    const e = view.current;
    if (e && e.state.doc.toString() !== value)
      e.dispatch({
        changes: { from: 0, to: e.state.doc.length, insert: value },
        annotations: [externalUpdate.of(true), Transaction.addToHistory.of(false)],
      });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: diagnosticsEffect.of(diagnostics ?? []),
    });
  }, [diagnostics, value]);
  useImperativeHandle(
    ref,
    () => ({
      select(from, to, reveal = false) {
        const e = view.current;
        if (!e || from < 0 || to < from || to > e.state.doc.length) return;
        e.dispatch({
          effects: [
            selectionEffect.of({ from, to }),
            ...(reveal ? [EditorView.scrollIntoView(from, { y: 'center' })] : []),
          ],
        });
      },
    }),
    [],
  );
  return <div ref={host} />;
});
