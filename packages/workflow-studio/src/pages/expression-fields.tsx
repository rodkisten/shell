import { useStudioRuntime } from '../runtime';
import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ExpressionInput } from '../components/shared/expression-input';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
type Step = {
  index: number;
  id?: string | null;
  uses?: string | null;
  outputHints?: string[];
  env?: string[];
};
type Job = {
  id: string;
  outputs?: string[];
  env?: string[];
  matrix?: string[];
  steps?: Step[];
};
type Model = {
  jobs?: { id: string; needs: string[] }[];
  details?: Job[];
  env?: string[];
  interface?: {
    inputs?: string[];
    dispatchInputs?: string[];
    secrets?: string[];
  };
};
const wrap = (s: string) => '$' + '{{ ' + s + ' }}';
const access = (s: string) =>
  /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? '.' + s : "['" + s.replace(/'/g, "''") + "']";
export function references(body: string, job: string, step?: number, manifests: Record<string, string[]> = {}) {
  let m: Model = {};
  try {
    m = JSON.parse(body);
  } catch {
    /* Incomplete source has no inspector data; the parser displays diagnostics. */
  }
  const result: { group: string; value: string }[] = [];
  const add = (group: string, value: string) => result.push({ group, value });
  const current = m.details?.find((j) => j.id === job);
  for (const id of m.jobs?.find((j) => j.id === job)?.needs ?? []) {
    add('Dependency results', 'needs' + access(id) + '.result');
    for (const out of m.details?.find((j) => j.id === id)?.outputs ?? [])
      add('Job outputs', 'needs' + access(id) + '.outputs' + access(out));
  }
  for (const key of new Set([...(m.interface?.inputs ?? []), ...(m.interface?.dispatchInputs ?? [])]))
    add('Inputs', 'inputs' + access(key));
  for (const key of ['event_name', 'ref', 'ref_name', 'sha', 'actor', 'repository'])
    add('GitHub', 'github.' + key);
  if (step !== undefined) {
    for (const key of current?.matrix ?? []) add('Matrix', 'matrix' + access(key));
    for (const key of new Set([
      ...(m.env ?? []),
      ...(current?.env ?? []),
      ...(current?.steps?.find((s) => s.index === step)?.env ?? []),
    ]))
      add('Environment', 'env' + access(key));
    for (const s of current?.steps ?? [])
      if (s.index < step && s.id) {
        add('Previous steps', 'steps' + access(s.id) + '.outcome');
        for (const out of new Set([...(s.outputHints ?? []), ...(s.uses ? (manifests[s.uses] ?? []) : [])]))
          add('Step outputs', 'steps' + access(s.id) + '.outputs' + access(out));
      }
  }
  return result;
}
type Ref = ReturnType<typeof references>;
export function useReferences(body: string, job: string, step?: number) {
  const { request } = useStudioRuntime();
  let model: Model = {};
  try {
    model = JSON.parse(body);
  } catch {
    /* Incomplete source has no inspector data; the parser displays diagnostics. */
  }
  const actions = Array.from(
    new Set(
      (model.details?.find((j) => j.id === job)?.steps ?? [])
        .filter(
          (s) =>
            step !== undefined &&
            s.index < step &&
            s.id &&
            s.uses &&
            /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[\w./-]+$/.test(s.uses),
        )
        .map((s) => s.uses!),
    ),
  ).slice(0, 30);
  const queries = useQueries({
    queries: actions.map((uses) => ({
      queryKey: ['action-manifest', uses],
      staleTime: 300000,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const response = await request('/v1/actions/resolve?' + new URLSearchParams({ uses }), {
          signal,
          credentials: 'same-origin',
          redirect: 'error',
        });
        if (!response.ok) throw Error('Manifest unavailable');
        return response.json() as Promise<{ outputs: { id: string }[] }>;
      },
    })),
  });
  const manifests = Object.fromEntries(
    actions.map((uses, i) => [uses, queries[i].data?.outputs?.map((p) => p.id) ?? []]),
  );
  return references(body, job, step, manifests);
}

