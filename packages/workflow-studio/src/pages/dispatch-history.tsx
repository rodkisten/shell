import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useStudioRuntime } from '../runtime';
import { Button } from '../components/ui/button';
import { History, Trash2 } from 'lucide-react';
export type DispatchRecord = {
  id: string;
  repo: string;
  path: string;
  ref: string;
  sha: string;
  at: number;
  status: 'accepted' | 'unconfirmed';
  runsUrl?: string;
  runId?: number;
};
const key = (repo: string, path: string) => 'dispatch-history:' + JSON.stringify([repo, path]);
export async function recordDispatch(
  sessionDB: ReturnType<typeof useStudioRuntime>['sessionDB'],
  record: DispatchRecord,
) {
  const id = key(record.repo, record.path);
  await sessionDB.transaction('rw', sessionDB.sessions, async () => {
    const row = await sessionDB.sessions.get(id);
    const previous = Array.isArray(row?.value) ? (row.value as DispatchRecord[]) : [];
    await sessionDB.sessions.put({
      id,
      value: [record, ...previous.filter((r) => r.id !== record.id)].slice(0, 50),
    });
  });
}
export function DispatchHistory({
  repo,
  path,
  onRef,
}: {
  repo: string;
  path: string;
  onRef: (ref: string) => void;
}) {
  const { sessionDB } = useStudioRuntime();
  const id = key(repo, path);
  const [error, setError] = useState('');
  const rows = useLiveQuery(async () => {
    try {
      const row = await sessionDB.sessions.get(id);
      return {
        items: Array.isArray(row?.value) ? (row.value as DispatchRecord[]) : [],
        error: '',
      };
    } catch {
      return { items: [], error: 'Local history unavailable' };
    }
  }, [id]);
  const items = rows?.items ?? [];
  return (
    <section className="orb-expression rounded-xl border border-border p-3">
      <h3>
        <History size={16} /> Dispatch history
      </h3>
      <small>Local device · last 50 attempts · no input values saved</small>
      {!rows && <p>Loading history…</p>}
      {rows?.error && <p role="alert">{rows.error}</p>}
      {rows && !rows.error && !items.length && <p>No dispatch attempts yet.</p>}
      {items.map((row) => (
        <div key={row.id} className="rounded-md border border-border p-2">
          <div className="flex justify-between gap-2">
            <strong>{row.ref}</strong>
            <small>{row.status === 'accepted' ? 'Accepted' : 'Unconfirmed'}</small>
          </div>
          <small>
            {new Date(row.at).toLocaleString()} · {row.sha.slice(0, 12)}
          </small>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onRef(row.ref)}>
              Use ref
            </Button>
            {row.runsUrl?.startsWith('https://github.com/' + repo + '/actions/workflows/') && (
              <a
                href={row.runId ? 'https://github.com/' + repo + '/actions/runs/' + row.runId : row.runsUrl}
                target="_blank"
                rel="noreferrer"
              >
                View runs
              </a>
            )}
          </div>
        </div>
      ))}
      {items.length > 0 && (
        <Button
          type="button"
          onClick={() => {
            if (window.confirm('Clear local dispatch history?'))
              void sessionDB.sessions.delete(id).catch(() => setError('Unable to clear history'));
          }}
        >
          <Trash2 size={14} /> Clear history
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
