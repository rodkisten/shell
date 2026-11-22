import type { ShellAstNode } from './shell-ast';
import type { WasmFlowResult } from './shell-flow-wasm';

/**
 * A conservative AST-based control-flow outline.
 * Edges describe possible control transfers, not observed execution.
 * Byte positions are required by the existing Go/WASM graph renderer.
 */
export function buildSemanticFlow(source: string, ast: readonly ShellAstNode[]): WasmFlowResult {
  const encoder = new TextEncoder();
  const byteOffset = (offset: number) => encoder.encode(source.slice(0, offset)).length;
  const children = new Map<string, ShellAstNode[]>();
  for (const node of ast) {
    const key = node.parentId ?? '__root__';
    const group = children.get(key) ?? [];
    group.push(node);
    children.set(key, group);
  }
  const eligible = new Set(['Stmt', 'BinaryCmd', 'IfClause', 'ForClause', 'WhileClause', 'CaseClause', 'FuncDecl']);
  const selected = ast.filter(node => eligible.has(node.kind) && node.navigable && node.from !== undefined && node.to !== undefined);
  const nodes = selected.map(node => ({ id: node.id, kind: node.kind, start: byteOffset(node.from!), end: byteOffset(node.to!) }));
  const included = new Set(nodes.map(node => node.id));
  const edges: WasmFlowResult['edges'] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string, kind: string) => {
    if (!included.has(from) || !included.has(to) || from === to) return;
    const key = `${from}:${to}:${kind}`;
    if (!seen.has(key)) { seen.add(key); edges.push({ from, to, kind }); }
  };
  const closest = (parentId: string): ShellAstNode | undefined => {
    let current = ast.find(node => node.id === parentId);
    while (current && !included.has(current.id)) current = current.parentId ? ast.find(node => node.id === current!.parentId) : undefined;
    return current;
  };
  // Source order is used only for sequential siblings, not across branches.
  const groups = new Map<string, ShellAstNode[]>();
  for (const node of selected) {
    const owner = node.parentId ? closest(node.parentId)?.id ?? '__root__' : '__root__';
    const group = groups.get(owner) ?? [];
    group.push(node);
    groups.set(owner, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.from! - b.from! || b.to! - a.to!);
    for (let i = 1; i < group.length; i++) {
      const previous = group[i - 1];
      const next = group[i];
      if (previous.to! <= next.from!) add(previous.id, next.id, 'next');
    }
  }
  for (const node of selected) {
    const descendants = (groups.get(node.id) ?? []).filter(child => child.from! >= node.from! && child.to! <= node.to!);
    const first = descendants[0];
    if (!first) continue;
    if (node.kind === 'IfClause') {
      add(node.id, first.id, 'true');
      // A false branch is not inferred without identifying the actual else node.
    } else if (node.kind === 'WhileClause' || node.kind === 'ForClause') {
      add(node.id, first.id, 'loop');
      const last = descendants[descendants.length - 1];
      add(last.id, node.id, 'loop');
    } else if (node.kind === 'CaseClause') {
      add(node.id, first.id, 'conditional');
    } else if (node.kind === 'BinaryCmd') {
      const ordered = descendants.sort((a, b) => a.from! - b.from!);
      const left = ordered[0];
      const right = ordered.find(item => item.from! >= left.to!);
      if (!right) continue;
      const op = source.slice(left.to!, right.from!).trim();
      const kind = op === '&&' ? 'true' : op === '||' ? 'false' : op === '|' || op === '|&' ? 'pipeline' : 'unknown';
      add(left.id, right.id, kind);
    } else {
      add(node.id, first.id, 'next');
    }
  }
  return {
    nodes,
    edges,
    warnings: [
      'Análise estrutural: caminhos possíveis, nunca execução observada.',
      'Ramos else/elif, break/continue e efeitos de funções ainda não são modelados integralmente.',
    ],
  };
}
