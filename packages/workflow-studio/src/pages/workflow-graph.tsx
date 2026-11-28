import { useMemo, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';

type Path = (string | number)[];
type Range = { path: Path; range: { from: number; to: number } | null };
type Step = {
  index: number;
  name: string | null;
  uses: string | null;
  kind: string;
};
type Job = { id: string; needs: string[] };
type Detail = {
  id: string;
  name: string | null;
  uses: string | null;
  steps: Step[];
};
type Data = { label: string; detail: Detail | undefined; active: boolean };
type JobNode = Node<Data, 'job'>;
function JobCard({ data }: NodeProps<JobNode>) {
  return (
    <div className={'orb-graph-job' + (data.active ? ' orb-graph-active' : '')}>
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      {data.detail?.uses && <small>{data.detail.uses}</small>}
      <small>{data.detail?.steps.length ?? 0} steps</small>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { job: JobCard };
function read(body: string) {
  try {
    const d = JSON.parse(body);
    return {
      jobs: (Array.isArray(d.jobs) ? d.jobs : []) as Job[],
      details: (Array.isArray(d.details) ? d.details : []) as Detail[],
      ranges: (Array.isArray(d.nodes) ? d.nodes : []) as Range[],
    };
  } catch {
    return { jobs: [], details: [], ranges: [] };
  }
}
export function WorkflowGraph({
  body,
  stale,
  cursor,
  onSelect,
  onEditNeeds,
}: {
  body: string;
  stale: boolean;
  cursor: number | null;
  onSelect: (path: Path, from: number, to: number) => void;
  onEditNeeds: (job: string, needs: string[]) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ReactFlowInstance<JobNode, Edge> | null>(null);
  const model = useMemo(() => read(body), [body]);
  const [selected, setSelected] = useState<string | null>(null);
  const active =
    stale || cursor === null
      ? undefined
      : model.ranges.filter(
          (n) =>
            n.path.length === 2 &&
            n.path[0] === 'jobs' &&
            n.range &&
            n.range.from <= cursor &&
            cursor < n.range.to,
        )[0]?.path[1];
  const { nodes, edges } = useMemo(() => {
    const jobs = model.jobs.slice(0, 300);
    const ids = new Set(jobs.map((j) => j.id));
    const depth = new Map<string, number>();
    for (let pass = 0; pass < jobs.length; pass++) {
      let changed = false;
      for (const j of jobs) {
        if (depth.has(j.id)) continue;
        if (j.needs.every((n) => !ids.has(n) || depth.has(n))) {
          depth.set(j.id, Math.max(0, ...j.needs.map((n) => (depth.get(n) ?? -1) + 1)));
          changed = true;
        }
      }
      if (!changed) break;
    }
    const rows = new Map<number, number>();
    const nodes: JobNode[] = jobs.map((j) => {
      const x = depth.get(j.id) ?? 0;
      const y = rows.get(x) ?? 0;
      rows.set(x, y + 1);
      const detail = model.details.find((d) => d.id === j.id);
      return {
        id: j.id,
        type: 'job',
        position: { x: x * 250, y: y * 115 },
        data: { label: detail?.name ?? j.id, detail, active: active === j.id },
        draggable: false,
      };
    });
    const edges: Edge[] = jobs.flatMap((j) =>
      [...new Set(j.needs)]
        .filter((n) => ids.has(n))
        .map((n) => ({
          id: JSON.stringify([n, j.id]),
          source: n,
          target: j.id,
        })),
    );
    return { nodes, edges };
  }, [model, active]);
  const topology = JSON.stringify(nodes.map((n) => [n.id, n.position]));
  useEffect(() => {
    const el = canvas.current;
    if (!el || !instance) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      if (el.clientWidth > 0 && el.clientHeight > 0)
        frame = requestAnimationFrame(() => {
          void instance.fitView({ padding: 0.15, maxZoom: 1 });
        });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [instance, topology]);
  function select(path: Path) {
    if (stale) return;
    const n = model.ranges.find((n) => JSON.stringify(n.path) === JSON.stringify(path));
    if (n?.range) onSelect(path, n.range.from, n.range.to);
  }
  function connect(c: Connection) {
    if (stale || !c.source || !c.target || c.source === c.target) return;
    const target = model.jobs.find((j) => j.id === c.target);
    if (target && !target.needs.includes(c.source)) onEditNeeds(target.id, [...target.needs, c.source]);
  }
  const detail = model.details.find((d) => d.id === (active ?? selected));
  const job = model.jobs.find((j) => j.id === detail?.id);
  return (
    <div>
      {stale && <p role="status">Waiting for current source parse…</p>}
      {!nodes.length ? (
        <p>No jobs to display. Open or parse a workflow.</p>
      ) : (
        <>
          <div className="orb-graph-canvas" ref={canvas}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              key={JSON.stringify(nodes.map((n) => [n.id, n.position]))}
              onInit={setInstance}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              minZoom={0.05}
              maxZoom={1.5}
              nodesConnectable={!stale}
              onConnect={connect}
              isValidConnection={(c) =>
                !stale &&
                c.source !== c.target &&
                !model.jobs.find((j) => j.id === c.target)?.needs.includes(c.source)
              }
              deleteKeyCode={null}
              nodesDraggable={false}
              onNodeClick={(_, node) => {
                setSelected(node.id);
                select(['jobs', node.id]);
              }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
          <small className="text-muted-foreground">Connect jobs to edit dependencies.</small>
          <small>
            {nodes.length} jobs · {edges.length} dependencies
            {model.jobs.length > 300 ? ' · limited to 300 jobs' : ''}
          </small>
        </>
      )}
      {detail && (
        <section className="orb-graph-detail">
          <h3>{detail.name ?? detail.id}</h3>
          <p className="text-xs text-muted-foreground">Select a step to edit its configuration or script.</p>
          {job && (
            <details>
              <summary>Dependencies ({job.needs.length})</summary>
              <fieldset className="orb-dependencies" disabled={stale}>
                <legend>Dependencies</legend>
                {model.jobs
                  .filter((j) => j.id !== job.id)
                  .map((j) => (
                    <label key={j.id}>
                      <input
                        type="checkbox"
                        checked={job.needs.includes(j.id)}
                        onChange={(e) =>
                          onEditNeeds(
                            job.id,
                            e.target.checked ? [...job.needs, j.id] : job.needs.filter((n) => n !== j.id),
                          )
                        }
                      />
                      {j.id}
                    </label>
                  ))}
              </fieldset>
            </details>
          )}
          <div className="orb-step-list">
            {detail.steps.map((step) => (
              <button
                key={step.index}
                disabled={stale}
                onClick={() => select(['jobs', detail.id, 'steps', step.index])}
              >
                {step.index + 1}. {step.name ?? step.uses ?? step.kind} {step.kind === 'shell' ? ' · Script' : ''}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
