import { LangVariant, parse } from 'sh-syntax';

export type ShellAst = Awaited<ReturnType<typeof parse>>;

export type IndexedShellNode = {
  node: Record<string, unknown>;
  type: string;
  label: string;
  depth: number;
  index: number;
  parentIndex?: number;
  from?: number;
  to?: number;
};

export type ShellSnapshot = {
  source: string;
  ast: ShellAst;
  nodes: IndexedShellNode[];
  byObject: WeakMap<object, IndexedShellNode>;
  byType: Map<string, IndexedShellNode[]>;
  offsetToUtf16(offset: number): number | undefined;
  memo<T>(key: string, factory: () => T): T;
};

const CACHE_LIMIT = 4;
const snapshotCache = new Map<string, Promise<ShellSnapshot>>();

function createByteIndex(source: string) {
  const byteToUtf16 = new Map<number, number>();
  const encoder = new TextEncoder();
  let byte = 0;
  for (let index = 0; index < source.length;) {
    const point = source.codePointAt(index);
    if (point === undefined) break;
    const char = String.fromCodePoint(point);
    byteToUtf16.set(byte, index);
    byte += encoder.encode(char).length;
    index += char.length;
  }
  byteToUtf16.set(byte, source.length);
  return byteToUtf16;
}

function indexAst(source: string, ast: ShellAst): ShellSnapshot {
  const byteToUtf16 = createByteIndex(source);
  const nodes: IndexedShellNode[] = [];
  const byObject = new WeakMap<object, IndexedShellNode>();
  const byType = new Map<string, IndexedShellNode[]>();
  const seen = new WeakSet<object>();
  const derived = new Map<string, unknown>();

  const offsetToUtf16 = (offset: number) =>
    Number.isSafeInteger(offset) ? byteToUtf16.get(offset) : undefined;

  const walk = (value: unknown, depth: number, label: string, parentIndex?: number): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth, label, parentIndex);
      return;
    }

    const node = value as Record<string, unknown>;
    const type = typeof node.type === 'string' ? node.type : undefined;
    let currentParent = parentIndex;
    let childDepth = depth;

    if (type) {
      const from = typeof node.start === 'number' ? offsetToUtf16(node.start) : undefined;
      const to = typeof node.end === 'number' ? offsetToUtf16(node.end) : undefined;
      const entry: IndexedShellNode = {
        node,
        type,
        label,
        depth,
        index: nodes.length,
        parentIndex,
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      };
      nodes.push(entry);
      byObject.set(value, entry);
      const group = byType.get(type);
      if (group) group.push(entry);
      else byType.set(type, [entry]);
      currentParent = entry.index;
      childDepth = depth + 1;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent' || key === 'comments') continue;
      if (child && typeof child === 'object') walk(child, childDepth, key, currentParent);
    }
  };

  walk(ast, 0, 'File');

  return {
    source,
    ast,
    nodes,
    byObject,
    byType,
    offsetToUtf16,
    memo<T>(key: string, factory: () => T): T {
      if (derived.has(key)) return derived.get(key) as T;
      const value = factory();
      derived.set(key, value);
      return value;
    },
  };
}

function remember(source: string, promise: Promise<ShellSnapshot>): Promise<ShellSnapshot> {
  snapshotCache.delete(source);
  snapshotCache.set(source, promise);
  while (snapshotCache.size > CACHE_LIMIT) {
    const oldest = snapshotCache.keys().next().value;
    if (oldest === undefined) break;
    snapshotCache.delete(oldest);
  }
  return promise;
}

/**
 * Parse and index a Zsh source snapshot once. Every editor feature shares this
 * exact in-flight Promise, flat node index and UTF-8 -> UTF-16 position map.
 */
export function parseShellSnapshot(source: string): Promise<ShellSnapshot> {
  const cached = snapshotCache.get(source);
  if (cached) return remember(source, cached);

  const promise = parse(source, {
    variant: LangVariant.LangZsh,
    keepComments: true,
  }).then(ast => indexAst(source, ast));

  return remember(source, promise);
}

export async function parseShellAst(source: string): Promise<ShellAst> {
  return (await parseShellSnapshot(source)).ast;
}
