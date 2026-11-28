import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  type Node,
  type NodeProps,
  type Connection,
  type Edge,
  useUpdateNodeInternals,
} from '@xyflow/react';
import { useQueries } from '@tanstack/react-query';
import { parseDocument } from 'yaml';
import { connectStepOutput } from '@code/workflow-core';
import { useStudioRuntime, useRouteState } from '../runtime';
type Port = { id: string; required: boolean };
type Data = { name: string; uses?: string; inputs: Port[]; outputs: Port[]; configured: string[] };
type StepNode = Node<Data, 'step'>;
function StepCard({ id, data, selected }: NodeProps<StepNode>) {
  const [expanded, setExpanded] = useState(false);
  const refresh = useUpdateNodeInternals();
  const visible = data.inputs.filter((port) => expanded || port.required || data.configured.includes(port.id));
  useEffect(() => refresh(id), [id, expanded, visible.length, refresh]);
  return (
    <div className={'orb-graph-job ' + (selected ? 'orb-graph-active' : '')} style={{ width: 230 }}>
      <strong>{data.name}</strong>
      <small>{data.uses ?? 'Script'}</small>
      {visible.map((port) => (
        <div key={port.id} style={{ position: 'relative', padding: '4px 8px' }}>
          <Handle type="target" position={Position.Left} id={port.id} style={{ top: 14, left: -14 }} />
          {port.id}
          {port.required ? ' *' : ''}
        </div>
      ))}
      {data.inputs.length > 0 && (
        <button className="nodrag" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide optional inputs' : `${data.inputs.length - visible.length} optional inputs`}
        </button>
      )}
      {data.outputs.map((port) => (
        <div key={port.id} style={{ position: 'relative', textAlign: 'right', padding: '4px 8px' }}>
          {port.id}
          <Handle type="source" position={Position.Right} id={port.id} style={{ top: 14, right: -14 }} />
        </div>
      ))}
    </div>
  );
}
const nodeTypes = { step: StepCard };
export function StepPorts({
  source,
  disabled,
  onProposal,
}: {
  source: string;
  disabled: boolean;
  onProposal: (build: (source: string) => { yaml: string }) => void;
}) {
  const { request, updateRoute } = useStudioRuntime();
  const route = useRouteState();
  const parsed = useMemo(() => {
    try {
      const doc = parseDocument(source);
      if (doc.errors.length) return null;
      return doc.toJS({ maxAliasCount: 0 }) as {
        jobs: Record<
          string,
          {
            steps?: Array<{
              id?: string;
              name?: string;
              uses?: string;
              run?: string;
              with?: Record<string, unknown>;
            }>;
          }
        >;
      };
    } catch {
      return null;
    }
  }, [source]);
  const jobs = Object.keys(parsed?.jobs ?? {}).filter((id) => Array.isArray(parsed?.jobs[id]?.steps));
  const job = jobs.includes(route.job ?? '') ? route.job! : jobs[0];
  const steps = parsed?.jobs[job]?.steps ?? [];
  const queries = useQueries({
    queries: steps.map((step) => ({
      queryKey: ['action-manifest', step.uses],
      enabled: !!step.uses,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const response = await request('/v1/actions/resolve?' + new URLSearchParams({ uses: step.uses! }), {
          signal,
        });
        if (!response.ok) throw Error('Action contract unavailable');
        return response.json() as Promise<{ inputs: Port[]; outputs: Port[] }>;
      },
    })),
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  useEffect(() => {
    setNodes((previous) =>
      steps.map((step, index) => ({
        id: String(index),
        type: 'step',
        position: previous[index]?.position ?? { x: (index % 3) * 300, y: Math.floor(index / 3) * 280 },
        data: {
          name: step.name ?? step.id ?? `Step ${index + 1}`,
          uses: step.uses,
          inputs: queries[index]?.data?.inputs ?? [],
          outputs: queries[index]?.data?.outputs ?? [],
          configured: Object.keys(step.with ?? {}),
        },
      })),
    );
  }, [source, queries.map((query) => query.dataUpdatedAt).join(',')]);
  const edges: Edge[] = steps.flatMap((step, index) =>
    Object.entries(step.with ?? {}).flatMap(([input, value]) => {
      const match = /steps\.([\w-]+)\.outputs\.([\w-]+)/.exec(String(value));
      const from = match ? steps.findIndex((candidate) => candidate.id === match[1]) : -1;
      return from >= 0
        ? [
            {
              id: index + ':' + input,
              source: String(from),
              target: String(index),
              sourceHandle: match![2],
              targetHandle: input,
            },
          ]
        : [];
    }),
  );
  function connect(connection: Connection) {
    if (!connection.sourceHandle || !connection.targetHandle || disabled) return;
    onProposal((current) =>
      connectStepOutput(
        current,
        job,
        Number(connection.source),
        connection.sourceHandle!,
        Number(connection.target),
        connection.targetHandle!,
      ),
    );
  }
  return (
    <section>
      <label>
        Job{' '}
        <select
          aria-label="Step graph job"
          value={job ?? ''}
          onChange={(event) => updateRoute({ job: event.target.value })}
        >
          {jobs.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      <button
        onClick={() =>
          setNodes((old) => old.map((node, index) => ({ ...node, position: { x: index * 300, y: 50 } })))
        }
      >
        Layout
      </button>
      {queries.some((query) => query.error) && (
        <p role="alert">Some action contracts are unavailable. YAML remains editable.</p>
      )}
      <div className="orb-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={connect}
          nodesConnectable={!disabled}
          deleteKeyCode={null}
          fitView
          onNodeClick={(_, node) => updateRoute({ job, step: node.id, inspector: 'steps', pane: 'inspector' })}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <small>Connect declared outputs to inputs of later steps. Review the YAML patch before applying.</small>
    </section>
  );
}
