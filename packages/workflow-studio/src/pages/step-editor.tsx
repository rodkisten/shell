import { parseDocument } from 'yaml';
import { ActionInspector } from './action-inspector';
import { ConditionField, EnvField, useReferences } from './expression-fields';
import { StructuredEditor } from './structured-editor';
import { useRouteState, useStudioRuntime } from '../runtime';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useState } from 'react';
import type { BuilderEdit } from './builder-form';
type Job = {
  id: string;
  steps: {
    index: number;
    name: string | null;
    uses: string | null;
    kind: string;
    run?: string | null;
    shell?: string | null;
  }[];
};
export function StepEditor({
  body,
  source,
  onFields,
  disabled,
  onEdit,
}: {
  body: string;
  source: string;
  onFields: (path: (string | number)[], fields: Record<string, unknown>) => void;
  disabled: boolean;
  onEdit: (edit: BuilderEdit) => void;
}) {
  const { updateRoute } = useStudioRuntime();
  const route = useRouteState();
  const job = route.job ?? '';
  const index = Number(route.step ?? 0);
  const [condition, setCondition] = useState(''),
    [timeout, setTimeoutValue] = useState(''),
    [allow, setAllow] = useState(false),
    [env, setEnv] = useState('');
  const [error, setError] = useState('');
  let jobs: Job[] = [];
  try {
    jobs = JSON.parse(body).details ?? [];
  } catch {
    /* Incomplete source has no inspector data; the parser displays diagnostics. */
  }
  const current = jobs.find((j) => j.id === job) ?? jobs[0];
  const step = current?.steps.find((s) => s.index === index) ?? current?.steps[0];
  const refs = useReferences(body, current?.id ?? '', step?.index);
  const changed = Boolean(condition || timeout || allow || env);
  function submit(kind: BuilderEdit['kind'], direction?: number) {
    if (!current || !step) return;
    setError('');
    try {
      if (
        kind === 'configure-step' &&
        timeout &&
        (!Number.isInteger(Number(timeout)) || Number(timeout) < 1 || Number(timeout) > 360)
      )
        throw Error('Timeout must be an integer from 1 to 360');
      const vars: Record<string, string> = Object.create(null);
      for (const line of (kind === 'configure-step' ? env : '').split('\n').filter(Boolean)) {
        const at = line.indexOf('=');
        if (at < 1) throw Error('Use KEY=value');
        const key = line.slice(0, at).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw Error('Invalid environment variable: ' + key);
        vars[key] = line.slice(at + 1);
      }
      onEdit({
        kind,
        job: current.id,
        index: step.index,
        direction,
        ...(kind === 'configure-step'
          ? {
              ...(condition ? { condition } : {}),
              ...(timeout ? { timeout: Number(timeout) } : {}),
              ...(allow ? { continueOnError: true } : {}),
              ...(env ? { env: vars } : {}),
            }
          : {}),
      });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <fieldset disabled={disabled || !step}>
      <legend>Step configuration</legend>
      <label>
        Job
        <select
          value={current?.id ?? ''}
          onChange={(e) => {
            updateRoute({ job: e.target.value, step: '0' });
          }}
        >
          {jobs.map((j) => (
            <option key={j.id}>{j.id}</option>
          ))}
        </select>
      </label>
      <label>
        Step
        <select value={step?.index ?? 0} onChange={(e) => updateRoute({ step: e.target.value })}>
          {current?.steps.map((s) => (
            <option key={s.index} value={s.index}>
              {s.index + 1}. {s.name ?? s.uses ?? s.kind}
            </option>
          ))}
        </select>
      </label>
      {current && step && typeof step.run === 'string' && (
        <ScriptPanel
          key={JSON.stringify([current.id, step.index, step.run])}
          value={step.run}
          shell={step.shell ?? 'default shell'}
          disabled={disabled}
          onSave={(run) => onFields(['jobs', current.id, 'steps', step.index], { run })}
        />
      )}
      <details className="orb-step-actions">
        <summary>Step actions</summary>
        <div className="orb-form-actions">
          <Button type="button" disabled={!step || step.index === 0} onClick={() => submit('move-step', -1)}>
            Move up
          </Button>
          <Button
            type="button"
            disabled={!step || step.index === (current?.steps.length ?? 0) - 1}
            onClick={() => submit('move-step', 1)}
          >
            Move down
          </Button>
          <Button type="button" disabled={(current?.steps.length ?? 0) < 2} onClick={() => submit('remove-step')}>
            Review removal
          </Button>
        </div>
      </details>
      {step?.uses && (
        <ExistingAction
          key={JSON.stringify([current?.id, step.index, source])}
          uses={step.uses}
          source={source}
          job={current?.id ?? ''}
          index={step.index}
          onFields={onFields}
        />
      )}
      <details className="orb-step-advanced">
        <summary>Advanced configuration {changed && <small>· Pending edits</small>}</summary>
        <ConditionField value={condition} onChange={setCondition} refs={refs} />
        <label>
          Timeout minutes
          <Input
            type="number"
            min="1"
            max="360"
            value={timeout}
            onChange={(e) => setTimeoutValue(e.target.value)}
          />
        </label>
        <label>
          <Input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Continue on error
        </label>
        <EnvField value={env} onChange={setEnv} refs={refs} />
      </details>
      <div className="orb-form-actions">
        <Button
          type="button"
          variant="ghost"
          disabled={!changed}
          onClick={() => {
            setCondition('');
            setTimeoutValue('');
            setAllow(false);
            setEnv('');
            setError('');
          }}
        >
          Clear
        </Button>
        <Button type="button" disabled={!changed} onClick={() => submit('configure-step')}>
          Review configuration
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

function ScriptPanel({
  value,
  shell,
  disabled,
  onSave,
}: {
  value: string;
  shell: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <section className={'orb-script-panel' + (expanded ? ' orb-script-expanded' : '')}>
      <div className="orb-script-toolbar">
        <h3>Script · {shell}</h3>
        <Button type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>
      <small>
        {draft.split('\n').length} lines · {draft === value ? 'Unchanged' : 'Unsaved changes'}
      </small>
      <StructuredEditor script value={draft} onChange={setDraft} disabled={disabled} />
      <div className="orb-script-toolbar">
        <Button type="button" disabled={disabled || draft === value} onClick={() => setDraft(value)}>
          Reset
        </Button>
        <Button
          type="button"
          onClick={() => {
            setCopyError(false);
            void navigator.clipboard.writeText(draft).catch(() => setCopyError(true));
          }}
        >
          Copy
        </Button>
        <Button type="button" disabled={disabled || draft === value} onClick={() => onSave(draft)}>
          Review script patch
        </Button>
      </div>
      {copyError && <p role="alert">Clipboard unavailable</p>}
    </section>
  );
}

function ExistingAction({
  uses,
  source,
  job,
  index,
  onFields,
}: {
  uses: string;
  source: string;
  job: string;
  index: number;
  onFields: (path: (string | number)[], fields: Record<string, unknown>) => void;
}) {
  const [draftUses, setUses] = useState(uses);
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const fields = parseDocument(source).toJS()?.jobs?.[job]?.steps?.[index]?.with as
      Record<string, unknown> | undefined;
    return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, String(v ?? '')]));
  });
  return (
    <details open>
      <summary>Action inputs and outputs</summary>
      <ActionInspector
        uses={draftUses}
        onUses={setUses}
        inputs={inputs}
        onInputs={(next) =>
          setInputs((old) => ({ ...Object.fromEntries(Object.keys(old).map((k) => [k, ''])), ...next }))
        }
      />
      <Button
        type="button"
        onClick={() =>
          onFields(['jobs', job, 'steps', index], {
            uses: draftUses,
            ...(Object.keys(inputs).length ? { with: inputs } : {}),
          })
        }
      >
        Review action patch
      </Button>
    </details>
  );
}
