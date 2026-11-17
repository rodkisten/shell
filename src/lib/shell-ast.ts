import type { IndexedShellNode, ShellSnapshot } from './shell-parser';

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

function explainNode(entry: IndexedShellNode, snapshot: ShellSnapshot): string {
  const { node: obj, type: kind, from, to } = entry;
  const { source } = snapshot;
  const fallback = descriptions[kind] ?? 'Estrutura sintática identificada; comportamento não inferido.';

  if (kind === 'Stmt') {
    const flags = [
      obj.background === true ? 'Executa em segundo plano.' : '',
      obj.negated === true ? 'Inverte o status de saída do comando.' : '',
    ].filter(Boolean);
    return flags.length ? fallback + ' ' + flags.join(' ') : fallback;
  }
  if (kind === 'IfClause') {
    return Array.isArray(obj.cond) && obj.cond.length === 0
      ? 'Ramo else: executa quando as condições anteriores não tiveram sucesso.'
      : 'Avalia a condição; executa o ramo then somente quando ela tiver sucesso. Pode conter elif ou else.';
  }
  if (kind === 'ForClause') {
    return obj.select === true
      ? 'Menu select: apresenta opções e executa o corpo para a escolha realizada.'
      : 'Percorre os itens do laço e executa seu corpo para cada iteração.';
  }
  if (kind === 'CallExpr') {
    const assigns = Array.isArray(obj.assigns) ? obj.assigns.length : 0;
    const args = Array.isArray(obj.args) ? obj.args.length : 0;
    return assigns > 0 && args === 0
      ? 'Atribuição no shell, sem invocação explícita de comando.'
      : 'Executa o comando após processar palavras, argumentos, atribuições e expansões.';
  }
  if (kind === 'BinaryCmd') {
    const left = record(obj.x ?? obj.X);
    const right = record(obj.y ?? obj.Y);
    const leftEntry = left ? snapshot.byObject.get(left) : undefined;
    const rightEntry = right ? snapshot.byObject.get(right) : undefined;
    if (leftEntry?.to !== undefined && rightEntry?.from !== undefined) {
      const gap = source.slice(leftEntry.to, rightEntry.from).trim();
      if (gap === '|') return 'Pipeline: conecta a saída padrão do comando esquerdo à entrada do direito.';
      if (gap === '|&') return 'Pipeline: conecta saída padrão e erros ao próximo comando.';
      if (gap === '&&') return 'Executa o comando direito apenas se o esquerdo tiver sucesso.';
      if (gap === '||') return 'Executa o comando direito apenas se o esquerdo falhar.';
    }
  }
  if (kind === 'Redirect' && from !== undefined && to !== undefined) {
    const operator = source.slice(from, to).match(/^(?:\\d+)?(>>|<<-|<<<|<<|>&|<&|>|<)/)?.[1];
    const meanings: Record<string, string> = {
      '>': 'Redireciona a saída e substitui o conteúdo do arquivo de destino.',
      '>>': 'Acrescenta a saída ao arquivo de destino.',
      '<': 'Lê a entrada de um arquivo.',
      '<<': 'Here-document: fornece um bloco de texto como entrada.',
      '<<<': 'Here-string: fornece uma string como entrada.',
    };
    if (operator && meanings[operator]) return meanings[operator];
  }
  return fallback;
}

export function inspectShellSnapshot(
  snapshot: ShellSnapshot,
  maxNodes = 350,
  maxDepth = 18,
): AstOverview {
  return snapshot.memo(`overview:${maxNodes}:${maxDepth}`, () => {
    const nodes: ShellAstNode[] = [];
    const lines: string[] = [];
    const outputIds = new Map<number, string>();
    let truncated = false;

    for (const entry of snapshot.nodes) {
      if (entry.depth > maxDepth) {
        truncated = true;
        continue;
      }
      if (nodes.length >= maxNodes) {
        truncated = true;
        break;
      }

      const validRange = entry.from !== undefined && entry.to !== undefined
        && entry.from >= 0 && entry.to > entry.from && entry.to <= snapshot.source.length;
      const id = String(nodes.length);
      const parentId = entry.parentIndex === undefined ? undefined : outputIds.get(entry.parentIndex);
      const node: ShellAstNode = {
        id,
        kind: entry.type,
        label: entry.label,
        depth: entry.depth,
        parentId,
        description: explainNode(entry, snapshot),
        navigable: validRange,
        ...(validRange ? { from: entry.from, to: entry.to } : {}),
      };
      nodes.push(node);
      outputIds.set(entry.index, id);
      const preview = validRange
        ? snapshot.source.slice(entry.from!, Math.min(entry.to!, entry.from! + 55)).replace(/\s+/g, ' ')
        : '';
      lines.push('  '.repeat(entry.depth) + entry.type + (preview ? ': ' + preview : ''));
    }

    const navigableCount = nodes.filter(node => node.navigable).length;
    return {
      lines,
      nodes,
      count: nodes.length,
      navigableCount,
      unresolvedCount: nodes.length - navigableCount,
      truncated,
    };
  });
}
