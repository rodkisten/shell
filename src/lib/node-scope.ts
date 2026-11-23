/**
 * Conservative lexical scope hints for a selected shell-flow node.
 *
 * This is NOT a shell interpreter. We only resolve literal assignments
 * preceding the selected node, preserve shadowed parent bindings, and avoid
 * presenting assignments from closed functions/subshells as global facts.
 * Dynamic expansions, conditional writes and command substitutions remain
 * unknown until the Go AST scope engine provides path-sensitive bindings.
 */
export type ScopedBinding = {
  name: string;
  value: string;
  offset: number;
  line: number;
  scope: 'script' | 'subshell' | 'function';
};

type Frame = {
  kind: ScopedBinding['scope'];
  bindings: Map<string, ScopedBinding>;
};

const assignment = /^\s*(?:(?:export|local|readonly)\s+)?([A-Za-z_][\w]*)=(?:"([^"]*)"|'([^']*)'|([0-9]+))\s*(?:#.*)?$/;
const reference = /\$\{([A-Za-z_][\w]*)\}|\$([A-Za-z_][\w]*)/g;

export function resolveNodeBindings(source: string, start: number, end: number): ScopedBinding[] {
  const safeStart = Math.max(0, Math.min(source.length, start));
  const safeEnd = Math.max(safeStart, Math.min(source.length, end));
  const frames: Frame[] = [{ kind: 'script', bindings: new Map() }];
  const lines = source.slice(0, safeStart).split('\n');
  let offset = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    // Function bodies are not executed when declared. Their bindings must
    // never leak into the surrounding script.
    if (/^(?:function\s+)?[A-Za-z_][\w]*\s*\(\)\s*\{\s*(?:#.*)?$/.test(trimmed) ||
        /^function\s+[A-Za-z_][\w]*\s*\{\s*(?:#.*)?$/.test(trimmed)) {
      frames.push({ kind: 'function', bindings: new Map() });
    } else if (/^\(\s*(?:#.*)?$/.test(trimmed)) {
      frames.push({ kind: 'subshell', bindings: new Map() });
    } else if ((trimmed === ')' || trimmed === '}') && frames.length > 1) {
      frames.pop();
    }

    const match = assignment.exec(line);
    if (match) {
      const name = match[1];
      frames[frames.length - 1].bindings.set(name, {
        name,
        value: match[2] ?? match[3] ?? match[4] ?? '',
        offset: offset + line.indexOf(name),
        line: index + 1,
        scope: frames[frames.length - 1].kind,
      });
    }
    offset += line.length + 1;
  }

  const names = [...new Set([...source.slice(safeStart, safeEnd).matchAll(reference)]
    .map(match => match[1] ?? match[2]))];
  return names.map(name => {
    for (let index = frames.length - 1; index >= 0; index--) {
      const binding = frames[index].bindings.get(name);
      if (binding) return binding;
    }
    return { name, value: '', offset: -1, line: 0, scope: frames[frames.length - 1].kind };
  });
}
