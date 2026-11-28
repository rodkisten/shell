import { useMemo } from 'react';
export function PatchReview({
  before,
  after,
  title = 'Review changes',
}: {
  before: string;
  after: string;
  title?: string;
}) {
  const diff = useMemo(() => {
    const a = before.split('\n'),
      b = after.split('\n');
    let start = 0,
      end = 0;
    while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
    while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return {
      start,
      removed: a.slice(start, a.length - end),
      added: b.slice(start, b.length - end),
      context: a.slice(Math.max(0, start - 3), start),
      tail: a.slice(a.length - end, a.length - end + 3),
    };
  }, [before, after]);
  return (
    <section aria-label={title} className="grid min-w-0 gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <small>
        {diff.removed.length} removed · {diff.added.length} added · line {diff.start + 1}
      </small>
      <div
        role="region"
        aria-label="Diff"
        tabIndex={0}
        className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-xs"
      >
        {diff.context.map((line, i) => (
          <div className="whitespace-pre" key={'c' + i}>
            {' '}
            {line}
          </div>
        ))}
        {diff.removed.map((line, i) => (
          <div className="whitespace-pre bg-destructive/10 text-destructive" key={'r' + i}>
            - {line}
          </div>
        ))}
        {diff.added.map((line, i) => (
          <div className="whitespace-pre bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" key={'a' + i}>
            + {line}
          </div>
        ))}
        {diff.tail.map((line, i) => (
          <div className="whitespace-pre" key={'t' + i}>
            {' '}
            {line}
          </div>
        ))}
      </div>
    </section>
  );
}
