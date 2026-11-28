import { parseDocument } from 'yaml';
import { parseWorkflow, validateWorkflow, inspectWorkflow, replaceScalar } from '@code/workflow-core';
import type { StudioRequest } from './runtime';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function github(path: string, signal?: AbortSignal | null) {
  const response = await fetch('https://api.github.com' + path, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok)
    throw Error(
      'Public GitHub request failed (' +
        response.status +
        '); private repositories require an authorized orb adapter',
    );
  return response.json();
}
export const publicGitHubClient: StudioRequest = async (path, init = {}) => {
  const url = new URL(path, 'https://studio.invalid');
  const signal = init.signal;
  if (url.origin !== 'https://studio.invalid' || !url.pathname.startsWith('/v1/'))
    throw Error('Invalid Studio route');
  if ((init.method ?? 'GET') === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as {
      yaml: string;
      path: (string | number)[];
      value: string;
    };
    if (typeof body.yaml !== 'string' || body.yaml.length > 262144) throw Error('Invalid workflow source');
    if (path === '/v1/workflows/parse') return json(parseWorkflow(body.yaml));
    if (path === '/v1/workflows/validate') return json(validateWorkflow(body.yaml));
    if (path === '/v1/workflows/inspect') return json(inspectWorkflow(body.yaml));
    if (path === '/v1/workflows/transform') return json(replaceScalar(body.yaml, body.path, body.value));
    throw Error('Workflow execution requires an authorized orb session');
  }
  if (url.pathname === '/v1/actions/search') {
    const response = await github(
      '/search/repositories?' +
        new URLSearchParams({ q: (url.searchParams.get('q') ?? '') + ' topic:github-actions', per_page: '20' }),
      signal,
    );
    return json({
      search: {
        nodes: response.items.map(
          (item: { full_name: string; description: string | null; default_branch: string }) => ({
            nameWithOwner: item.full_name,
            description: item.description,
            defaultBranchRef: { name: item.default_branch },
          }),
        ),
      },
    });
  }
  if (url.pathname === '/v1/actions/versions') {
    const owner = url.searchParams.get('owner'),
      repo = url.searchParams.get('repo');
    if (!/^[-\w.]+$/.test(owner ?? '') || !/^[-\w.]+$/.test(repo ?? '')) throw Error('Invalid repository');
    const tags = await github(`/repos/${owner}/${repo}/tags?per_page=100`, signal);
    return json(
      tags.map((tag: { name: string; commit: { sha: string } }) => ({
        name: tag.name,
        target: { oid: tag.commit.sha },
      })),
    );
  }
  if (url.pathname === '/v1/actions/resolve') {
    const uses = url.searchParams.get('uses') ?? '';
    const match = /^([-\w.]+)\/([-\w.]+)((?:\/[-\w.]+)*)@([-\w./]+)$/.exec(uses);
    if (!match || match.slice(1).some((value) => value.split('/').includes('..')))
      throw Error('Use owner/repo[/path]@ref');
    const [, owner, repo, subpath, ref] = match;
    const commit = await github(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, signal);
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw Error('Invalid resolved SHA');
    for (const filename of ['action.yml', 'action.yaml']) {
      const response = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}${subpath}/${filename}`,
        { signal, credentials: 'omit', redirect: 'error' },
      );
      if (response.status === 404) continue;
      if (!response.ok) throw Error('Action manifest unavailable');
      const text = await response.text();
      if (text.length > 262144) throw Error('Action manifest too large');
      const doc = parseDocument(text, { uniqueKeys: true });
      if (doc.errors.length) throw Error('Invalid action manifest');
      const data = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
      const ports = (value: unknown) =>
        Object.entries(value && typeof value === 'object' ? value : {}).map(([id, raw]) => {
          const port = raw as Record<string, unknown>;
          return {
            id,
            description: String(port.description ?? ''),
            required: port.required === true,
            ...(port.default === undefined ? {} : { default: String(port.default) }),
          };
        });
      return json({
        name: String(data.name ?? uses),
        description: String(data.description ?? ''),
        commitSha: commit.sha,
        inputs: ports(data.inputs),
        outputs: ports(data.outputs),
      });
    }
    throw Error('Action manifest not found');
  }
  const source = /^\/v1\/github\/([-\w.]+)\/([-\w.]+)\/workflow-source$/.exec(url.pathname);
  if (source) {
    const [, owner, repo] = source,
      ref = url.searchParams.get('ref') ?? 'main',
      file = url.searchParams.get('path') ?? '';
    if (!/^\.github\/workflows\/[-\w.]+\.ya?ml$/.test(file)) throw Error('Invalid workflow path');
    const commit = await github(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, signal);
    const blob = await github(`/repos/${owner}/${repo}/contents/${file}?ref=${commit.sha}`, signal);
    if (blob.encoding !== 'base64' || blob.size > 262144) throw Error('Unsupported workflow source');
    const yaml = new TextDecoder().decode(
      Uint8Array.from(atob(blob.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)),
    );
    return json({ yaml, sha: blob.sha, commitSha: commit.sha, ...parseWorkflow(yaml) });
  }
  if (url.pathname === '/v1/health') return json({ mode: 'public', execution: false });
  throw Error('This operation requires an authenticated orb adapter');
};
