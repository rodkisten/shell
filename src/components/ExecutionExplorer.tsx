import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShellAnalysis } from '../lib/shell-analysis';
import type { SemanticToken } from '../lib/semantic-shell';
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
  tokens?: readonly SemanticToken[];
  onReveal?: (from: number, to: number) => void;
};

/** Read-only AST navigator. No command execution is performed here. */
export function ExecutionExplorer({
  analysis,
  flow,
  flowStatus,
  flowError,
  source = '',
  tokens = [],
  onReveal,
  view = 'ast',
  cursorOffset,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const activeAstRef = useRef<HTMLDivElement | null>(null);
  const activeBlockRef = useRef<HTMLButtonElement | null>(null);
  const activeFlowRef = useRef<HTMLButtonElement | null>(null);
  // Build a single UTF-8 byte -> UTF-16 offset map, including astral Unicode.
  // CodeMirror uses UTF-16 offsets; the Go/WASM parser reports UTF-8 bytes.
  const byteOffsets = useMemo(() => {
    const mapping: number[] = [0];
    let utf16 = 0;
    for (const character of source) {
      const bytes = new TextEncoder().encode(character).length;
      for (let i = 1; i < bytes; i++) mapping.push(utf16);
      utf16 += character.length;
      mapping.push(utf16);
    }
    return mapping;
  }, [source]);
  const offset = (position: number) => byteOffsets[Math.max(0, Math.min(byteOffsets.length - 1, position))] ?? 0;
  const activeNode = flow?.nodes
    .filter(node => cursorOffset !== undefined && offset(node.start) <= cursorOffset && cursorOffset < offset(node.end))
    .sort((a, b) => (offset(a.end) - offset(a.start)) - (offset(b.end) - offset(b.start)))[0];
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [astMode, setAstMode] = useState<'blocks' | 'tree'>('blocks');
  const [focusedToken, setFocusedToken] = useState<SemanticToken | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const matches = new Set<string>();
    const byId = new Map(analysis.astNodes.map(node => [node.id, node]));
    for (const node of analysis.astNodes) {
      if (!`${node.kind} ${node.label} ${node.description} ${node.id}`.toLocaleLowerCase().includes(normalizedQuery)) continue;
      let current: typeof node | undefined = node;
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        matches.add(current.id);
        visited.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return matches;
  }, [analysis.astNodes, normalizedQuery]);
  useEffect(() => {
    const target = view === 'flow' ? activeFlowRef.current : astMode === 'blocks' ? activeBlockRef.current : activeAstRef.current;
    if (!target) return;
    const container = target.closest('[role="tree"], [aria-label="Grafo de fluxo de controle"], [aria-label="Blocos explicativos do script"]');
    if (!container) return;
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (targetRect.top < containerRect.top || targetRect.bottom > containerRect.bottom) {
      target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [cursorOffset, view, astMode, selectedId]);

  const children = useMemo(() => {
    const map = new Map<string | undefined, typeof analysis.astNodes>();
    for (const node of analysis.astNodes) {
      const group = map.get(node.parentId) ?? [];
      group.push(node);
      map.set(node.parentId, group);
    }
    return map;
  }, [analysis.astNodes]);

  const activeAstNode = analysis.astNodes
    .filter(node => cursorOffset !== undefined && node.from !== undefined && node.to !== undefined && node.from <= cursorOffset && cursorOffset < node.to)
    .sort((a, b) => ((a.to ?? 0) - (a.from ?? 0)) - ((b.to ?? 0) - (b.from ?? 0)))[0];
  const selected = analysis.astNodes.find(node => node.id === (selectedId ?? activeAstNode?.id));
  const explanation = analysis.nodes.find(node => node.astId === selected?.id)?.explanation;
  const selectedParent = selected?.parentId ? analysis.astNodes.find(node => node.id === selected.parentId) : undefined;
  const selectedChildren = selected ? (children.get(selected.id) ?? []) : [];
  const selectedSource = selected?.from !== undefined && selected.to !== undefined ? source.slice(selected.from, selected.to) : '';
  const explainedTokens = useMemo(() => {
    if (!selected || selected.from === undefined || selected.to === undefined) return [];
    const result: SemanticToken[] = [];
    let end = selected.from;
    for (const token of [...tokens].sort((a, b) => a.from - b.from || b.to - a.to)) {
      if (token.from < end || token.from < selected.from || token.to > selected.to || token.to <= token.from) continue;
      result.push(token);
      end = token.to;
    }
    return result;
  }, [selected, tokens]);
  const inspectedToken = focusedToken && explainedTokens.some(token => token.from === focusedToken.from && token.to === focusedToken.to && token.title === focusedToken.title) ? focusedToken : null;
  const selectAstNode = (node: typeof analysis.astNodes[number]) => {
    setSelectedId(node.id);
    if (node.navigable && node.from !== undefined && node.to !== undefined) onReveal?.(node.from, node.to);
  };

  const blockRelations = useMemo(() => new Map(analysis.edges.map(edge => [`${edge.from}:${edge.to}`, edge.kind])), [analysis.edges]);
  const blockNodes = useMemo(() => analysis.astNodes.filter(node => node.navigable && node.from !== undefined && node.to !== undefined && (node.kind === 'Stmt' || node.kind === 'FuncDecl' || node.kind === 'IfClause' || node.kind === 'ForClause' || node.kind === 'WhileClause' || node.kind === 'CaseClause')).filter(node => !matchingIds || matchingIds.has(node.id)), [analysis.astNodes, matchingIds]);

  const blockOrder = useMemo(() => [...blockNodes].sort((a, b) => (a.from ?? 0) - (b.from ?? 0) || (b.to ?? 0) - (a.to ?? 0)), [blockNodes]);
  const visible = useMemo(() => {
    const output: typeof analysis.astNodes = [];
    const visit = (parent: string | undefined) => {
      for (const node of children.get(parent) ?? []) {
        if (matchingIds && !matchingIds.has(node.id)) continue;
        output.push(node);
        if (matchingIds || !collapsed.has(node.id)) visit(node.id);
      }
    };
    visit(undefined);
    return output;
  }, [children, collapsed, matchingIds]);

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
                  const isSelected = activeNode ? activeNode.id === node.id : selectedFlowId === node.id;
                  return (
                    <button
                      key={node.id}
                      ref={isSelected ? activeFlowRef : undefined}
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
          <div className={styles.astTools}>
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar tipo, comando ou nó…" aria-label="Buscar nós AST" />
<div className={styles.modeSwitch} role="group" aria-label="Modo de exploração"><button type="button" aria-pressed={astMode === "blocks"} onClick={() => setAstMode("blocks")}>Blocos</button><button type="button" aria-pressed={astMode === "tree"} onClick={() => setAstMode("tree")}>Árvore</button></div>
            {astMode === "tree" && <button type="button" onClick={() => setCollapsed(new Set())} disabled={collapsed.size === 0}>Expandir</button>}
            {astMode === "tree" && <button type="button" onClick={() => setCollapsed(new Set(analysis.astNodes.filter(node => (children.get(node.id)?.length ?? 0) > 0).map(node => node.id)))}>Recolher</button>}
          </div>
          {matchingIds && <p className={styles.note} role="status">{analysis.astNodes.filter(node => matchingIds.has(node.id) && `${node.kind} ${node.label} ${node.description} ${node.id}`.toLocaleLowerCase().includes(normalizedQuery)).length} correspondências</p>}
          {astMode === "blocks" && <div className={styles.blockList} aria-label="Blocos explicativos do script">
            {blockOrder.length === 0 && <p className={styles.note}>Nenhum bloco encontrado para este filtro.</p>}
            {blockOrder.map((node, index) => {
              const code = source.slice(node.from!, node.to!);
              const parts = tokens.filter(token => token.from >= node.from! && token.to <= node.to!);
              const previous = blockOrder[index - 1];
              const relation = previous ? blockRelations.get(`${previous.id}:${node.id}`) : undefined;
              const nested = previous && node.from! >= previous.from! && node.to! <= previous.to!;
              return <div key={node.id} className={styles.blockEntry}>
                {index > 0 && <div className={styles.blockRelation} aria-label="Relação estrutural">{nested ? "↳ Bloco interno" : relation ? `↓ Relação estática: ${relation}` : "↓ Próximo trecho no código"}</div>}
                <button ref={selected?.id === node.id ? activeBlockRef : undefined} type="button" className={`${styles.blockCard} ${selected?.id === node.id ? styles.blockCardActive : ""}`} aria-pressed={selected?.id === node.id} onClick={() => { selectAstNode(node); setFocusedToken(null); }}>
                <span className={styles.blockCardHeading}><strong>{index + 1}. {node.kind}</strong><small>{parts.length} partes explicáveis</small></span>
                <code>{code.length > 180 ? `${code.slice(0, 180)}…` : code}</code>
                <span className={styles.blockCardDescription}>{node.description}</span>
              </button></div>;
            })}
          </div>}
          {astMode === "tree" && <div role="tree" aria-label="Shell AST" className={styles.tree}>
            {visible.map(node => {
              const hasChildren = (children.get(node.id)?.length ?? 0) > 0;
              const isCollapsed = !matchingIds && collapsed.has(node.id);
              const isSelected = selected?.id === node.id;
              return (
                <div
                  key={node.id}
                  ref={isSelected ? activeAstRef : undefined}
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
                      selectAstNode(node);
                    }}
                  >
                    <span>{node.kind}</span>
                    <small>{node.label}</small>
                  </button>
                </div>
              );
            })}
          </div>}
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
              <div className={styles.inspectorActions}>
                <button type="button" disabled={!selectedId} onClick={() => { setSelectedId(null); setFocusedToken(null); }}>Seguir cursor</button>
                <button type="button" disabled={!selected.navigable || selected.from === undefined || selected.to === undefined} onClick={() => selectAstNode(selected)}>Localizar no editor</button>
                <button type="button" disabled={!selectedSource} onClick={() => { if (selectedSource) void navigator.clipboard?.writeText(selectedSource); }}>Copiar trecho</button>
                <button type="button" disabled={!selectedParent} onClick={() => { if (selectedParent) selectAstNode(selectedParent); }}>Ir ao pai</button>
              </div>
              {selectedSource && <div className={styles.explainBlock} aria-label="Explicação interativa do código">
                <p className={styles.note}>Selecione um comando, argumento ou operador para entender o que ele faz.</p>
                <div className={styles.explainCode}><code>{(() => {
                  const pieces: React.ReactNode[] = [];
                  let position = selected.from ?? 0;
                  for (const token of explainedTokens) {
                    if (token.from > position) pieces.push(source.slice(position, token.from));
                    pieces.push(<button key={`${token.from}:${token.to}:${token.title}`} type="button" className={styles.explainToken} aria-pressed={inspectedToken?.from === token.from && inspectedToken?.to === token.to} onClick={() => { setFocusedToken(token); onReveal?.(token.from, token.to); }} title={token.title}>{source.slice(token.from, token.to)}</button>);
                    position = token.to;
                  }
                  if (position < (selected.to ?? 0)) pieces.push(source.slice(position, selected.to));
                  return pieces;
                })()}</code></div>
                {inspectedToken ? <div className={styles.tokenExplanation} role="status"><strong>{inspectedToken.title}</strong><p>{inspectedToken.description}</p>{inspectedToken.example && <pre><code>{inspectedToken.example}</code></pre>}<small>Fonte: {inspectedToken.source}</small></div> : <p className={styles.note}>{explainedTokens.length ? `${explainedTokens.length} partes explicáveis neste bloco` : 'Nenhuma explicação detalhada disponível para este trecho; consulte a descrição estrutural acima.'}</p>}
              </div>}
              <dl>
                <dt>Node ID</dt>
                <dd>{selected.id}</dd>
                <dt>Parent</dt>
                <dd>{selectedParent?.kind ?? 'Root'}</dd>
                <dt>Children</dt>
                <dd>{selectedChildren.length}</dd>
                <dt>Depth</dt>
                <dd>{selected.depth}</dd>
                <dt>Navigable</dt>
                <dd>{selected.navigable ? 'Yes' : 'No'}</dd>
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
