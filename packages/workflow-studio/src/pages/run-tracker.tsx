import { useStudioRuntime, type StudioRequest } from '../runtime';
import { useQuery } from '@tanstack/react-query';
import { ExecutionTracker } from '../components/shared/execution-tracker';
type Run = {
  status: string;
  conclusion: string | null;
  name: string;
  run_started_at: string;
  updated_at: string;
};
type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps?: {
    number: number;
    name: string;
    status: string;
    conclusion: string | null;
  }[];
};
async function read<T>(request: StudioRequest, url: string, signal: AbortSignal) {
  const r = await request(url, {
    signal,
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
  });
  if (!r.ok) throw Error('Run lookup failed (' + r.status + ')');
  return r.json() as Promise<{ data: T; hasNext: boolean }>;
}
export function RunTracker({ repo, id }: { repo: string; id: number }) {
  const { request } = useStudioRuntime();
  const base = '/v1/github/' + repo.split('/').map(encodeURIComponent).join('/') + '/actions/runs/' + id;
  const run = useQuery({
    queryKey: ['run', repo, id],
    queryFn: ({ signal }) => read<Run>(request, base, signal),
    refetchInterval: (q) => (q.state.data?.data.status === 'completed' ? false : 10000),
    retry: false,
  });
  const jobs = useQuery({
    queryKey: ['run-jobs', repo, id],
    queryFn: ({ signal }) => read<{ jobs: Job[] }>(request, base + '/jobs?limit=100', signal),
    refetchInterval: (q) =>
      run.data?.data.status === 'completed' && q.state.data?.data.jobs.every((j) => j.status === 'completed')
        ? false
        : 10000,
    retry: false,
  });
  const data = run.data?.data;
  const url = 'https://github.com/' + repo + '/actions/runs/' + id;
  return (
    <ExecutionTracker
      title={'Run #' + id}
      name={data?.name ?? 'Waiting for GitHub'}
      status={data?.conclusion ?? data?.status ?? 'Loading…'}
      url={url}
      errors={[run.error, jobs.error].filter(Boolean).map(String)}
      jobs={jobs.data?.data.jobs.map((j) => ({
        id: String(j.id),
        name: j.name,
        status: j.conclusion ?? j.status,
        url: url + '/job/' + j.id,
        steps: j.steps?.map((s) => ({
          id: String(s.number),
          name: s.number + '. ' + s.name,
          status: s.conclusion ?? s.status,
        })),
      }))}
      note={(jobs.data?.hasNext ? 'First 100 jobs shown. ' : '') + 'Refreshes every 10 seconds while active.'}
    />
  );
}
