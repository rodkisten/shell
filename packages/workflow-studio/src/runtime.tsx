import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createStore, useStore, type StoreApi } from 'zustand';
import Dexie, { type Table } from 'dexie';
import type { Draft } from './pages/drafts';
export type RouteState = Record<string, string | undefined>;
export type StudioRequest = (path: string, init?: RequestInit) => Promise<Response>;
export interface StudioAdapter {
  namespace: string;
  repositories: readonly string[];
  route: RouteState;
  navigate: (patch: Record<string, string | null>) => void;
  request: StudioRequest;
  signal: AbortSignal;
  mode?: 'studio' | 'api';
  initialDocument?: { id: string; source: string; filename: string };
  canDispatch?: boolean;
  draftsDatabase?: string;
  sessionsDatabase?: string;
}
class DraftDatabase extends Dexie {
  drafts!: Table<Draft, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ drafts: 'id,repo,updatedAt' });
  }
}
class SessionDatabase extends Dexie {
  sessions!: Table<{ id: string; value: unknown }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ sessions: 'id' });
  }
}
interface Scope {
  adapter: StudioAdapter;
  routeStore: StoreApi<RouteState>;
  draftDB: DraftDatabase;
  sessionDB: SessionDatabase;
  request: StudioRequest;
  updateRoute: (patch: Record<string, string | null>) => void;
}
const Context = createContext<Scope | null>(null);
export function useStudioRuntime() {
  const scope = useContext(Context);
  if (!scope) throw Error('Workflow Studio adapter required');
  return scope;
}
export function useRouteState<T = RouteState>(selector?: (state: RouteState) => T): T {
  return useStore(useStudioRuntime().routeStore, selector ?? ((value: RouteState) => value as T));
}
export function StudioProvider({ adapter, children }: { adapter: StudioAdapter; children: ReactNode }) {
  const latest = useRef(adapter);
  latest.current = adapter;
  const [query] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  );
  const [store] = useState(() => createStore<RouteState>(() => adapter.route));
  const [draftDB] = useState(
    () => new DraftDatabase(adapter.draftsDatabase ?? 'code-workflow-drafts:' + adapter.namespace),
  );
  const [sessionDB] = useState(
    () => new SessionDatabase(adapter.sessionsDatabase ?? 'code-workflow-session:' + adapter.namespace),
  );
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    return () => {
      queueMicrotask(() => {
        if (generation.current === current) {
          void query.cancelQueries();
          query.clear();
          draftDB.close();
          sessionDB.close();
        }
      });
    };
  }, [query, draftDB, sessionDB]);
  useEffect(() => {
    store.setState(adapter.route, true);
  }, [adapter.route, store]);
  const request: StudioRequest = (path, init = {}) => {
    if (!path.startsWith('/v1/') || path.includes('\\') || path.includes('..') || path.startsWith('//'))
      return Promise.reject(Error('Invalid Studio endpoint'));
    if (
      (init.method ?? 'GET').toUpperCase() !== 'GET' &&
      path.includes('/actions/dispatch') &&
      !latest.current.canDispatch
    )
      return Promise.reject(Error('Workflow dispatch not authorized by host'));
    return latest.current.request(path, {
      ...init,
      signal: init.signal ? AbortSignal.any([adapter.signal, init.signal]) : adapter.signal,
    });
  };
  const updateRoute = (patch: Record<string, string | null>) => {
    const next = { ...store.getState() };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    store.setState(next, true);
    latest.current.navigate(
      Object.fromEntries(
        Object.entries({ ...patch, ...next }).filter(
          (entry): entry is [string, string | null] => entry[1] !== undefined,
        ),
      ),
    );
  };
  return (
    <Context.Provider value={{ adapter, routeStore: store, draftDB, sessionDB, request, updateRoute }}>
      <QueryClientProvider client={query}>{children}</QueryClientProvider>
    </Context.Provider>
  );
}
