import type { ShellSnapshot } from './shell-parser';
import type { WasmFlowResult } from './shell-flow-wasm';

type Raw = Record<string, unknown>;
type Frontier = { id: string; kind: string };
const object = (value: unknown): Raw | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null;
const list = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.map(object).filter((node): node is Raw => node !== null) : [];

/**
 * Build possible control transfers from the parser's named AST fields.
 * Function declarations are separate subgraphs, never executed in source order.
 * This is static analysis, not an interpreter.
 */
export function buildSemanticFlow(snapshot: ShellSnapshot): WasmFlowResult {
  const nodes: WasmFlowResult['nodes'] = [];
  const edges: WasmFlowResult['edges'] = [];
  const seen = new Set<string>();
  const identifiers = new WeakMap<object, string>();
  let nextId = 0;
  const addNode = (raw: Raw, kind: string): string => {
    const existing = identifiers.get(raw);
    if (existing) return existing;
    const id = String(++nextId);
    identifiers.set(raw, id);
    const entry = snapshot.byObject.get(raw);
    nodes.push({ id, kind, start: typeof raw.start === 'number' ? raw.start : (entry?.from ?? 0), end: typeof raw.end === 'number' ? raw.end : (entry?.to ?? 0) });
    return id;
  };
  const link = (from: string, to: string, kind: string) => {
    const key = `${from}/${to}/${kind}`;
    if (from !== to && !seen.has(key)) { seen.add(key); edges.push({ from, to, kind }); }
  };
  const connect = (frontier: Frontier[], id: string) => {
    for (const previous of frontier) link(previous.id, id, previous.kind);
  };
  const terminal = (raw: Raw): boolean => {
    const cmd = object(raw.cmd) ?? raw;
    if (cmd.type !== 'CallExpr') return false;
    const first = list(cmd.args)[0];
    const lit = first ? list(first.parts).find(part => part.type === 'Lit') : undefined;
    return lit?.value === 'return' || lit?.value === 'exit' || lit?.value === 'break' || lit?.value === 'continue';
  };
  const sequence = (items: Raw[], incoming: Frontier[]): Frontier[] => {
    let frontier = incoming;
    for (const item of items) frontier = visit(item, frontier);
    return frontier;
  };
  const visit = (raw: Raw, incoming: Frontier[]): Frontier[] => {
    const cmd = object(raw.cmd) ?? raw;
    const kind = typeof cmd.type === 'string' ? cmd.type : 'Stmt';
    if (kind === 'FuncDecl') {
      // A declaration does not run its body; model it as a separate entry.
      const id = addNode(raw, 'FuncDecl');
      connect(incoming, id);
      const body = object(cmd.body);
      if (body) visit(body, [{ id, kind: 'declaration' }]);
      return [{ id, kind: 'next' }];
    }
    if (kind === 'Block' || kind === 'Subshell') {
      return sequence(list(cmd.stmts), incoming);
    }
    const id = addNode(raw, kind);
    connect(incoming, id);
    if (kind === 'IfClause') {
      const cond = list(cmd.cond);
      const then = list(cmd.then);
      const elseClause = object(cmd.else);
      const conditionEnds = cond.length ? sequence(cond, [{ id, kind: 'condition' }]) : [{ id, kind: 'next' }];
      const yes = then.length ? sequence(then, conditionEnds.map(end => ({ id: end.id, kind: 'true' }))) : conditionEnds;
      const no = elseClause
        ? visit(elseClause, conditionEnds.map(end => ({ id: end.id, kind: 'false' })))
        : conditionEnds.map(end => ({ id: end.id, kind: 'false' }));
      return [...yes, ...no].map(end => ({ id: end.id, kind: 'next' }));
    }
    if (kind === 'WhileClause' || kind === 'ForClause') {
      const cond = kind === 'WhileClause' ? list(cmd.cond) : [];
      const conditionEnds = cond.length ? sequence(cond, [{ id, kind: 'condition' }]) : [{ id, kind: 'true' }];
      const body = list(cmd.do);
      const bodyEnds = body.length ? sequence(body, conditionEnds.map(end => ({ id: end.id, kind: 'true' }))) : conditionEnds;
      for (const end of bodyEnds) link(end.id, id, 'loop');
      return [{ id, kind: 'false' }];
    }
    if (kind === 'CaseClause') {
      const arms = list(cmd.items);
      const outputs: Frontier[] = [];
      for (const arm of arms) {
        const armId = addNode(arm, 'CaseItem');
        link(id, armId, 'conditional');
        outputs.push(...sequence(list(arm.stmts), [{ id: armId, kind: 'next' }]));
      }
      // An unmatched pattern can fall through unless a default arm is proven.
      return [...outputs, { id, kind: 'false' }].map(end => ({ id: end.id, kind: 'next' }));
    }
    if (kind === 'BinaryCmd') {
      const left = object(cmd.x);
      const right = object(cmd.y);
      if (!left || !right) return [{ id, kind: 'next' }];
      const leftEnd = visit(left, [{ id, kind: 'next' }]);
      const leftEntry = snapshot.byObject.get(left);
      const rightEntry = snapshot.byObject.get(right);
      const operator = leftEntry?.to !== undefined && rightEntry?.from !== undefined
        ? snapshot.source.slice(leftEntry.to, rightEntry.from).trim() : '';
      const edgeKind = operator === '&&' ? 'true' : operator === '||' ? 'false' : operator === '|' || operator === '|&' ? 'pipeline' : 'next';
      const rightEnd = visit(right, leftEnd.map(end => ({ id: end.id, kind: edgeKind })));
      return edgeKind === 'true' || edgeKind === 'false'
        ? [...rightEnd, ...leftEnd.map(end => ({ id: end.id, kind: 'next' }))]
        : rightEnd;
    }
    return terminal(raw) ? [] : [{ id, kind: 'next' }];
  };
  const root = object(snapshot.ast);
  if (root) sequence(list(root.stmts), []);
  return {
    nodes, edges,
    warnings: [
      'Grafo estático: caminhos possíveis, não execução observada.',
      'Chamadas de funções, expansão dinâmica e break/continue ainda exigem resolução de contexto.',
    ],
  };
}
