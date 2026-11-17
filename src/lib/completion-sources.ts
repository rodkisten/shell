/**
 * Adapters for established completion formats. No shell parsing lives here:
 * mvdan/sh owns syntax; Fig owns declarative CLI metadata; Carapace provides
 * contextual completion results. Keep provenance visible to consumers.
 */
export type CompletionItem = {
  name: string;
  description: string;
  source: 'fig' | 'carapace';
  kind: 'command' | 'subcommand' | 'option' | 'argument';
  takesValue?: boolean;
  sourceVersion?: string;
};

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord : undefined;
}
function names(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function description(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Fig completion specs are declarative trees. This adapter deliberately
 * ignores dynamic generators: running them would violate offline analysis
 * guarantees and could execute user-provided commands.
 */
export function fromFig(spec: unknown): CompletionItem[] {
  const output: CompletionItem[] = [];
  const seen = new WeakSet<object>();
  function visit(value: unknown, kind: CompletionItem['kind'], depth: number): void {
    if (depth > 12) return;
    const node = record(value);
    if (!node || seen.has(node)) return;
    seen.add(node);
    for (const name of names(node.name)) {
      output.push({
        name,
        description: description(node.description),
        source: 'fig',
        kind,
        ...(kind === 'option' ? { takesValue: node.args !== undefined } : {}),
      });
    }
    for (const child of entries(node.subcommands)) visit(child, 'subcommand', depth + 1);
    for (const child of entries(node.options)) visit(child, 'option', depth + 1);
    for (const child of entries(node.args)) visit(child, 'argument', depth + 1);
    if (record(node.args)) visit(node.args, 'argument', depth + 1);
  }
  visit(spec, 'command', 0);
  return output;
}

/**
 * Carapace's documented export format contains completion candidates, not a
 * complete command specification. Preserve descriptions and version, but do
 * not infer side effects or option argument requirements from candidate text.
 */
export function fromCarapace(exported: unknown): CompletionItem[] {
  const data = record(exported);
  if (!data || !Array.isArray(data.values)) return [];
  const version = typeof data.version === 'string' ? data.version : undefined;
  return data.values.flatMap(value => {
    const item = record(value);
    if (!item || typeof item.value !== 'string' || !item.value) return [];
    const tag = description(item.tag).toLowerCase();
    const kind: CompletionItem['kind'] = tag.includes('command')
      ? 'subcommand' : item.value.startsWith('-') ? 'option' : 'argument';
    return [{
      name: item.value,
      description: description(item.description),
      source: 'carapace' as const,
      kind,
      ...(version ? { sourceVersion: version } : {}),
    }];
  });
}
