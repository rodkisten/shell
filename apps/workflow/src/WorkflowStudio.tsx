import { useEffect, useMemo, useRef, useState } from 'react';
import Studio, { publicGitHubClient, type StudioAdapter } from '@code/workflow-studio';
import { importLegacyWorkflow } from '@code/workflow-core';
import { assertModuleContext, type RodModuleContext } from '@rodverse/module-sdk';

/** Same feature, with local adapters for standalone and injected adapters for Manage. */
export default function WorkflowStudio({
  context,
  search = '',
  onNavigate,
}: {
  context?: RodModuleContext;
  search?: string;
  onNavigate?: (search: string) => void;
}) {
  const latest = useRef({ context, onNavigate });
  latest.current = { context, onNavigate };
  const [localRoute, setLocalRoute] = useState<Record<string, string>>(() =>
    Object.fromEntries(new URLSearchParams(search)),
  );
  const [lifetime, setLifetime] = useState<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLifetime(controller);
    return () => controller.abort();
  }, []);
  if (context) assertModuleContext(context);
  const route = useMemo(
    () => Object.fromEntries(new URLSearchParams(context?.location.search ?? search)),
    [context?.location.search, search],
  );
  const [legacy] = useState(() => {
    try {
      return {
        source: importLegacyWorkflow(JSON.parse(localStorage.getItem('code.workflow.v1') ?? 'null')),
        error: '',
      };
    } catch (error) {
      return {
        source: null,
        error:
          'Legacy draft could not be imported: ' +
          String(error) +
          '. Original data remains in code.workflow.v1; export it before clearing storage.',
      };
    }
  });
  const migration = legacy.source;
  const signal = context?.signal ?? lifetime?.signal;
  const adapter = useMemo<StudioAdapter | null>(
    () =>
      signal
        ? {
            namespace: `${context?.identity?.id ?? 'local'}:${context?.workspace.id ?? 'default'}`,
            repositories: context?.workspace.repository
              ? [context.workspace.repository]
              : ['rodverse/rodverse', 'rodkisten/shell', 'rodkisten/orb'],
            route: context || onNavigate ? route : localRoute,
            signal,
            canDispatch: false,
            navigate: (patch) => {
              const next = Object.fromEntries(
                Object.entries(patch).filter((entry): entry is [string, string] => entry[1] !== null),
              );
              const query = new URLSearchParams(next).toString();
              if (latest.current.context) latest.current.context.navigate('/?' + query);
              else if (latest.current.onNavigate) latest.current.onNavigate(query);
              else setLocalRoute(next);
            },
            request: async (path, init = {}) => {
              const authorized = latest.current.context?.api['workflow.request'];
              if (!authorized) return publicGitHubClient(path, init);
              const response = (await authorized(
                { path, method: init.method ?? 'GET', body: init.body },
                init.signal ?? signal,
              )) as { status: number; body: string; headers?: Record<string, string> };
              return new Response(response.body, { status: response.status, headers: response.headers });
            },
            initialDocument: migration
              ? { id: 'legacy-shell-workflow-v1', source: migration, filename: 'workflow.yml' }
              : undefined,
          }
        : null,
    [
      context?.identity?.id,
      context?.workspace.id,
      context?.workspace.repository,
      signal,
      route,
      localRoute,
      migration,
      !!onNavigate,
    ],
  );
  useEffect(() => {
    if (!context) return;
    context.lifecycle.ready();
    return () => context.lifecycle.dispose();
  }, [context?.signal]);
  return (
    <main
      style={{
        minHeight: context ? 0 : '100dvh',
        height: context ? '100%' : '100dvh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
        <h1 style={{ fontSize: 16 }}>Workflow Studio</h1>
        <small>
          Code · {context?.api['workflow.request'] ? 'Connected workspace' : 'Public GitHub · local drafts'}
        </small>
      </header>
      {legacy.error && <p role="alert">{legacy.error}</p>}
      {adapter && <Studio adapter={adapter} />}
    </main>
  );
}
