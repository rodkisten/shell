import './execution-explorer.css';
import { useMemo, useState } from 'react';
import type { ShellAnalysis } from '../lib/shell-analysis';
import type { FlowWasmStatus, WasmFlowResult } from '../lib/shell-flow-wasm';

type Props = {
  analysis: ShellAnalysis;
  flow?: WasmFlowResult | null;
  flowStatus?: FlowWasmStatus;
  flowError?: string | null;
  source?: string;
  onReveal?: (from: number, to: number) => void;
};

/** Read-only AST navigator. No command execution is performed here. */
export function ExecutionExplorer({ analysis, flow, flowStatus, flowError, source = '', onReveal }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    <section aria-label="Execution Explorer" className="execution-explorer">
      <header className="execution-explorer-header">
        <strong>AST Explorer</strong>
        <span>{analysis.astNodes.length} nodes</span>
      </header>
      <p className="execution-explorer-note">Static syntax view. No commands executed.</p>
      <div role="status" aria-live="polite" className="execution-explorer-note">
        Go CFG WASM: {flowStatus?.state === 'ready' ? '✓ carregado no Web Worker' : flowStatus?.state === 'loading' ? '⏳ carregando…' : flowStatus?.state === 'error' ? '✕ indisponível' : 'não iniciado'}
        {flowStatus?.message && <small> · {flowStatus.message}</small>}
      </div>
      {flowError && <p role="alert" className="execution-explorer-note">CFG: {flowError}</p>}
      {flow && <details className="execution-explorer-details">
        <summary>Grafo de fluxo · {flow.nodes.length} nós / {flow.edges.length} conexões</summary>
        <ol>
          {flow.nodes.map(node => {
            // Go syntax offsets are UTF-8 bytes; decode before displaying and
            // converting to CodeMirror's UTF-16 positions.
            const bytes = new TextEncoder().encode(source);
            const from = new TextDecoder().decode(bytes.slice(0, node.start)).length;
            const to = new TextDecoder().decode(bytes.slice(0, node.end)).length;
            return <li key={node.id}>
              <button type="button" onClick={() => onReveal?.(from, to)}>
                {node.kind}: {source.slice(from, to).trim().slice(0, 90) || node.id}
              </button>
              <small> → {flow.edges.filter(edge => edge.from === node.id).map(edge => `${edge.kind}: ${edge.to}`).join(' · ') || 'fim'}</small>
            </li>;
          })}
        </ol>
        {flow.warnings.map(warning => <p key={warning} className="execution-explorer-note">{warning}</p>)}
      </details>}
      <div role="tree" aria-label="Shell AST" className="execution-explorer-tree">
        {visible.map(node => {
          const hasChildren = (children.get(node.id)?.length ?? 0) > 0;
          const isCollapsed = collapsed.has(node.id);
          return (
            <div key={node.id} role="treeitem" aria-level={node.depth + 1}
              aria-selected={selectedId === node.id}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              className={'execution-explorer-node' + (selectedId === node.id ? ' is-selected' : '')}
              style={{ paddingInlineStart: `calc(8px + ${node.depth} * 14px)` }}>
              {hasChildren ? (
                <button type="button" aria-label={isCollapsed ? 'Expand node' : 'Collapse node'}
                  onClick={() => setCollapsed(previous => {
                    const next = new Set(previous);
                    if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                    return next;
                  })}>{isCollapsed ? '▸' : '▾'}</button>
              ) : <span aria-hidden="true">·</span>}
              <button type="button" className="execution-explorer-select"
                onClick={() => {
                  setSelectedId(node.id);
                  if (node.navigable && node.from !== undefined && node.to !== undefined) onReveal?.(node.from, node.to);
                }}>
                <span>{node.kind}</span><small>{node.label}</small>
              </button>
            </div>
          );
        })}
      </div>
      {selected && (
        <aside className="execution-explorer-details" aria-live="polite">
          <strong>{selected.kind}</strong>
          <p>{selected.description}</p>
          {explanation && <div className="execution-explorer-semantic"><strong>{explanation.title}</strong><p>{explanation.description}</p><small>Fonte: {explanation.source}</small></div>}
          <dl><dt>Node ID</dt><dd>{selected.id}</dd><dt>Source range</dt>
            <dd>{selected.from === undefined ? 'Unavailable' : `${selected.from}–${selected.to}`}</dd></dl>
        </aside>
      )}
      {analysis.warnings.map(warning => <p key={warning} className="execution-explorer-note">{warning}</p>)}
    </section>
  );
}
