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

function position(value: unknown, lineOffsets: number[], source: string): number | undefined {
  const obj = record(value);
  if (!obj) return undefined;
  // mvdan offsets are UTF-8 byte offsets, whereas CodeMirror uses UTF-16.
  // Prefer line/column conversion below; raw byte offsets need conversion.
  const offset = obj.Offset ?? obj.offset;
  const line = obj.Line ?? obj.line;
  const col = obj.Col ?? obj.col ?? obj.Column ?? obj.column;
  if (typeof line === 'number' && typeof col === 'number' && line > 0 && col > 0) {
    const start = lineOffsets[line - 1];
    if (start !== undefined) {
      const lineEnd = source.indexOf('\n', start);
      const content = source.slice(start, lineEnd < 0 ? undefined : lineEnd);
      const bytes = new TextEncoder().encode(content);
      const prefix = bytes.slice(0, col - 1);
      const decoded = new TextDecoder().decode(prefix);
      if (new TextEncoder().encode(decoded).length === prefix.length) return start + decoded.length;
    }
  }
  if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0) {
    const encoded = new TextEncoder().encode(source);
    if (offset > encoded.length) return undefined;
    const prefix = encoded.slice(0, offset);
    const decoded = new TextDecoder().decode(prefix);
    if (new TextEncoder().encode(decoded).length === prefix.length) return decoded.length;
  }
  return undefined;
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
  const lineOffsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineOffsets.push(i + 1);
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
    const kind = kindOf(obj, label);
    const from = position(obj.Pos ?? obj.pos ?? obj.Start ?? obj.start, lineOffsets, source);
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
      if (['Pos', 'End', 'pos', 'end', 'Start', 'Stop', 'start', 'stop'].includes(key)) continue;
      if (child && typeof child === 'object') visit(child, depth + 1, key, id);
    }
  }

  visit(ast, 0, 'File');
  const navigableCount = nodes.filter(node => node.navigable).length;
  return { lines, nodes, count: nodes.length, navigableCount,
    unresolvedCount: nodes.length - navigableCount, truncated };
}
