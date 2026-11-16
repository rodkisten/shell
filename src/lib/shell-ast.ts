/**
 * Inspect the real AST returned by sh-syntax (mvdan/sh), without attempting
 * to execute scripts or guessing the meaning of dynamic expansions.
 * Traversal is bounded to keep large pasted scripts responsive on iOS.
 */
export type AstOverview = { lines: string[]; truncated: boolean; count: number };

export function inspectShellAst(ast: unknown, maxNodes = 300, maxDepth = 12): AstOverview {
  const lines: string[] = [];
  const visited = new WeakSet<object>();
  let count = 0;
  let truncated = false;
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  function walk(value: unknown, depth: number, label: string): void {
    if (count >= maxNodes || depth > maxDepth) { truncated = true; return; }
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], depth, label + '[' + i + ']');
      return;
    }
    if (!isRecord(value)) return;
    const type = typeof value.type === 'string' ? value.type
      : typeof value.Type === 'string' ? value.Type
      : typeof value.kind === 'string' ? value.kind
      : typeof value.Kind === 'string' ? value.Kind : null;
    const structural = type ?? label;
    count++;
    lines.push('  '.repeat(depth) + structural);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'Pos' || key === 'End' || key === 'pos' || key === 'end') continue;
      if (child && typeof child === 'object') walk(child, depth + 1, key);
    }
  }
  walk(ast, 0, 'File');
  return { lines, truncated, count };
}
