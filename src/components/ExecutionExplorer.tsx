import { useMemo, useState } from 'react';
import type { ShellAnalysis } from '../lib/shell-analysis';
import type { FlowWasmStatus, WasmFlowResult } from '../lib/shell-flow-wasm';
import styles from './ExecutionExplorer.module.css';

type Props = {
  analysis: ShellAnalysis;
  view?: 'flow' | 'ast';
  cursorOffset?: number;
  flow?: WasmFlowResult | null;
  flowStatus?: FlowWasmStatus;
  flowError?: string | null;
  source?: string;
  onReveal?: (from: number, to: number) => void;
};

/** Read-only AST navigator. No command execution is performed here. */
export function ExecutionExplorer({
  analysis,
  flow,
  flowStatus,
  flowError,
  source = '',
  onReveal,
  view = 'ast',
  cursorOffset,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const utf8 = useMemo(() => new TextEncoder().encode(source), [source]);
  const offset = (position: number) => new TextDecoder().decode(utf8.slice(0, position)).length;
  const activeNode = flow?.nodes.find(
    node => cursorOffset !== undefined && offset(node.start) <= cursorOffset && cursorOffset <= offset(node.end)
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const children = useMemo(() => {
    const map = new Map<string | undefined, typeof analysis.astNodes>();
    for (const node of analysis.astNodes) {
      const group = map.get(node.parentId) ?? [];
      group.push(node);
      map.set(node.parentId, group);
    }
    return map;
  }, [analysis.astNodes]);

  const selected = analysis.astNodes.find(node => node.id === selectedId);
  const explanation = analysis.nodes.find(node => node.astId === selectedId)?.explanation;

  const visible = useMemo(() => {
    const output: typeof analysis.astNodes = [];
    const visit = (parent: string | undefined) => {
      for (const node of children.get(parent) ?? []) {
        output.push(node);
        if (!collapsed.has(node.id)) visit(node.id);
      }
    };
    visit(undefined);
    return output;
  }, [children, collapsed]);

  return (
    <section aria-label="Execution Explorer" className={styles.explorer}>
      <header className={styles.header}>
        <strong>AST Explorer</strong>
        <span>{analysis.astNodes.length} nodes</span>
      </header>
      <p className={styles.note}>Static syntax view. No commands executed.</p>
      <div role="status" aria-live="polite" className={styles.note}>
        Go CFG WASM:{' '}
        {flowStatus?.state === 'ready'
          ? '✓ carregado no Web Worker'
          : flowStatus?.state === 'loading'
            ? '⏳ carregando…'
            : flowStatus?.state === 'error'
              ? '✕ indisponível'
              : 'não iniciado'}
        {flowStatus?.message && <small> · {flowStatus.message}</small>}
      </div>
      {flowError && (
        <p role="alert" className={styles.note}>
          CFG: {flowError}
        </p>
      )}

      {view === 'flow' &&
        (flow ? (
          <div className={styles.flowVisual} aria-label="Grafo de fluxo de controle">
            <div className={styles.flowSummary}>
              {flow.nodes.length} nós · {flow.edges.length} conexões · análise estática
            </div>
            <div className={styles.flowScroll}>
              <svg
                className={styles.flowLines}
                width="100%"
                height={Math.max(120, flow.nodes.length * 84)}
                aria-hidden="true"
              >
                {flow.edges.map((edge, index) => {
                  const from = flow.nodes.findIndex(node => node.id === edge.from);
                  const to = flow.nodes.findIndex(node => node.id === edge.to);
                  if (from < 0 || to < 0) return null;
                  return (
                    <path
                      key={index}
                      d={`M 130 ${from * 84 + 66} C 130 ${from * 84 + 96}, 130 ${to * 84 + 12}, 130 ${to * 84 + 24}`}
                      fill="none"
                      stroke={edge.kind === 'next' ? '#64748b' : '#a78bfa'}
                      strokeWidth="2"
                      strokeDasharray={edge.kind === 'next' ? undefined : '5 4'}
                    />
                  );
                })}
              </svg>
              <div className={styles.flowNodes}>
                {flow.nodes.map(node => {
                  const from = offset(node.start);
                  const to = offset(node.end);
                  const isSelected = activeNode?.id === node.id || selectedFlowId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`${styles.flowNode} ${isSelected ? styles.isSelected : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedFlowId(node.id);
                        onReveal?.(from, to);
                      }}
                    >
                      <strong>{node.kind}</strong>
                      <code>{source.slice(from, to).trim().slice(0, 72) || node.id}</code>
                      <small>
                        {flow.edges
                          .filter(edge => edge.from === node.id)
                          .map(edge => edge.kind)
                          .join(' · ') || 'fim'}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className={styles.note}>
              As conexões são aproximações estáticas. Não representam execução observada.
            </p>
            {flow.warnings.map((warning, i) => (
              <p key={i} className={styles.note}>
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <p className={styles.note}>
            {flowStatus?.state === 'loading'
              ? 'Carregando grafo WASM…'
              : flowStatus?.state === 'error'
                ? 'Grafo indisponível. Verifique o erro acima.'
                : 'Execute Explicar para gerar o grafo.'}
          </p>
        ))}

      {view === 'ast' && (
        <>
          <div role="tree" aria-label="Shell AST" className={styles.tree}>
            {visible.map(node => {
              const hasChildren = (children.get(node.id)?.length ?? 0) > 0;
              const isCollapsed = collapsed.has(node.id);
              const isSelected = selectedId === node.id;
              return (
                <div
                  key={node.id}
                  role="treeitem"
                  aria-level={node.depth + 1}
                  aria-selected={isSelected}
                  aria-expanded={hasChildren ? !isCollapsed : undefined}
                  className={`${styles.node} ${isSelected ? styles.isSelected : ''}`}
                  style={{ paddingInlineStart: `calc(8px + ${node.depth} * 14px)` }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      aria-label={isCollapsed ? 'Expand node' : 'Collapse node'}
                      onClick={() =>
                        setCollapsed(previous => {
                          const next = new Set(previous);
                          if (next.has(node.id)) next.delete(node.id);
                          else next.add(node.id);
                          return next;
                        })
                      }
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span aria-hidden="true">·</span>
                  )}
                  <button
                    type="button"
                    className={styles.select}
                    onClick={() => {
                      setSelectedId(node.id);
                      if (node.navigable && node.from !== undefined && node.to !== undefined) {
                        onReveal?.(node.from, node.to);
                      }
                    }}
                  >
                    <span>{node.kind}</span>
                    <small>{node.label}</small>
                  </button>
                </div>
              );
            })}
          </div>
          {selected && (
            <aside className={styles.details} aria-live="polite">
              <strong>{selected.kind}</strong>
              <p>{selected.description}</p>
              {explanation && (
                <div className={styles.semantic}>
                  <strong>{explanation.title}</strong>
                  <p>{explanation.description}</p>
                  <small>Fonte: {explanation.source}</small>
                </div>
              )}
              <dl>
                <dt>Node ID</dt>
                <dd>{selected.id}</dd>
                <dt>Source range</dt>
                <dd>{selected.from === undefined ? 'Unavailable' : `${selected.from}–${selected.to}`}</dd>
              </dl>
            </aside>
          )}
          {analysis.warnings.map(warning => (
            <p key={warning} className={styles.note}>
              {warning}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