function Picker({ refs, onPick }: { refs: Ref; onPick: (s: string) => void }) {
  return (
    <select
      aria-label="Insert context reference"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">Insert reference…</option>
      {Array.from(new Set(refs.map((r) => r.group))).map((g) => (
        <optgroup key={g} label={g}>
          {refs
            .filter((r) => r.group === g)
            .map((r) => (
              <option key={r.value} value={r.value}>
                {r.value}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
export function ConditionField({
  value,
  onChange,
  refs,
}: {
  value: string;
  onChange: (s: string) => void;
  refs: Ref;
}) {
  const [left, setLeft] = useState(''),
    [op, setOp] = useState('=='),
    [right, setRight] = useState(''),
    [join, setJoin] = useState('&&');
  const term =
    op === 'truthy'
      ? left
      : op === 'contains'
        ? 'contains(' + left + ", '" + right.replace(/'/g, "''") + "')"
        : left + ' ' + op + " '" + right.replace(/'/g, "''") + "'";
  return (
    <section className="orb-expression">
      <strong>Condition · if</strong>
      <Picker refs={refs} onPick={setLeft} />
      <Input
        aria-label="Left expression"
        value={left}
        onChange={(e) => setLeft(e.target.value)}
        placeholder="needs.build.outputs.result"
      />
      <div className="orb-expression-row">
        <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Operator">
          <option>==</option>
          <option>!=</option>
          <option>contains</option>
          <option>truthy</option>
        </select>
        {op !== 'truthy' && (
          <Input
            aria-label="Compare with string"
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder="success"
          />
        )}
      </div>
      <div className="orb-expression-row">
        <select value={join} onChange={(e) => setJoin(e.target.value)} aria-label="Combine">
          <option>&&</option>
          <option>||</option>
        </select>
        <Button
          type="button"
          disabled={!left.trim()}
          onClick={() =>
            onChange(
              wrap(
                value.trim()
                  ? '(' + value.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '') + ') ' + join + ' (' + term + ')'
                  : term,
              ),
            )
          }
        >
          Add condition
        </Button>
      </div>
      <ExpressionInput
        value={value}
        onChange={onChange}
        placeholder="Custom expression"
        suggestions={refs.map((r) => r.value)}
      />
      <div className="orb-expression-row">
        {['success()', 'failure()', 'always()', 'cancelled()'].map((v) => (
          <Button key={v} type="button" onClick={() => setLeft(v)}>
            {v}
          </Button>
        ))}
      </div>
    </section>
  );
}
export function EnvField({ value, onChange, refs }: { value: string; onChange: (s: string) => void; refs: Ref }) {
  const rows = value ? value.split('\n') : [];
  const [key, setKey] = useState(''),
    [val, setVal] = useState('');
  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !val.includes('\n');
  return (
    <section className="orb-expression">
      <strong>Environment · env</strong>
      {rows.map((row, i) => (
        <div className="orb-expression-row" key={i}>
          <Input
            aria-label={'Variable ' + (i + 1)}
            value={row}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? e.target.value : r)).join('\n'))}
          />
          <Button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i).join('\n'))}>
            Remove
          </Button>
        </div>
      ))}
      <Input
        aria-label="Variable name"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="ARTIFACT"
      />
      <ExpressionInput
        suggestions={refs.map((r) => r.value)}
        value={val}
        onChange={setVal}
        placeholder="Literal or expression"
      />
      <Picker refs={refs} onPick={(v) => setVal(wrap(v))} />
      <Button
        type="button"
        disabled={!valid}
        onClick={() => {
          onChange([...rows.filter((r) => r.split('=')[0] !== key), key + '=' + val].join('\n'));
          setKey('');
          setVal('');
        }}
      >
        Add variable
      </Button>
    </section>
  );
}
