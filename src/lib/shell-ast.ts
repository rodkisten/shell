/**
 * Bounded structural visitor for the mvdan/sh AST exposed by sh-syntax.
 * This is a syntax navigator, not a shell interpreter.
 */
export type ShellAstNode = {
  id: string;
  kind: string;
  label: string;
  depth: number;
  from?: number;
  to?: number;
  parentId?: string;
  description: string;
  navigable: boolean;
};
export type AstOverview = {
  lines: string[];
  nodes: ShellAstNode[];
  truncated: boolean;
  count: number;
  navigableCount: number;
  unresolvedCount: number;
};

const descriptions: Record<string, string> = {
  Stmt: 'Instrução do shell, possivelmente com redirecionamentos e execução em segundo plano.',
  CallExpr: 'Invocação de comando com argumentos e atribuições.',
  IfClause: 'Desvio condicional: executa um ramo conforme o resultado da condição.',
  WhileClause: 'Laço que repete enquanto a condição tiver sucesso.',
  ForClause: 'Laço que percorre valores ou parâmetros.',
  CaseClause: 'Escolha de ramo conforme padrões.',
  FuncDecl: 'Declaração de função shell.',
  BinaryCmd: 'Combinação de comandos por pipeline ou operadores condicionais.',
  Subshell: 'Comandos executados em um subshell.',
  Block: 'Bloco de instruções.',
  CmdSubst: 'Substituição de comando: captura a saída de uma execução.',
  ParamExp: 'Expansão de parâmetro ou variável.',
  ArithmExp: 'Expansão aritmética.',
  Redirect: 'Redirecionamento de entrada ou saída.',
  Assign: 'Atribuição de variável ou argumento de ambiente.',
  Word: 'Palavra shell; pode conter partes literais e expansões.',
  Lit: 'Trecho literal de uma palavra.',
  DblQuoted: 'Trecho entre aspas duplas, sujeito a expansões.',
  SglQuoted: 'Trecho entre aspas simples, sem expansão de parâmetros.',
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * mvdan/sh positions are UTF-8 byte offsets. Build a single boundary map so
 * hundreds of AST nodes don't repeatedly encode the complete source.
 * Continuation bytes intentionally have no mapping: they cannot represent a
 * valid CodeMirror UTF-16 boundary.
 */
function positionIndex(source: string) {
  const byteToUtf16 = new Map<number, number>();
  const lineOffsets = [0];
  const encoder = new TextEncoder();
  let byte = 0;
  for (let i = 0; i < source.length;) {
    const point = source.codePointAt(i);
    if (point === undefined) break;
    const char = String.fromCodePoint(point);
    byteToUtf16.set(byte, i);
    if (char === '\n') lineOffsets.push(i + char.length);
    byte += encoder.encode(char).length;
    i += char.length;
  }
  byteToUtf16.set(byte, source.length);
  return { byteToUtf16, lineOffsets };
}

function position(value: unknown, index: ReturnType<typeof positionIndex>): number | undefined {
  const obj = record(value);
  if (!obj) return undefined;
  const offset = obj.Offset ?? obj.offset;
  if (typeof offset === 'number' && Number.isSafeInteger(offset))
    return index.byteToUtf16.get(offset);
  const line = obj.Line ?? obj.line;
  const col = obj.Col ?? obj.col ?? obj.Column ?? obj.column;
  if (typeof line !== 'number' || typeof col !== 'number' ||
      !Number.isSafeInteger(line) || !Number.isSafeInteger(col) || line < 1 || col < 1)
    return undefined;
  const start = index.lineOffsets[line - 1];
  if (start === undefined) return undefined;
  // Columns from mvdan are byte-based, not JavaScript string indices.
  const byteStart = [...index.byteToUtf16.entries()].find(([, utf16]) => utf16 === start)?.[0];
  return byteStart === undefined ? undefined : index.byteToUtf16.get(byteStart + col - 1);
}

function kindOf(obj: Record<string, unknown>, label: string): string {
  for (const key of ['type', 'Type', 'kind', 'Kind', 'nodeType', 'NodeType']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return label;
}

export function inspectShellAst(ast: unknown, source = '', maxNodes = 350, maxDepth = 18): AstOverview {
  const nodes: ShellAstNode[] = [];
  const lines: string[] = [];
  const seen = new WeakSet<object>();
  const index = positionIndex(source);
  let truncated = false;

  function visit(value: unknown, depth: number, label: string, parentId?: string): void {
    if (!value || typeof value !== 'object') return;
    if (nodes.length >= maxNodes || depth > maxDepth) { truncated = true; return; }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(value[i], depth, label, parentId);
      return;
    }
    const obj = record(value);
    if (!obj) return;
    // Position and other parser metadata are not syntax nodes.
    if (['Pos', 'End', 'Start', 'Stop', 'Position', 'Location', 'Loc'].includes(label)) return;
    const kind = kindOf(obj, label);
    const from = position(obj.Pos ?? obj.pos ?? obj.Start ?? obj.start, index);
    const to = position(obj.End ?? obj.end ?? obj.Stop ?? obj.stop, lineOffsets, source);
    const validRange = from !== undefined && to !== undefined &&
      from >= 0 && to > from && to <= source.length &&
      (parentId === undefined || (() => {
        const parent = nodes[Number(parentId)];
        return parent?.from === undefined || parent.to === undefined ||
          (from >= parent.from && to <= parent.to);
      })());
    const id = String(nodes.length);
    const node: ShellAstNode = {
      id, kind, label, depth, parentId,
      description: descriptions[kind] ?? 'Nó sintático do script shell.',
      navigable: validRange,
      ...(validRange ? { from, to } : {}),
    };
    nodes.push(node);
    const preview = validRange ? source.slice(from, Math.min(to, from + 55)).replace(/\s+/g, ' ') : '';
    lines.push('  '.repeat(depth) + kind + (preview ? ': ' + preview : ''));
    for (const [key, child] of Object.entries(obj)) {
      if (['Pos', 'End', 'pos', 'end', 'Start', 'Stop', 'start', 'stop', 'Position', 'Location', 'Loc'].includes(key)) continue;
      if (child && typeof child === 'object') visit(child, depth + 1, key, id);
    }
  }

  visit(ast, 0, 'File');
  const navigableCount = nodes.filter(node => node.navigable).length;
  return { lines, nodes, count: nodes.length, navigableCount,
    unresolvedCount: nodes.length - navigableCount, truncated };
}
