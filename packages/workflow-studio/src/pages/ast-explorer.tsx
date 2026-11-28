import { useMemo, useState, useEffect, useRef } from 'react';
type Node = {
  path: (string | number)[];
  kind: string;
  range: { from: number; to: number } | null;
};
const key = (p: Node['path']) => JSON.stringify(p);
function readNodes(body: string): Node[] {
  try {
    const data = JSON.parse(body);
    if (!Array.isArray(data.nodes)) return [];
    return data.nodes.filter(
      (n: Node) =>
        Array.isArray(n.path) &&
        typeof n.kind === 'string' &&
        n.range &&
        Number.isInteger(n.range.from) &&
        Number.isInteger(n.range.to),
    );
  } catch {
    return [];
  }
}
export function AstExplorer({
  body,
  stale,
  cursor,
  onSelect,
}: {
  body: string;
  stale: boolean;
  cursor: number | null;
  onSelect: (path: Node['path'], from: number, to: number) => void;
}) {
  const nodes = useMemo(() => readNodes(body), [body]);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(100);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const active = useMemo(
    () =>
      stale || cursor === null
        ? undefined
        : nodes
            .filter((n) => n.range && n.range.from <= cursor && cursor < n.range.to)
            .sort((a, b) => b.path.length - a.path.length)[0],
    [nodes, cursor, stale],
  );
  const activeKey = active ? key(active.path) : null;
  const activeRow = useRef<HTMLButtonElement>(null);
  const parents = useMemo(
    () => new Set(nodes.filter((n) => n.path.length).map((n) => key(n.path.slice(0, -1)))),
    [nodes],
  );
  const filtered = useMemo(
    () =>
      nodes.filter((n) =>
        filter
          ? n.path.join('.').toLowerCase().includes(filter.toLowerCase())
          : !n.path.some((_, i) => collapsed.has(key(n.path.slice(0, i)))),
      ),
    [nodes, filter, collapsed],
  );
  useEffect(() => {
    if (!active) return;
    setCollapsed((old) => {
      const next = new Set(old);
      let changed = false;
      active.path.forEach((_, i) => {
        if (next.delete(key(active.path.slice(0, i)))) changed = true;
      });
      return changed ? next : old;
    });
  }, [active]);
  useEffect(() => {
    const index = filtered.findIndex((n) => key(n.path) === activeKey);
    if (index >= limit) setLimit(index + 1);
  }, [filtered, activeKey, limit]);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, limit]);
  return (
    <div className="lab-ast">
      <label>
        Filter AST
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setLimit(100);
          }}
          placeholder="jobs.build.steps"
          autoCapitalize="none"
        />
      </label>
      <small>
        {filtered.length} / {nodes.length} nodes
      </small>
      {active && (
        <p>
          <code>{active.path.join('.') || 'root'}</code>
        </p>
      )}
      {stale && <p className="error">Source changed. Parse again to synchronize ranges.</p>}
      {!nodes.length && <p>Run the parse operation to inspect source nodes.</p>}
      <div className="lab-ast-list">
        {filtered.slice(0, limit).map((n) => {
          const id = key(n.path);
          return (
            <div
              key={id}
              style={{
                display: 'flex',
                paddingInlineStart: Math.min(n.path.length, 8) * 8,
              }}
            >
              {parents.has(id) && (
                <button
                  aria-label={collapsed.has(id) ? 'Expand node' : 'Collapse node'}
                  aria-expanded={!collapsed.has(id)}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (!next.delete(id)) next.add(id);
                      return next;
                    })
                  }
                >
                  {collapsed.has(id) ? '▸' : '▾'}
                </button>
              )}
              <button
                ref={id === activeKey ? activeRow : undefined}
                className={id === activeKey ? 'lab-ast-active' : ''}
                style={{ flex: 1 }}
                disabled={stale}
                onClick={() => {
                  if (n.range) onSelect(n.path, n.range.from, n.range.to);
                }}
              >
                <code>{n.path.at(-1) ?? 'root'}</code>
                <small>
                  {n.kind} · {n.range?.from}:{n.range?.to}
                </small>
              </button>
            </div>
          );
        })}
      </div>
      {filtered.length > limit && <button onClick={() => setLimit((v) => v + 100)}>Show more</button>}
    </div>
  );
}
