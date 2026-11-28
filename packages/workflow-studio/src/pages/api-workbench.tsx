import { patchWorkflowFields } from '@code/workflow-core';
import { StepPorts } from './step-ports';
import { WorkbenchLayout } from '../components/shared/workbench-layout';
import { PanelNavigation } from '../components/shared/panel-navigation';
import { editWorkflow, editJobNeeds, parseWorkflow } from '@code/workflow-core';
import type { OpenWorkflow } from '../workspace/explorer';
import { useRef, useState, useEffect } from 'react';
import { Send, Copy, Square, FolderGit2 } from 'lucide-react';
import { useRouteState, useStudioRuntime } from '../runtime';
import { LocalSourceTools } from './local-source-tools';
import { useWorkspace } from '../workspace/context';
import { SourceEditor, type SourceEditorHandle } from './source-editor';
import { useDrafts, documentId, type Draft } from './drafts';
import { useLiveParser } from './live-parser';
import { BuilderForm, type BuilderEdit } from './builder-form';
import { PatchReview } from './patch-review';
import { WorkflowGraph } from './workflow-graph';
import { AstExplorer } from './ast-explorer';
const operations = [
  'health',
  'github/repositories',
  'branches',
  'pulls',
  'commits',
  'actions/workflows',
  'actions/runs',
  'workflow-source',
  'parse',
  'validate',
  'inspect',
  'transform',
] as const;
type Operation = (typeof operations)[number];
type Result = {
  status: number;
  ms: number;
  bytes: number;
  body: string;
  headers: string;
};
const parserOps = ['parse', 'validate', 'inspect', 'transform'];
export function ApiWorkbench({ file }: { file?: OpenWorkflow } = {}) {
  const { repos } = useWorkspace();
  return <Lab key={repos.join(',') + JSON.stringify(file ?? null)} repos={repos} file={file} />;
}
function Lab({ repos, file }: { repos: string[]; file?: OpenWorkflow }) {
  const { adapter, request, updateRoute } = useStudioRuntime();
  const route = useRouteState();
  const routeSearch = new URLSearchParams(
    Object.entries(route).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  ).toString();
  const studio = adapter.mode !== 'api';
  const routePane = useRouteState((s) => s.pane);
  const pane = routePane === 'graph' || routePane === 'ast' || routePane === 'inspector' ? routePane : 'source';
  function setPane(next: 'source' | 'graph' | 'ast' | 'inspector') {
    updateRoute({ pane: next });
  }
  const [graphKind, setGraphKind] = useState('jobs');
  const [operation, setOperation] = useState<Operation>('workflow-source');
  const [repo, setRepo] = useState(() => {
    const r = file?.repo ?? new URLSearchParams(routeSearch).get('repo');
    return r && repos.includes(r) ? r : (repos[0] ?? '');
  });
  const [ref, setRef] = useState(() => file?.ref ?? new URLSearchParams(routeSearch).get('ref') ?? 'main');
  const [path, setPath] = useState(
    () => file?.path ?? new URLSearchParams(routeSearch).get('path') ?? '.github/workflows/ci.yml',
  );
  const [yaml, setYaml] = useState('');
  const drafts = useDrafts(repos);
  const [opened, setOpened] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [nodePath, setNodePath] = useState('["name"]');
  const [value, setValue] = useState('Orb verification');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'body' | 'headers' | 'ast' | 'graph'>(studio ? 'graph' : 'body');
  useEffect(() => {
    if (studio) setTab(pane === 'ast' ? 'ast' : 'graph');
  }, [studio, pane]);
  const editor = useRef<SourceEditorHandle>(null);
  const [parsedSource, setParsedSource] = useState('');
  const active = useRef<AbortController | null>(null);
  const [transformed, setTransformed] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    source: string;
    yaml: string;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [sync, setSync] = useState(true);
  const [live, setLive] = useState(true);
  const parsed = useLiveParser(yaml, live);
  const astBody = live ? parsed.body : (result?.body ?? '');
  const astStale = live ? parsed.source !== yaml : yaml !== (transformed ?? parsedSource);
  const linkedRange = useRef<{ from: number; to: number } | null>(null);
  function linkSource(from: number, to: number) {
    linkedRange.current = { from, to };
    if (sync) editor.current?.select(from, to);
  }
  useEffect(() => {
    if (pane === 'source' && sync && linkedRange.current) {
      const { from, to } = linkedRange.current;
      editor.current?.select(from, to, true);
    }
  }, [pane, sync]);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  const autoLoaded = useRef(false);
  const local = opened?.repo === '@local';
  function openLocal(source: string, filename: string) {
    if (busy || editBusy) return;
    const d: Draft = {
      id: crypto.randomUUID(),
      repo: '@local',
      ref: 'local',
      path: filename,
      yaml: source,
      original: source,
      updatedAt: Date.now(),
    };
    switchDocument(d);
    void drafts.save(d).catch((e) => setDraftError(String(e)));
  }
  const documentKey = documentId(repo, ref, path);
  function editYaml(value: string) {
    linkedRange.current = null;
    setYaml(value);
    if (opened) {
      const next = { ...opened, yaml: value, updatedAt: Date.now() };
      setOpened(next);
      void drafts.save(next).catch((e) => setDraftError(String(e)));
    }
  }
  async function propose(build: (source: string) => { yaml: string }) {
    if (editBusy || busy) return;
    const source = yaml;
    setEditBusy(true);
    setProposal(null);
    setError('');
    try {
      const data = build(source);
      setProposal({ source, yaml: data.yaml });
    } catch (e) {
      setError(String(e));
    } finally {
      setEditBusy(false);
    }
  }
  function editNeeds(job: string, needs: string[]) {
    void propose((source) => editJobNeeds(source, job, needs));
  }
  function editJob(edit: BuilderEdit) {
    void propose((source) => editWorkflow(source, edit));
  }
  function switchDocument(d: Draft) {
    if (active.current || editBusy) return;
    setProposal(null);
    linkedRange.current = null;
    updateRoute({ job: null, step: null, inspector: null });
    if (d.repo === '@local') {
      setOperation('parse');
      updateRoute({ draft: d.id });
    } else {
      updateRoute({ draft: null });
    }
    setRepo(d.repo);
    setRef(d.ref);
    setPath(d.path);
    setOpened(d);
    setYaml(d.yaml);
    setResult(null);
    setTransformed(null);
    setParsedSource('');
    setCursor(0);
    setTab(studio ? 'graph' : 'ast');
  }
  function detach() {
    setProposal(null);
    updateRoute({ draft: null });
    linkedRange.current = null;
    setOpened(null);
    setYaml('');
    setResult(null);
    setTransformed(null);
    setParsedSource('');
  }
  const post = parserOps.includes(operation);
  const encodedRepo = repo.split('/').map(encodeURIComponent).join('/');
  const endpoint = post
    ? '/v1/workflows/' + operation
    : operation === 'health' || operation === 'github/repositories'
      ? '/v1/' + operation
      : '/v1/github/' +
        encodedRepo +
        '/' +
        operation +
        (operation === 'workflow-source' ? '?' + new URLSearchParams({ path, ref }) : '');
  async function send() {
    if (active.current) return;
    if (studio && local) {
      try {
        const data = parseWorkflow(yaml);
        setResult({
          status: 200,
          ms: 0,
          bytes: new TextEncoder().encode(JSON.stringify(data)).length,
          body: JSON.stringify(data),
          headers: '',
        });
        setParsedSource(yaml);
        setTab('graph');
        setError('');
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    setTransformed(null);
    const start = performance.now();
    try {
      if (!post && !['health', 'github/repositories'].includes(operation) && !/^[-\w.]+\/[-\w.]+$/.test(repo))
        throw Error('Use owner/repository');
      const body = post
        ? JSON.stringify(operation === 'transform' ? { yaml, path: JSON.parse(nodePath), value } : { yaml })
        : undefined;
      const response = await request(endpoint, {
        method: post ? 'POST' : 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        signal: controller.signal,
        headers: post ? { 'Content-Type': 'application/json' } : undefined,
        body,
      });
      const raw = await response.text();
      let formatted = raw;
      try {
        const data = JSON.parse(raw);
        formatted = JSON.stringify(data, null, 2);
        if (response.ok && operation === 'workflow-source' && typeof data.yaml === 'string') {
          const previous = await drafts.get(documentKey);
          const d = previous ?? {
            id: documentKey,
            repo,
            ref,
            path,
            yaml: data.yaml,
            original: data.yaml,
            updatedAt: Date.now(),
          };
          setOpened(d);
          setYaml(d.yaml);
          await drafts.save(d);
          linkedRange.current = null;
          setTab(studio ? 'graph' : 'ast');
        }
        if (response.ok && operation === 'transform' && typeof data.yaml === 'string') setTransformed(data.yaml);
      } catch {
        /* Incomplete source has no inspector data; the parser displays diagnostics. */
      }
      const headers: string[] = [];
      response.headers.forEach((v, k) => headers.push(k + ': ' + v));
      setParsedSource(yaml);
      setResult({
        status: response.status,
        ms: Math.round(performance.now() - start),
        bytes: new TextEncoder().encode(raw).length,
        body: formatted,
        headers: headers.join('\n'),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      active.current = null;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (adapter.initialDocument && !autoLoaded.current && !route.draft && !file) {
      autoLoaded.current = true;
      const initial = adapter.initialDocument;
      let alive = true;
      void drafts
        .get(initial.id)
        .then((previous) => {
          if (!alive) return;
          const draft: Draft = previous ?? {
            id: initial.id,
            repo: '@local',
            ref: 'local',
            path: initial.filename,
            yaml: initial.source,
            original: initial.source,
            updatedAt: Date.now(),
          };
          switchDocument(draft);
          return drafts.save(draft);
        })
        .catch((error) => {
          if (alive) setDraftError(String(error));
        });
      return () => {
        alive = false;
      };
    }
  }, []);
  useEffect(() => {
    const localId = new URLSearchParams(routeSearch).get('draft');
    if (localId && !autoLoaded.current) {
      autoLoaded.current = true;
      void drafts
        .get(localId)
        .then((d) => {
          if (d?.repo === '@local') switchDocument(d);
          else setDraftError('Local draft not found on this device');
        })
        .catch((e) => setDraftError(String(e)));
      return;
    }
    if (!autoLoaded.current && (file || new URLSearchParams(routeSearch).has('path'))) {
      autoLoaded.current = true;
      void send();
    }
  }, []);
  return (
    <section className={studio ? 'lab orb-studio' : 'lab'}>
      <div className="heading" hidden={studio}>
        <div>
          <p className="eyebrow">{studio ? 'ORB / WORKSPACE' : 'ORB / DEVELOPER TOOLS'}</p>
          <h1>{studio ? 'Workflow Studio' : 'API Lab'}</h1>
          <p>Open a repository workflow or work with your own YAML.</p>
        </div>
      </div>
      <LocalSourceTools
        source={yaml}
        filename={opened?.path ?? 'workflow.yml'}
        disabled={busy || editBusy}
        onOpen={openLocal}
      />
      <div className="lab-tabs orb-documents" aria-label="Open documents">
        {drafts.items.map((d) => (
          <span key={d.id} className="lab-document">
            <button
              disabled={busy || editBusy}
              aria-pressed={opened?.id === d.id}
              onClick={() => switchDocument(d)}
              title={d.repo + ' @ ' + d.ref + ' / ' + d.path}
            >
              {d.repo === '@local' ? 'Local' : d.repo.split('/').at(-1)} / {d.path.split('/').at(-1)}
              {d.yaml !== d.original ? ' •' : ''}
            </button>
            <button
              disabled={busy || editBusy}
              aria-label={'Close ' + d.path}
              onClick={() => {
                if (d.yaml !== d.original && !window.confirm('Discard local changes and close this draft?'))
                  return;
                void drafts
                  .remove(d.id)
                  .then(() => {
                    if (opened?.id === d.id) detach();
                  })
                  .catch((e) => setDraftError(String(e)));
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {(draftError || drafts.error) && <p role="alert">{draftError || drafts.error}</p>}
      {opened && !studio && (
        <small>
          {opened.repo} @ {opened.ref} · {opened.yaml === opened.original ? 'Original' : 'Local draft'}
        </small>
      )}
      <div className="lab-layout">
        {!studio && (
          <aside className="lab-collection">
            <h3>
              <FolderGit2 size={15} /> Operations
            </h3>
            {operations.map((op) => (
              <button
                key={op}
                disabled={busy || (local && !parserOps.includes(op))}
                className={op === operation ? 'lab-selected' : ''}
                onClick={() => setOperation(op)}
              >
                <small>{parserOps.includes(op) ? 'POST' : 'GET'}</small>
                {op}
              </button>
            ))}
          </aside>
        )}
        <div className="lab-workspace">
          <div className="lab-address">
            {studio ? (
              <span>{opened?.path ?? 'Open a workflow from Explorer or import YAML'}</span>
            ) : (
              <>
                <code>{post ? 'POST' : 'GET'}</code>
                <code>{endpoint}</code>
              </>
            )}
            <button disabled={busy} onClick={send}>
              <Send size={14} /> {studio ? (local ? 'Parse' : 'Load') : 'Send'}
            </button>
            {busy && (
              <button onClick={() => active.current?.abort()} aria-label="Cancel">
                <Square size={14} />
              </button>
            )}
          </div>
          {studio && (
            <div className="orb-pane-nav">
              <PanelNavigation
                label="Studio panels"
                items={[
                  { id: 'source', label: 'YAML' },
                  { id: 'graph', label: 'Graph' },
                  { id: 'ast', label: 'AST' },
                  { id: 'inspector', label: 'Inspector' },
                ]}
                value={pane}
                onChange={(id) => {
                  if (id === 'source' || id === 'graph' || id === 'ast' || id === 'inspector') setPane(id);
                }}
              />
            </div>
          )}
          <WorkbenchLayout className="lab-columns" activePane={studio ? pane : undefined}>
            <section className="lab-panel orb-source-pane">
              <h3>{studio ? 'Source' : 'Request'}</h3>
              {!local && (!studio || !opened) && (
                <>
                  <label>
                    Repository
                    <select
                      value={repo}
                      disabled={busy}
                      onChange={(e) => {
                        detach();
                        setRepo(e.target.value);
                      }}
                    >
                      {repos.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ref
                    <input
                      value={ref}
                      disabled={busy}
                      onChange={(e) => {
                        detach();
                        setRef(e.target.value);
                      }}
                      autoCapitalize="none"
                    />
                  </label>
                  <label>
                    Workflow path
                    <input
                      value={path}
                      disabled={busy}
                      onChange={(e) => {
                        detach();
                        setPath(e.target.value);
                      }}
                      autoCapitalize="none"
                    />
                  </label>
                </>
              )}
              <label>
                YAML source
                <SourceEditor
                  key={opened?.id ?? 'scratch'}
                  ref={editor}
                  value={yaml}
                  onChange={editYaml}
                  onCursor={setCursor}
                  contextBody={astStale ? undefined : astBody}
                  diagnostics={live && parsed.source === yaml ? parsed.diagnostics : undefined}
                />
              </label>
              {operation === 'transform' && (
                <>
                  <label>
                    AST path (JSON)
                    <input value={nodePath} onChange={(e) => setNodePath(e.target.value)} />
                  </label>
                  <label>
                    Replacement
                    <input value={value} onChange={(e) => setValue(e.target.value)} />
                  </label>
                </>
              )}
            </section>
            <section className="lab-panel orb-inspect-pane">
              <h3 className="orb-response-heading">
                {studio ? 'Inspector' : 'Response'}{' '}
                {result && (
                  <small>
                    {result.status} · {result.ms} ms · {result.bytes} B
                  </small>
                )}
              </h3>
              <div className="lab-tabs orb-response-tabs">
                {!studio && (
                  <>
                    <button onClick={() => setTab('body')}>Body</button>
                    <button onClick={() => setTab('headers')}>Headers</button>
                  </>
                )}
                <button aria-pressed={tab === 'ast'} onClick={() => setTab('ast')}>
                  AST
                </button>
                <button aria-pressed={tab === 'graph'} onClick={() => setTab('graph')}>
                  Graph
                </button>
                <label>
                  <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live parse
                </label>
                <label>
                  <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Sync AST
                </label>
                <button
                  disabled={!result || tab === 'ast' || tab === 'graph'}
                  onClick={() => {
                    if (result && tab !== 'ast' && tab !== 'graph')
                      void navigator.clipboard
                        .writeText(result[tab])
                        .catch(() => setError('Clipboard unavailable'));
                  }}
                >
                  <Copy size={13} />
                </button>
              </div>
              {studio && pane === 'inspector' && linkedRange.current && (
                <button type="button" onClick={() => setPane('source')}>
                  Show selected YAML
                </button>
              )}
              {proposal && (
                <div>
                  <PatchReview before={proposal.source} after={proposal.yaml} />
                  {proposal.source !== yaml && (
                    <p role="alert">Source changed; discard and regenerate this patch.</p>
                  )}
                  <button
                    disabled={proposal.source !== yaml}
                    onClick={() => {
                      editYaml(proposal.yaml);
                      setProposal(null);
                    }}
                  >
                    Apply YAML patch
                  </button>
                  <button onClick={() => setProposal(null)}>Discard</button>
                </div>
              )}
              {transformed !== null && transformed !== yaml && (
                <button onClick={() => editYaml(transformed)}>Apply transformed YAML</button>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {tab === 'ast' && live && (
                <div role="status">
                  <small>
                    {parsed.status} · {parsed.diagnostics.length} diagnostics
                  </small>
                  {parsed.error && <p className="error">{parsed.error}</p>}
                  {parsed.source === yaml &&
                    parsed.diagnostics.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          if (d.offset !== null)
                            editor.current?.select(d.offset, Math.min(d.offset + 1, yaml.length));
                        }}
                      >
                        {d.severity}: {d.message}
                      </button>
                    ))}
                </div>
              )}
              {tab === 'graph' ? (
                <>
                  <div className="orb-builder-pane">
                    <BuilderForm
                      source={yaml}
                      onFields={(path, fields) =>
                        void propose((source) => patchWorkflowFields(source, path, fields))
                      }
                      body={astBody}
                      dispatchTarget={
                        opened && opened.repo !== '@local'
                          ? {
                              repo: opened.repo,
                              ref: opened.ref,
                              path: opened.path,
                            }
                          : undefined
                      }
                      disabled={astStale || editBusy || proposal !== null}
                      onEdit={editJob}
                    />
                  </div>
                  <div className="orb-flow-pane">
                    <nav aria-label="Graph views">
                      <button aria-pressed={graphKind === 'jobs'} onClick={() => setGraphKind('jobs')}>
                        Jobs
                      </button>
                      <button aria-pressed={graphKind === 'steps'} onClick={() => setGraphKind('steps')}>
                        Step ports
                      </button>
                    </nav>
                    {graphKind === 'steps' ? (
                      <StepPorts source={yaml} disabled={astStale || proposal !== null} onProposal={propose} />
                    ) : (
                      <WorkflowGraph
                        onEditNeeds={editNeeds}
                        body={astBody}
                        stale={astStale || editBusy || proposal !== null}
                        cursor={sync ? cursor : null}
                        onSelect={(path, from, to) => {
                          setNodePath(JSON.stringify(path));
                          setCursor(from);
                          if (path[2] === 'steps' && studio) setPane('inspector');
                          if (path[0] === 'jobs' && typeof path[1] === 'string')
                            updateRoute({
                              job: path[1],
                              step: typeof path[3] === 'number' ? String(path[3]) : '0',
                              inspector: path[2] === 'steps' ? 'steps' : 'job',
                            });
                          linkSource(from, to);
                        }}
                      />
                    )}
                  </div>
                </>
              ) : tab === 'ast' ? (
                <AstExplorer
                  cursor={sync ? cursor : null}
                  body={astBody}
                  stale={astStale}
                  onSelect={(path, from, to) => {
                    setNodePath(JSON.stringify(path));
                    setCursor(from);
                    if (studio) {
                      updateRoute({
                        inspector:
                          path[0] === 'jobs' && typeof path[1] === 'string'
                            ? path[2] === 'steps' && typeof path[3] === 'number'
                              ? 'steps'
                              : 'job'
                            : 'workflow',
                        job: typeof path[1] === 'string' && path[0] === 'jobs' ? path[1] : null,
                        step: typeof path[3] === 'number' ? String(path[3]) : '0',
                      });
                      if (path[0] === 'jobs' && path[2] === 'steps') {
                        setTab('graph');
                        setPane('inspector');
                      }
                    }
                    linkSource(from, to);
                  }}
                />
              ) : (
                <pre>
                  {busy
                    ? 'Waiting for server…'
                    : (result?.[tab] ?? 'Send a request to inspect the real response.')}
                </pre>
              )}
            </section>
          </WorkbenchLayout>
        </div>
      </div>
    </section>
  );
}
