import type { WasmFlowResult } from './shell-flow-wasm';

export type PositionedFlowNode = WasmFlowResult['nodes'][number] & { x: number; y: number };
export type FlowLayout = { nodes: PositionedFlowNode[]; width: number; height: number };

const NODE_WIDTH = 200;
const COLUMN_GAP = 72;
const ROW_GAP = 176;
const MARGIN = 64;

/**
 * Layout control-flow branches as a directed graph.
 *
 * Forward edges establish depth; back edges (loops) are routed by the renderer.
 * Success/failure successors get distinct columns, while converging successors
 * are placed near the midpoint of their predecessors.
 *
 * This does not infer missing control-flow edges: it only lays out those
 * explicitly provided by the semantic CFG.
 */
export function layoutShellFlow(flow: WasmFlowResult): FlowLayout {
  const byId = new Map(flow.nodes.map(node => [node.id, node]));
  // Edges to an ancestor or to an earlier source position are loop backs.
  const forward = flow.edges.filter(edge => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return from && to && edge.kind !== 'loop' && to.start >= from.start && edge.from !== edge.to;
  });
  const forwardIncoming = new Map<string, typeof forward>();
  for (const edge of forward) {
    const inc = forwardIncoming.get(edge.to) ?? [];
    inc.push(edge);
    forwardIncoming.set(edge.to, inc);
  }

  const order = [...flow.nodes].sort((a, b) => a.start - b.start || b.end - a.end);
  const ranks = new Map<string, number>();
  // Longest-path layering, bounded to protect against malformed cyclic inputs.
  for (const node of order) {
    const parents = forwardIncoming.get(node.id) ?? [];
    const depth = parents.reduce((max, edge) => Math.max(max, (ranks.get(edge.from) ?? -1) + 1), 0);
    ranks.set(node.id, depth);
  }

  const lanes = new Map<string, number>();
  const branchChildren = new Map<string, Set<string>>();
  for (const edge of forward) {
    if (edge.kind !== 'true' && edge.kind !== 'false' && edge.kind !== 'conditional') continue;
    const children = branchChildren.get(edge.from) ?? new Set<string>();
    children.add(edge.to);
    branchChildren.set(edge.from, children);
  }
  const groups = new Map<number, typeof order>();
  for (const node of order) {
    const depth = ranks.get(node.id) ?? 0;
    const group = groups.get(depth) ?? [];
    group.push(node);
    groups.set(depth, group);
  }

  for (const depth of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(depth) ?? [];
    const preferred = new Map<string, number>();
    for (const node of group) {
      const parents = forwardIncoming.get(node.id) ?? [];
      const positions = parents.map(edge => {
        const parentLane = lanes.get(edge.from) ?? 0;
        const siblings = [...(branchChildren.get(edge.from) ?? [])];
        if (siblings.length < 2) {
          if (edge.kind === 'true') return parentLane - 1;
          if (edge.kind === 'false') return parentLane + 1;
          return parentLane;
        }
        const index = siblings.indexOf(node.id);
        return parentLane + (index - (siblings.length - 1) / 2) * 2;
      });
      preferred.set(node.id, positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0);
    }
    group.sort((a, b) => (preferred.get(a.id) ?? 0) - (preferred.get(b.id) ?? 0) || a.start - b.start);
    const used = new Set<number>();
    for (const node of group) {
      const desired = Math.round(preferred.get(node.id) ?? 0);
      let column = desired;
      if (used.has(column)) {
        for (let distance = 1; ; distance++) {
          if (!used.has(desired - distance)) { column = desired - distance; break; }
          if (!used.has(desired + distance)) { column = desired + distance; break; }
        }
      }
      used.add(column);
      lanes.set(node.id, column);
    }
  }

  const minLane = Math.min(0, ...lanes.values());
  const maxLane = Math.max(0, ...lanes.values());
  const positioned = order.map(node => ({
    ...node,
    x: MARGIN + ((lanes.get(node.id) ?? 0) - minLane) * (NODE_WIDTH + COLUMN_GAP),
    y: MARGIN + (ranks.get(node.id) ?? 0) * ROW_GAP,
  }));
  const maxDepth = Math.max(0, ...ranks.values());
  return {
    nodes: positioned,
    width: Math.max(420, MARGIN * 2 + (maxLane - minLane) * (NODE_WIDTH + COLUMN_GAP) + NODE_WIDTH),
    height: Math.max(200, MARGIN * 2 + maxDepth * ROW_GAP + 80),
  };
}
