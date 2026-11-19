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
 * Resolve only options in the active Fig command scope. Nested subcommands
 * must never leak flags into sibling commands.
 *
 * commandPath contains the already-entered subcommands, excluding the root
 * executable. Root options are inherited, while sibling options are not.
 */
export function fromFig(spec: unknown, commandPath: readonly string[] = []): CompletionItem[] {
  const root = record(spec);
  if (!root) return [];
  const scopes: UnknownRecord[] = [root];
  let current = root;
  for (const segment of commandPath) {
    const next = entries(current.subcommands)
      .map(record)
      .find(child => child && names(child.name).includes(segment));
    if (!next) return [];
    scopes.push(next);
    current = next;
  }

  const output: CompletionItem[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, kind: CompletionItem['kind']): void => {
    const node = record(value);
    if (!node) return;
    for (const name of names(node.name)) {
      if (kind === 'option' && !name.startsWith('-')) continue;
      const key = kind + ':' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        name,
        description: description(node.description),
        source: 'fig',
        kind,
        ...(kind === 'option' ? { takesValue: node.args !== undefined } : {}),
      });
    }
  };
  add(root, 'command');
  // Fig supports nested option groups. Walk the option collection only,
  // never subcommands, to keep sibling command scopes isolated.
  const addOptions = (value: unknown, depth = 0): void => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const child of value) addOptions(child, depth + 1);
      return;
    }
    const node = record(value);
    if (!node) return;
    add(node, 'option');
    if (node.options !== undefined) addOptions(node.options, depth + 1);
  };
  for (const scope of scopes) addOptions(scope.options);
  for (const subcommand of entries(current.subcommands)) add(subcommand, 'subcommand');
  for (const arg of entries(current.args)) add(arg, 'argument');
  if (record(current.args)) add(current.args, 'argument');
  return output;
}

/**
 * Select Fig's active subcommand scope from already-tokenized shell words.
 * The caller supplies words from the real shell AST, not a regex shell parser.
 * Flags and their values must be removed by the caller using AST context.
 */
export type FigWordContext = {
  items: CompletionItem[];
  awaitingValue: boolean;
  positionalOnly: boolean;
};

export function fromFigWordsContext(spec: unknown, words: readonly string[]): FigWordContext {
  const root = record(spec);
  if (!root) return { items: [], awaitingValue: false, positionalOnly: false };
  const path: string[] = [];
  let current = root;
  let awaitingValue = false;
  let positionalOnly = false;

  for (const word of words) {
    if (awaitingValue) {
      awaitingValue = false;
      continue;
    }
    if (word === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && word.startsWith('-')) {
      // Resolve the active option's argument requirement from Fig metadata.
      // --option=value already contains its argument and consumes no next word.
      const flag = word.split('=', 1)[0];
      const activeOptions = fromFig(spec, path).filter(item => item.kind === 'option');
      const match = activeOptions.find(item => item.name === flag);
      awaitingValue = Boolean(match?.takesValue && !word.includes('='));
      continue;
    }
    if (positionalOnly) continue;
    const next = entries(current.subcommands)
      .map(record)
      .find(child => child && names(child.name).includes(word));
    if (next) {
      path.push(word);
      current = next;
    }
    // Unrecognized positional arguments may precede subcommands in some CLIs,
    // so keep scanning rather than treating them as command names.
  }
  return { items: fromFig(spec, path), awaitingValue, positionalOnly };
}

export function fromFigWords(spec: unknown, words: readonly string[]): CompletionItem[] {
  return fromFigWordsContext(spec, words).items;
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
