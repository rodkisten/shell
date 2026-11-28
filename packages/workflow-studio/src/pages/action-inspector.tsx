import { useStudioRuntime, type StudioRequest } from '../runtime';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
type Port = {
  id: string;
  description: string;
  required: boolean;
  default?: string;
};
type Manifest = {
  name: string;
  description: string;
  commitSha: string;
  inputs: Port[];
  outputs: Port[];
};
async function load<T>(
  request: StudioRequest,
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<T> {
  const response = await request('/v1/actions/' + path + '?' + new URLSearchParams(params), {
    signal,
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw Error('GitHub lookup failed: ' + response.status);
  return response.json();
}
export function ActionInspector({
  uses,
  onUses,
  inputs,
  onInputs,
}: {
  uses: string;
  onUses: (v: string) => void;
  inputs: Record<string, string>;
  onInputs: (v: Record<string, string>) => void;
}) {
  const { request } = useStudioRuntime();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const repo = uses.split('@')[0].split('/').slice(0, 2);
  const results = useQuery({
    queryKey: ['action-search', query],
    enabled: query.length >= 2,
    queryFn: ({ signal }) =>
      load<{
        search: {
          nodes: {
            nameWithOwner: string;
            description: string | null;
            defaultBranchRef: { name: string } | null;
          }[];
        };
      }>(request, 'search', { q: query }, signal),
  });
  const versions = useQuery({
    queryKey: ['action-versions', ...repo],
    enabled: repo.length === 2 && repo.every(Boolean),
    queryFn: ({ signal }) =>
      load<{ name: string; target: { oid: string } }[]>(
        request,
        'versions',
        { owner: repo[0], repo: repo[1] },
        signal,
      ),
  });
  const manifest = useQuery({
    queryKey: ['action-manifest', uses],
    enabled: /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[\w./-]+$/.test(uses),
    queryFn: ({ signal }) => load<Manifest>(request, 'resolve', { uses }, signal),
  });
  return (
    <section className="orb-action-inspector">
      <h4>Action Inspector</h4>
      <label>
        Search GitHub
        <Input value={search} onChange={(e) => setSearch(e.target.value)} autoCapitalize="none" />
      </label>
      <Button type="button" disabled={search.trim().length < 2} onClick={() => setQuery(search.trim())}>
        Search
      </Button>
      <div className="orb-action-results">
        {results.data?.search.nodes
          .filter((n) => n?.nameWithOwner)
          .map((n) => (
            <Button
              type="button"
              key={n.nameWithOwner}
              onClick={() => onUses(n.nameWithOwner + '@' + (n.defaultBranchRef?.name ?? 'main'))}
            >
              <strong>{n.nameWithOwner}</strong>
              <small>{n.description}</small>
            </Button>
          ))}
      </div>
      {versions.data && (
        <label>
          Version
          <select
            value={uses.split('@')[1] ?? ''}
            onChange={(e) => onUses(uses.split('@')[0] + '@' + e.target.value)}
          >
            <option value={uses.split('@')[1] ?? ''}>{uses.split('@')[1] ?? 'Select'}</option>
            {versions.data
              .filter((v) => v.name !== uses.split('@')[1])
              .map((v) => (
                <option key={v.name}>{v.name}</option>
              ))}
          </select>
        </label>
      )}
      {[results, versions, manifest].some((q) => q.isFetching) && <p role="status">Loading GitHub metadata…</p>}
      {[results, versions, manifest]
        .filter((q) => q.isError)
        .map((q, i) => (
          <p key={i} role="alert">
            {String(q.error)}
          </p>
        ))}
      {manifest.data && (
        <>
          <h4>{manifest.data.name}</h4>
          <p>{manifest.data.description}</p>
          <Button type="button" onClick={() => onUses(uses.split('@')[0] + '@' + manifest.data!.commitSha)}>
            Pin commit SHA
          </Button>
          <details open>
            <summary>Inputs ({manifest.data.inputs.length})</summary>
            {manifest.data.inputs.map((p) => (
              <label key={p.id}>
                {p.id}
                {p.required ? ' (required)' : ''}
                <small>{p.description}</small>
                <Input
                  required={p.required && p.default === undefined}
                  placeholder={p.default ?? ''}
                  value={inputs[p.id] ?? ''}
                  onChange={(e) => {
                    const next = { ...inputs };
                    if (e.target.value) next[p.id] = e.target.value;
                    else delete next[p.id];
                    onInputs(next);
                  }}
                  autoCapitalize="none"
                />
              </label>
            ))}
          </details>
          <details>
            <summary>Outputs ({manifest.data.outputs.length})</summary>
            {manifest.data.outputs.map((p) => (
              <p key={p.id}>
                {p.id} · {p.description}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
