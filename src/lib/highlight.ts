import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

// Small embedded-argument highlighter to augment the Bash grammar. It does not
// attempt to parse arbitrary nested AWK/JQ/Sed programs or execute any input.
const tokenPatterns: Record<string, Array<[RegExp, string]>> = {
  awk: [
    [/\b(?:BEGIN|END|print|printf|if|else|for|while|next|exit|function|NF|NR|FS|OFS)\b/g, 'keyword'],
    [/\$\d+|\b[A-Za-z_]\w*(?=\[)/g, 'field'],
    [/\/[^/\n]+\//g, 'regexp'],
    [/\b\d+(?:\.\d+)?\b/g, 'number'],
  ],
  jq: [
    [/\b(?:map|select|sort_by|group_by|length|keys|values|has|del|empty|reduce|foreach|if|then|elif|else|end|true|false|null|as|def)\b/g, 'keyword'],
    [/\.[a-zA-Z_][\w]*(?:\.[a-zA-Z_]\w*)*|\[\]/g, 'field'],
    [/\b\d+(?:\.\d+)?\b/g, 'number'],
  ],
  sed: [
    [/\b(?:s|p|d|g|a|i|c|q|n)(?=\/|$)/g, 'keyword'],
    [/\/[^/\n]*\//g, 'regexp'],
  ],
};
const compiled = /(?:^|[|;&]\s*)(awk|jq|sed)\b[^\n]*?(['"])(.*?)\2/g;
function ranges(view: EditorView) {
  const marks: Array<{ from: number; to: number; cls: string }> = [];
  for (const { from, to } of view.visibleRanges) {
    for (let at = view.state.doc.lineAt(from).number; at <= view.state.doc.lineAt(to).number; at++) {
      const line = view.state.doc.line(at);
      for (const command of line.text.matchAll(compiled)) {
        const value = command[3];
        if (!value) continue;
        const start = (command.index || 0) + command[0].lastIndexOf(value);
        const spans: Array<{ from: number; to: number; cls: string }> = [];
        for (const [pattern, cls] of tokenPatterns[command[1]]) {
          for (const match of value.matchAll(pattern)) {
            const localFrom = start + (match.index || 0);
            const localTo = localFrom + match[0].length;
            if (spans.some((s) => localFrom < s.to && localTo > s.from)) continue;
            spans.push({ from: localFrom, to: localTo, cls });
          }
        }
        marks.push(...spans.map((span) => ({ from: line.from + span.from, to: line.from + span.to, cls: span.cls })));
      }
    }
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks.sort((a,b) => a.from - b.from || a.to - b.to)) {
    if (mark.from < mark.to) builder.add(mark.from, mark.to, Decoration.mark({ class: 'cm-embedded-' + mark.cls }));
  }
  return builder.finish();
}
export const embeddedShellHighlight = ViewPlugin.fromClass(class {
  decorations;
  constructor(view: EditorView) { this.decorations = ranges(view); }
  update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = ranges(update.view); }
}, { decorations: (instance) => instance.decorations });
