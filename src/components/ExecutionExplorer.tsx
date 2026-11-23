import { parseSimulatedValue } from '../lib/flow-simulation';
import { analyzeShellWasm } from '../lib/shell-flow-wasm';
import { describeFlowNode, previewShellVariables } from '../lib/flow-semantics';
import { highlightFlowSource } from '../lib/flow-highlight';
import { checkShell, type Finding } from '../lib/shellcheck';
import { FLOW_COLORS, flowNodeColor, flowEdgeColor } from '../lib/flow-colors';
import { layoutShellFlow } from '../lib/flow-layout';
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
  const [diagnostics, setDiagnostics] = useState<Finding[]>([]);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [customVariableName, setCustomVariableName] = useState('');
  const simulatedValues = useMemo(() => Object.fromEntries(
    Object.entries(variableValues).map(([key, value]) => [key, parseSimulatedValue(value)])
  ), [variableValues]);
  const detectedVariables = useMemo(() => [...new Set(
    [...source.matchAll(/\$\{([A-Za-z_][\w]*)\}|\$([A-Za-z_][\w]*)/g)]
      .map(match => match[1] ?? match[2]).filter((name): name is string => Boolean(name))
  )].slice(0, 24), [source]);
  useEffect(() => {
    let cancelled = false;
    void checkShell(source).then(findings => { if (!cancelled) setDiagnostics(findings); });
    return () => { cancelled = true; };
  }, [source]);
  const diagnosticOffsets = useMemo(() => diagnostics.map(finding => {
    const lines = source.split('\n');
    const from = lines.slice(0, Math.max(0, finding.line - 1)).reduce((sum, line) => sum + line.length + 1, 0) + Math.max(0, finding.column - 1);
    return { ...finding, from };
  }), [diagnostics, source]);
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
  const graph = useMemo(() => flow ? layoutShellFlow(flow) : null, [flow]);
  const flowViewport = useRef<HTMLDivElement | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const scaleRef = useRef(1);
  const zoomAnchor = useRef<{ x: number; y: number; ratio: number } | null>(null);
  const [flowScale, setFlowScale] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const fitFlow = () => {
    const viewport = flowViewport.current;
    if (!viewport || !graph) return;
    zoomAnchor.current = null;
    const nextScale = Math.max(0.08, Math.min(1, (viewport.clientWidth - 16) / graph.width, (viewport.clientHeight - 16) / graph.height));
    scaleRef.current = nextScale;
    setFlowScale(nextScale);
    viewport.scrollTo({ left: 0, top: 0 });
  };
  useEffect(() => {
    const viewport = flowViewport.current;
    if (!viewport || view !== 'flow') return;
    const observer = new ResizeObserver(() => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight }));
    observer.observe(viewport);
    setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    return () => observer.disconnect();
  }, [view, graph]);
  useEffect(() => {
    if (!graph || !viewportSize.width || !viewportSize.height || view !== 'flow') return;
    zoomAnchor.current = null;
    const nextScale = Math.max(0.08, Math.min(1, (viewportSize.width - 16) / graph.width, (viewportSize.height - 16) / graph.height));
    scaleRef.current = nextScale;
    setFlowScale(nextScale);
    flowViewport.current?.scrollTo({ left: 0, top: 0 });
  }, [graph, viewportSize.width, viewportSize.height, view]);
  const zoomFlow = (next: number, clientX?: number, clientY?: number) => {
    const viewport = flowViewport.current;
    const scale = Math.max(0.08, Math.min(3, next));
    if (Math.abs(scale - scaleRef.current) < 0.0001) return;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const y = (clientY ?? rect.top + rect.height / 2) - rect.top;
      zoomAnchor.current = { x: viewport.scrollLeft + x, y: viewport.scrollTop + y, ratio: scale / scaleRef.current };
    }
    scaleRef.current = scale;
    setFlowScale(scale);
  };
  useEffect(() => {
    const anchor = zoomAnchor.current;
    const viewport = flowViewport.current;
    if (!anchor || !viewport) return;
    zoomAnchor.current = null;
    viewport.scrollTo({ left: anchor.x * anchor.ratio - anchor.x + viewport.scrollLeft, top: anchor.y * anchor.ratio - anchor.y + viewport.scrollTop });
  }, [flowScale]);
  const pinchDistance = (touches: React.TouchList) => Math.hypot(
    touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY,
  );
  const [wasmDecisions, setWasmDecisions] = useState<Record<string, 'true' | 'false' | 'unknown'>>({});
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  useEffect(() => {
    if (!flow || !simulationOpen) return;
    let cancelled = false;
    setSimulationStatus('running');
    const timeout = setTimeout(() => {
      void analyzeShellWasm(source, simulatedValues).then(result => {
        if (cancelled) return;
        setWasmDecisions(result.decisions ?? {});
        setSimulationStatus('ready');
      }).catch(() => {
        if (!cancelled) { setWasmDecisions({}); setSimulationStatus('error'); }
      });
    }, 180);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [source, simulatedValues, flow, simulationOpen]);
  const branchDecisions = useMemo(() => new Map(Object.entries(wasmDecisions)), [wasmDecisions]);
  const activeNode = flow?.nodes
    .filter(node => cursorOffset !== undefined && offset(node.start) <= cursorOffset && cursorOffset < offset(node.end))
    .sort((a, b) => (offset(a.end) - offset(a.start)) - (offset(b.end) - offset(b.start)))[0];
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [astMode, setAstMode] = useState<'blocks' | 'tree'>('blocks');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
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
  const blockNodes = useMemo(() => analysis.astNodes.filter(node => node.navigable && node.from !== undefined && node.to !== undefined && (node.kind === 'Stmt' || node.kind === 'BinaryCmd' || node.kind === 'FuncDecl' || node.kind === 'IfClause' || node.kind === 'ForClause' || node.kind === 'WhileClause' || node.kind === 'CaseClause')).filter(node => !matchingIds || matchingIds.has(node.id)), [analysis.astNodes, matchingIds]);

  const blockOrder = useMemo(() => {
    const sorted = [...blockNodes].sort((a, b) => (a.from ?? 0) - (b.from ?? 0) || (b.to ?? 0) - (a.to ?? 0));
    // A Stmt wrapper and its executable clause often cover exactly the same
    // source range. Display the specific clause, never two duplicate cards.
    const rank = (kind: string) => kind === 'Stmt' ? 0 : 1;
    const unique = new Map<string, typeof sorted[number]>();
    for (const node of sorted) {
      const key = `${node.from}:${node.to}`;
      const previous = unique.get(key);
      if (!previous || rank(node.kind) > rank(previous.kind)) unique.set(key, node);
    }
    return [...unique.values()].sort((a, b) => (a.from ?? 0) - (b.from ?? 0) || (b.to ?? 0) - (a.to ?? 0));
  }, [blockNodes]);
  const pathDetails = (node: typeof analysis.astNodes[number]) => {
    if (node.kind === 'BinaryCmd') {
      const operands = (children.get(node.id) ?? [])
        .filter(child => child.navigable && child.from !== undefined && child.to !== undefined)
        .sort((a, b) => a.from! - b.from!);
      const left = operands[0];
      const right = operands.find(child => left && child.from! >= left.to!);
      if (!left || !right || left.to === undefined || right.from === undefined) return null;
      // Read the operator only between AST operand ranges. Operators inside
      // quoted arguments, strings or nested commands cannot be mistaken for it.
      const operator = source.slice(left.to, right.from).trim();
      const kinds: Record<string, { label: string; branches: { label: string; detail: string }[] }> = {
        '&&': { label: 'E lógico (&&)', branches: [
          { label: '✓ Esquerda teve sucesso', detail: 'O comando à direita pode ser executado.' },
          { label: '✕ Esquerda falhou', detail: 'O comando à direita é ignorado.' },
        ] },
        '||': { label: 'OU lógico (||)', branches: [
          { label: '✕ Esquerda falhou', detail: 'O comando à direita pode ser executado.' },
          { label: '✓ Esquerda teve sucesso', detail: 'O comando à direita é ignorado.' },
        ] },
        '|': { label: 'Pipeline (|)', branches: [
          { label: 'stdout → stdin', detail: 'A saída padrão do processo esquerdo alimenta a entrada do direito.' },
          { label: 'stderr separado', detail: 'A saída de erro não é encaminhada pelo pipe por padrão.' },
        ] },
        '|&': { label: 'Pipeline com erros (|&)', branches: [
          { label: 'stdout → stdin', detail: 'A saída padrão alimenta a entrada do processo à direita.' },
          { label: 'stderr → stdin', detail: 'A saída de erro também é encaminhada ao pipe.' },
        ] },
      };
      return kinds[operator] ?? null;
    }
    if (node.kind === 'IfClause') return { label: 'Condição', branches: [{ label: '✓ Condição verdadeira', detail: 'O ramo then pode ser executado.' }, { label: '✕ Condição falsa', detail: 'O ramo else/elif pode ser avaliado, quando existir.' }] };
    if (node.kind === 'WhileClause' || node.kind === 'ForClause') return { label: 'Repetição', branches: [{ label: '↻ Próxima iteração', detail: 'O corpo pode executar novamente conforme a condição ou os itens restantes.' }, { label: '→ Saída do laço', detail: 'A execução pode continuar após o laço.' }] };
    if (node.kind === 'CaseClause') return { label: 'Seleção', branches: [{ label: '◇ Padrão correspondente', detail: 'Um ramo pode ser escolhido conforme o padrão.' }, { label: '→ Próxima instrução', detail: 'O comportamento depende dos padrões e terminadores do case.' }] };
    return null;
  };
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
            <div className={styles.simulationPanel}>
              <button type="button" className={styles.simulationToggle} aria-expanded={simulationOpen} onClick={() => setSimulationOpen(open => !open)}>
                {simulationOpen ? '▾' : '▸'} Simular variáveis <small>sem executar o script</small>
              </button>
              {simulationOpen && <div className={styles.simulationBody}>
                <p role="status">Motor Go/WASM: {simulationStatus === 'running' ? 'analisando…' : simulationStatus === 'ready' ? 'pronto' : simulationStatus === 'error' ? 'indisponível' : 'aguardando'}</p>
                <p>Informe valores para visualizar substituições e avaliar testes simples (-z, -n, =, != e comparações numéricas). Arrays podem ser informados como JSON, por exemplo [\"api\",\"web\"]. Comandos não são executados.</p>
                {detectedVariables.length === 0 && Object.keys(variableValues).length === 0 && <p>Nenhuma referência simples encontrada. Adicione uma variável manualmente abaixo.</p>}
                {[...new Set([...detectedVariables, ...Object.keys(variableValues)])].map(name => <label key={name} className={styles.simulationField}>
                  <span>${name}</span>
                  <input value={variableValues[name] ?? ''} placeholder="Valor de exemplo" onChange={event => setVariableValues(previous => ({ ...previous, [name]: event.target.value }))} />
                </label>)}
                <form className={styles.simulationField} onSubmit={event => {
                  event.preventDefault();
                  const name = customVariableName.trim();
                  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
                  setVariableValues(previous => ({ ...previous, [name]: previous[name] ?? '' }));
                  setCustomVariableName('');
                }}>
                  <input aria-label="Nome da variável" value={customVariableName} placeholder="Nova variável" onChange={event => setCustomVariableName(event.target.value)} />
                  <button type="submit">Adicionar variável</button>
                </form>
                <button type="button" onClick={() => setVariableValues({})}>Limpar valores</button>
              </div>}
            </div>
            <div className={styles.flowToolbar} role="toolbar" aria-label="Zoom do grafo">
              <button type="button" onClick={() => zoomFlow(flowScale / 1.25)} aria-label="Diminuir zoom">−</button>
              <button type="button" onClick={fitFlow}>Enquadrar</button>
              <span aria-live="polite">{Math.round(flowScale * 100)}%</span>
              <button type="button" onClick={() => zoomFlow(flowScale * 1.25)} aria-label="Aumentar zoom">+</button>
              <button type="button" onClick={() => zoomFlow(1)} aria-label="Zoom real">1:1</button>
            </div>
            <div className={styles.flowLegend} aria-label="Legenda das cores semânticas">
              {([
                ['Comando', FLOW_COLORS.command], ['Condição', FLOW_COLORS.condition],
                ['Laço', FLOW_COLORS.loop], ['Função', FLOW_COLORS.function],
                ['Alternativa', FLOW_COLORS.branch], ['Pipeline', FLOW_COLORS.pipeline],
                ['Verdadeiro', FLOW_COLORS.success], ['Falso', FLOW_COLORS.failure],
                ['Desconhecido', FLOW_COLORS.unknown], ['Erro', FLOW_COLORS.failure],
              ] as const).map(([label, color]) => <span key={label}><i style={{ backgroundColor: color }} />{label}</span>)}
            </div>
            <div className={styles.flowScroll} ref={flowViewport}
              onTouchStart={event => {
                if (event.touches.length === 2) pinch.current = { distance: pinchDistance(event.touches), scale: flowScale };
              }}
              onTouchMove={event => {
                if (event.touches.length === 2 && pinch.current) {
                  const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                  const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
                  zoomFlow(pinch.current.scale * pinchDistance(event.touches) / Math.max(1, pinch.current.distance), centerX, centerY);
                }
              }}
              onTouchEnd={event => { if (event.touches.length < 2) pinch.current = null; }}
              onTouchCancel={() => { pinch.current = null; }}>
              {graph && <div className={styles.flowStage} style={{ width: graph.width * flowScale, height: graph.height * flowScale }}><div className={styles.flowCanvas} style={{ width: graph.width, height: graph.height, transform: 'scale(' + flowScale + ')' }}>
                <svg className={styles.flowLines} width={graph.width} height={graph.height} viewBox={`0 0 ${graph.width} ${graph.height}`} aria-label="Conexões de fluxo">
                  <defs>
                    <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0 0 L8 4 L0 8 Z" fill={FLOW_COLORS.neutral} />
                    </marker>
                  </defs>
                  {flow.edges.map((edge, index) => {
                    const from = graph.nodes.find(node => node.id === edge.from);
                    const to = graph.nodes.find(node => node.id === edge.to);
                    if (!from || !to) return null;
                    const decision = branchDecisions.get(edge.from) ?? 'unknown';
                    const excluded = (edge.kind === 'true' || edge.kind === 'false') && decision !== 'unknown' && edge.kind !== decision;
                    const back = to.y <= from.y;
                    const x1 = from.x + 100;
                    const x2 = to.x + 100;
                    const y1 = from.y + 68;
                    const y2 = to.y;
                    const bend = back ? Math.max(x1, x2) + 135 : (x1 + x2) / 2;
                    const d = back
                      ? `M ${x1} ${y1} C ${bend} ${y1 + 35}, ${bend} ${y2 - 35}, ${x2} ${y2}`
                      : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
                    return <g key={index}>
                      <path d={d} fill="none" stroke={flowEdgeColor(edge.kind)} opacity={excluded ? 0.18 : 1} strokeWidth="2" strokeDasharray={back ? '5 4' : undefined} markerEnd="url(#flow-arrow)" />
                      {edge.kind !== 'next' && <text x={(x1 + x2) / 2 + (back ? 65 : 0)} y={(y1 + y2) / 2 - 5} fill={flowEdgeColor(edge.kind)} fontSize="11" textAnchor="middle">{edge.kind}</text>}
                    </g>;
                  })}
                </svg>
                {graph.nodes.map(node => {
                  const from = offset(node.start);
                  const to = offset(node.end);
                  const isSelected = selectedFlowId === node.id || (!selectedFlowId && activeNode?.id === node.id);
                  const snippet = source.slice(from, to).trim();
                  const semantic = describeFlowNode(node.kind, snippet);
                   const decision = branchDecisions.get(node.id) ?? 'unknown';
                  const preview = previewShellVariables(snippet, variableValues);
                  const invalidRange = from < 0 || to <= from || to > source.length;
                  const finding = diagnosticOffsets.find(item => item.from >= from && item.from <= to);
                  const nodeColor = invalidRange || finding?.level === 'error' ? FLOW_COLORS.failure : finding ? FLOW_COLORS.unknown : flowNodeColor(node.kind, snippet);
                  return (
                    <button key={node.id} ref={isSelected ? activeFlowRef : undefined} type="button"
                      className={`${styles.flowNode} ${styles.flowNodePositioned} ${isSelected ? styles.isSelected : ''}`}
                      style={{ left: node.x, top: node.y, borderColor: nodeColor, '--flow-node-color': nodeColor } as React.CSSProperties} aria-pressed={isSelected}
                      title={invalidRange ? 'Intervalo inválido' : finding?.message ?? semantic.detail}
                      onClick={() => { setSelectedFlowId(node.id); if (!invalidRange) onReveal?.(from, to); }}>
                      <strong style={{ color: nodeColor }}>{invalidRange ? 'Intervalo inválido' : semantic.title}</strong>
                      <span className={styles.flowAstKind}>{node.kind}{finding ? ` · ${finding.level}` : ''}</span>
                      <code className={styles.flowHighlighted} dangerouslySetInnerHTML={{ __html: highlightFlowSource(preview.slice(0, 120) || node.id) }} />
                      <small>{finding?.message ?? semantic.detail}{decision !== 'unknown' ? ` · Condição: ${decision === 'true' ? 'verdadeira' : 'falsa'}` : ''}</small>
                    </button>
                  );
                })}
              </div></div>}
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
              const paths = pathDetails(node);
              const isExpanded = expandedPaths.has(node.id);
              return <div key={node.id} className={styles.blockEntry}>
                {index > 0 && <div className={styles.blockRelation} aria-label="Relação estrutural">{nested ? "↳ Bloco interno" : relation ? `↓ ${relation === "unknown" ? "Relação não determinada" : `Relação: ${relation}`}` : "↓ Próximo trecho no código"}</div>}
                <button ref={selected?.id === node.id ? activeBlockRef : undefined} type="button" className={`${styles.blockCard} ${selected?.id === node.id ? styles.blockCardActive : ""}`} aria-pressed={selected?.id === node.id} onClick={() => { selectAstNode(node); setFocusedToken(null); }}>
                <span className={styles.blockCardHeading}><strong style={{ color: flowNodeColor(node.kind, code) }}>{index + 1}. {node.kind}</strong><small>{parts.length} partes explicáveis</small></span>
                <code className={styles.flowHighlighted} dangerouslySetInnerHTML={{ __html: highlightFlowSource(code.length > 180 ? `${code.slice(0, 180)}…` : code) }} />
                <span className={styles.blockCardDescription}>{node.description}</span>
              </button>
                {paths && <div className={styles.pathPanel}>
                  <button type="button" className={styles.pathToggle} aria-expanded={isExpanded} onClick={() => setExpandedPaths(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{isExpanded ? '▾' : '▸'} {paths.label}: caminhos possíveis</button>
                  {isExpanded && <div className={styles.pathBranches}>{paths.branches.map(branch => <div key={branch.label} className={styles.pathBranch}><strong>{branch.label}</strong><span>{branch.detail}</span></div>)}</div>}
                </div>}
              </div>;
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
              <strong style={{ color: flowNodeColor(selected.kind, selectedSource) }}>{selected.kind}</strong>
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
                <div className={styles.explainCode}><code className={styles.flowHighlighted}>{(() => {
                  const pieces: React.ReactNode[] = [];
                  let position = selected.from ?? 0;
                  for (const token of explainedTokens) {
                    if (token.from > position) pieces.push(<span key={`plain:${position}`} dangerouslySetInnerHTML={{ __html: highlightFlowSource(source.slice(position, token.from)) }} />);
                    pieces.push(<button key={`${token.from}:${token.to}:${token.title}`} type="button" className={styles.explainToken} aria-pressed={inspectedToken?.from === token.from && inspectedToken?.to === token.to} onClick={() => { setFocusedToken(token); onReveal?.(token.from, token.to); }} title={token.title}>{source.slice(token.from, token.to)}</button>);
                    position = token.to;
                  }
                  if (position < (selected.to ?? 0)) pieces.push(<span key={`plain:${position}`} dangerouslySetInnerHTML={{ __html: highlightFlowSource(source.slice(position, selected.to)) }} />);
                  return pieces;
                })()}</code></div>
                {inspectedToken ? <div className={styles.tokenExplanation} role="status"><strong>{inspectedToken.title}</strong><p>{inspectedToken.description}</p>{inspectedToken.example && <pre><code>{inspectedToken.example}</code></pre>}<small>Fonte: {inspectedToken.source}</small></div> : <p className={styles.note}>{explainedTokens.length ? `${explainedTokens.length} partes explicáveis neste bloco` : 'Nenhuma explicação detalhada disponível para este trecho; consulte a descrição estrutural acima.'}</p>}
              </div>}
              <details className={styles.astMetadata}><summary>Detalhes técnicos do AST</summary><dl>
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
              </dl></details>
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
