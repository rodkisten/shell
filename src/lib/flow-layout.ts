import type { WasmFlowResult } from './shell-flow-wasm';

export type PositionedFlowNode = WasmFlowResult['nodes'][number] & { x: number; y: number };
export type FlowLayout = { nodes: PositionedFlowNode[]; width: number; height: number };

/**
 * Layered graph layout. Back edges are drawn separately; they do not affect
 * ranking. Branches occupy different lanes rather than a single vertical rail.
 */
export function layoutShellFlow(flow: WasmFlowResult): FlowLayout {
  const nodes = flow.nodes;
  const byId = new Map(nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, WasmFlowResult['edges']>();
  for (const edge of flow.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const group = outgoing.get(edge.from) ?? [];
    group.push(edge);
    outgoing.set(edge.from, group);
  }
  const rank = new Map<string, number>();
  const lane = new Map<string, number>();
  const ordered = [...nodes].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const node of ordered) {
    rank.set(node.id, 0);
    lane.set(node.id, 0);
  }
  for (const node of ordered) {
    const fromIndex = byId.get(node.id) ?? 0;
    const edges = (outgoing.get(node.id) ?? []).filter(edge => (byId.get(edge.to) ?? 0) > fromIndex);
    const alternatives = edges.filter(edge => edge.kind === 'true' || edge.kind === 'false' || edge.kind === 'conditional');
    for (const edge of edges) {
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, (rank.get(node.id) ?? 0) + 1));
      if (alternatives.length > 1) {
        const index = alternatives.indexOf(edge);
        lane.set(edge.to, index === 0 ? -1 : 1);
      } else if (edge.kind === 'true') {
        lane.set(edge.to, -1);
      } else if (edge.kind === 'false') {
        lane.set(edge.to, 1);
      } else {
        lane.set(edge.to, lane.get(node.id) ?? 0);
      }
    }
  }
  // Keep independent statements from overlapping when AST ancestry hides edges.
  let previousRank = -1;
  for (const node of ordered) {
    const next = Math.max(rank.get(node.id) ?? 0, previousRank + 1);
    rank.set(node.id, next);
    previousRank = next;
  }
  const positions = ordered.map(node => ({
    ...node,
    x: 340 + (lane.get(node.id) ?? 0) * 250,
    y: 32 + (rank.get(node.id) ?? 0) * 110,
  }));
  return { nodes: positions, width: 900, height: Math.max(180, 60 + ordered.length * 110) };
}
