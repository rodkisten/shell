import { Activity, ExternalLink } from 'lucide-react';
export type ExecutionStep = { id: string; name: string; status: string };
export type ExecutionJob = ExecutionStep & {
  url?: string;
  steps?: readonly ExecutionStep[];
};
export function ExecutionTracker({
  title,
  name,
  status,
  url,
  jobs = [],
  errors = [],
  note,
}: {
  title: string;
  name: string;
  status: string;
  url?: string;
  jobs?: readonly ExecutionJob[];
  errors?: readonly string[];
  note?: string;
}) {
  return (
    <section className="grid min-w-0 gap-2 rounded-xl border border-border bg-card p-3 text-card-foreground">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Activity size={16} />
        {title}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{name}</strong>
        <span role="status" className="rounded-md bg-muted px-2 py-1 text-xs">
          {status}
        </span>
      </div>
      {errors.map((error, i) => (
        <p key={i} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ))}
      {url && (
        <a className="flex items-center gap-1 text-sm underline" href={url} target="_blank" rel="noreferrer">
          Open execution logs <ExternalLink size={12} />
        </a>
      )}
      {jobs.map((job) => (
        <details key={job.id} className="rounded-md border border-border p-2">
          <summary className="cursor-pointer text-sm">
            {job.name} · {job.status}
          </summary>
          <div className="mt-2 grid gap-1">
            {job.steps?.map((step) => (
              <div key={step.id} className="flex justify-between gap-2 text-xs">
                <span>{step.name}</span>
                <span className="text-muted-foreground">{step.status}</span>
              </div>
            ))}
            {job.url && (
              <a className="text-xs underline" href={job.url} target="_blank" rel="noreferrer">
                Job logs
              </a>
            )}
          </div>
        </details>
      ))}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}
