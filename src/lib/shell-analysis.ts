import type { ShellAstNode } from './shell-ast';
import type { SemanticToken } from './semantic-shell';

/** Static analysis describes possible paths, never a verified runtime trace. */
export type FlowEdgeKind = 'next' | 'true' | 'false' | 'loop' | 'conditional' | 'pipeline' | 'unknown';
export type FlowNode = {
  id: string;
  astId: string;
  kind: string;
  label: string;
  from?: number;
  to?: number;
  explanation?: SemanticToken;
};
export type FlowEdge = { from: string; to: string; kind: FlowEdgeKind };
export type ExecutionEvent = {
  nodeId?: string;
  sequence: number;
  phase: 'start' | 'finish' | 'error';
  timestamp: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  observed: true;
};
export type ShellAnalysis = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  astNodes: ShellAstNode[];
  warnings: string[];
};

/**
 * Build a conservative, source-ordered navigation graph.
 * Sibling links represent lexical order, NOT guaranteed runtime execution.
 * Branches and loops must be resolved by a future control-flow visitor.
 */
export function analyzeShell(source: string, astNodes: ShellAstNode[], tokens: readonly SemanticToken[] = []): ShellAnalysis {
  const nodes: FlowNode[] = astNodes
    .filter(node => node.navigable && node.from !== undefined && node.to !== undefined)
    .map(node => ({
      id: node.id,
      astId: node.id,
      kind: node.kind,
      label: node.label,
      from: node.from,
      to: node.to,
      explanation: tokens.find(token => token.from >= node.from! && token.to <= node.to!),
    }));
  const edges: FlowEdge[] = [];
  const lastSibling = new Map<string, FlowNode>();
  for (const node of nodes) {
    const ast = astNodes.find(candidate => candidate.id === node.astId);
    const parent = ast?.parentId ?? '__root__';
    const previous = lastSibling.get(parent);
    if (previous) edges.push({ from: previous.id, to: node.id, kind: 'unknown' });
    lastSibling.set(parent, node);
  }
  return {
    nodes,
    edges,
    astNodes,
    warnings: [
      'As conexões representam ordem textual, não ordem de execução comprovada.',
      'Condições, loops, funções, pipelines e subshells exigem análise de fluxo específica.',
      'Nenhum comando é executado durante a análise estática.',
    ],
  };
}

export function eventsForNode(events: readonly ExecutionEvent[], nodeId: string): ExecutionEvent[] {
  return events.filter(event => event.nodeId === nodeId).sort((a, b) => a.sequence - b.sequence);
}
