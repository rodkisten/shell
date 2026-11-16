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
  const utf16ToByte = new Map<number, number>();
  const encoder = new TextEncoder();
  let byte = 0;
  for (let i = 0; i < source.length;) {
    const point = source.codePointAt(i);
    if (point === undefined) break;
    const char = String.fromCodePoint(point);
    byteToUtf16.set(byte, i);
    utf16ToByte.set(i, byte);
    if (char === '\n') lineOffsets.push(i + char.length);
    byte += encoder.encode(char).length;
    i += char.length;
  }
  byteToUtf16.set(byte, source.length);
  utf16ToByte.set(source.length, byte);
  return { byteToUtf16, utf16ToByte, lineOffsets };
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
  const byteStart = index.utf16ToByte.get(start);
  return byteStart === undefined ? undefined : index.byteToUtf16.get(byteStart + col - 1);
}

function kindOf(obj: Record<string, unknown>, label: string): string {
  for (const key of ['type', 'Type', 'kind', 'Kind', 'nodeType', 'NodeType']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return label;
}

/** Only genuine shell constructs get semantic descriptions. */
function explainNode(kind: string, obj: Record<string, unknown>): string {
  const fallback = descriptions[kind] ?? 'Estrutura sintática identificada; comportamento não inferido.';
  if (kind === 'Stmt') {
    const background = obj.Background ?? obj.background;
    const negated = obj.Negated ?? obj.negated;
    const flags = [
      background === true ? 'Executa em segundo plano.' : '',
      negated === true ? 'Inverte o status de saída do comando.' : '',
    ].filter(Boolean);
    return flags.length ? fallback + ' ' + flags.join(' ') : fallback;
  }
  if (kind === 'BinaryCmd') {
    const op = obj.Op ?? obj.op;
    if (typeof op === 'string') {
      const meaning: Record<string, string> = {
        '&&': 'O comando à direita só executa se o da esquerda tiver sucesso.',
        '||': 'O comando à direita só executa se o da esquerda falhar.',
        '|': 'A saída padrão à esquerda alimenta a entrada padrão à direita.',
        '|&': 'Saída padrão e erros à esquerda alimentam o próximo comando.',
      };
      return meaning[op] ?? fallback;
    }
  }
  if (kind === 'Redirect') {
    const op = obj.Op ?? obj.op;
    if (typeof op === 'string') {
      const meaning: Record<string, string> = {
        '>': 'Redireciona a saída, substituindo o conteúdo do destino.',
        '>>': 'Acrescenta a saída ao destino.',
        '<': 'Lê a entrada do destino.',
        '<<': 'Usa um here-document como entrada.',
        '<<<': 'Usa uma string como entrada.',
      };
      return meaning[op] ?? fallback;
    }
  }
  return fallback;
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
    // Ignore standalone position records and arbitrary metadata objects.
    if ((typeof obj.Offset === 'number' || typeof obj.offset === 'number') &&
        !('Pos' in obj) && !('pos' in obj) && !('End' in obj) && !('end' in obj)) return;
    const kind = kindOf(obj, label);
    const from = position(obj.Pos ?? obj.pos ?? obj.Start ?? obj.start, index);
    const to = position(obj.End ?? obj.end ?? obj.Stop ?? obj.stop, index);
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
      description: explainNode(kind, obj),
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
