/**
 * Resolve literal assignments visible before a selected source offset.
 * This is deliberately conservative: nested scopes are not assumed to
 * mutate their parents, and unresolved values remain unknown.
 */
export type ScopedBinding = {
  name: string;
  value: string;
  offset: number;
  line: number;
  scope: 'script' | 'subshell' | 'function';
};

export function resolveNodeBindings(source: string, start: number, end: number): ScopedBinding[] {
  const prefix = source.slice(0, Math.max(0, start));
  const scopeStack: Array<{ kind: ScopedBinding['scope']; start: number }> = [{ kind: 'script', start: 0 }];
  const bindings = new Map<string, ScopedBinding>();
  const lines = prefix.split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (/^(?:function\s+)?[A-Za-z_][\w]*\s*\(\)\s*\{/.test(trimmed)) {
      scopeStack.push({ kind: 'function', start: offset });
    } else if (/^\(\s*(?:#.*)?$/.test(trimmed)) {
      scopeStack.push({ kind: 'subshell', start: offset });
    } else if ((trimmed === ')' || trimmed === '}') && scopeStack.length > 1) {
      const closed = scopeStack.pop();
      if (closed) for (const [name, binding] of bindings) {
        if (binding.offset >= closed.start) bindings.delete(name);
      }
    }
    const match = /^\s*(?:export\s+|local\s+)?([A-Za-z_][\w]*)=(?:"([^"]*)"|'([^']*)'|([0-9]+))\s*$/.exec(line);
    if (match) {
      const name = match[1];
      bindings.set(name, {
        name,
        value: match[2] ?? match[3] ?? match[4] ?? '',
        offset: offset + line.indexOf(name),
        line: index + 1,
        scope: scopeStack[scopeStack.length - 1].kind,
      });
    }
    offset += line.length + 1;
  }
  const snippet = source.slice(start, end);
  const names = [...new Set([...snippet.matchAll(/\$\{([A-Za-z_][\w]*)\}|\$([A-Za-z_][\w]*)/g)]
    .map(match => match[1] ?? match[2]))];
  return names.map(name => bindings.get(name) ?? {
    name, value: '', offset: -1, line: 0, scope: scopeStack[scopeStack.length - 1].kind,
  });
}
