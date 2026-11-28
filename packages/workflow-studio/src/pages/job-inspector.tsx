import { InspectorFields } from './inspector-fields';
import { ConditionField, EnvField, useReferences } from './expression-fields';
import { useRouteState, useStudioRuntime } from '../runtime';
import { Button } from '../components/ui/button';
import { StructuredEditor } from './structured-editor';
import { useState } from 'react';
import type { BuilderEdit } from './builder-form';
const fields = [
  { key: 'name', example: '"Build"' },
  { key: 'runs-on', example: '["self-hosted","linux"]' },
  { key: 'strategy', example: '{"matrix":{"node":[20,22]},"fail-fast":false}' },
  { key: 'permissions', example: '{"contents":"read"}' },
  {
    key: 'concurrency',
    example: '{"group":"build","cancel-in-progress":true}',
  },
  { key: 'outputs', example: '{"result":"${{ steps.build.outputs.result }}"}' },
  { key: 'if', example: '"success()"' },
  { key: 'timeout-minutes', example: '30' },
  { key: 'env', example: '{"CI":"true"}' },
  { key: 'uses', example: '"owner/repo/.github/workflows/build.yml@main"' },
  { key: 'with', example: '{"environment":"production"}' },
  { key: 'secrets', example: '"inherit"' },
];
export function JobInspector({
  body,
  disabled,
  onEdit,
}: {
  body: string;
  disabled: boolean;
  onEdit: (edit: BuilderEdit) => void;
}) {
  const { updateRoute } = useStudioRuntime();
  const route = useRouteState();
  const job = route.job ?? '';
  const [values, setValues] = useState<Record<string, string>>({}),
    [error, setError] = useState('');
  let jobs: { id: string; uses?: string }[] = [];
  try {
    const parsed = JSON.parse(body);
    jobs = parsed.details ?? parsed.jobs ?? [];
  } catch {
    /* Incomplete source has no inspector data; the parser displays diagnostics. */
  }
  const current = jobs.find((j) => j.id === job) ?? jobs[0];
  const refs = useReferences(body, current?.id ?? '');
  const [env, setEnv] = useState('');
  const groups = [
    {
      title: 'General',
      keys: current?.uses ? ['name', 'uses'] : ['name', 'runs-on', 'timeout-minutes'],
    },
    { title: 'Conditions & concurrency', keys: ['if', 'concurrency'] },
    {
      title: 'Inputs & environment',
      keys: current?.uses ? ['with', 'secrets'] : ['env', 'strategy', 'outputs'],
    },
    { title: 'Permissions', keys: ['permissions'] },
  ];
  return (
    <section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!current) return;
          try {
            const jobFields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
            for (const raw of Object.values(jobFields)) JSON.parse(raw);
            if (!Object.keys(jobFields).length) throw Error('Choose at least one field');
            setError('');
            onEdit({ kind: 'configure-job', job: current.id, jobFields });
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <fieldset disabled={disabled || !current}>
          <label>
            Job
            <select
              value={current?.id ?? ''}
              onChange={(e) => {
                updateRoute({ job: e.target.value, step: '0' });
                setValues({});
                setEnv('');
                setError('');
              }}
            >
              {jobs.map((j) => (
                <option key={j.id}>{j.id}</option>
              ))}
            </select>
          </label>
          <p>Enter JSON values for fields to change. Leave other fields empty.</p>
          <InspectorFields
            groups={groups}
            values={values}
            render={(key) => {
              const f = fields.find((field) => field.key === key)!;
              return (
                <div className="orb-field" key={f.key}>
                  <span className="orb-field-label">{f.key}</span>
                  {f.key === 'if' ? (
                    <ConditionField
                      refs={refs}
                      value={values.if ? JSON.parse(values.if) : ''}
                      onChange={(v) =>
                        setValues((old) => ({
                          ...old,
                          if: v ? JSON.stringify(v) : '',
                        }))
                      }
                    />
                  ) : f.key === 'env' ? (
                    <EnvField
                      refs={refs}
                      value={env}
                      onChange={(v) => {
                        setEnv(v);
                        setValues((old) => ({
                          ...old,
                          env: v
                            ? JSON.stringify(
                                Object.fromEntries(
                                  v
                                    .split('\n')
                                    .filter((row) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(row))
                                    .map((row) => [
                                      row.slice(0, row.indexOf('=')),
                                      row.slice(row.indexOf('=') + 1),
                                    ]),
                                ),
                              )
                            : '',
                        }));
                      }}
                    />
                  ) : (
                    <StructuredEditor
                      disabled={disabled || !current}
                      placeholder={f.example}
                      value={values[f.key] ?? ''}
                      onChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))}
                    />
                  )}
                </div>
              );
            }}
          />
          <div className="orb-form-actions">
            <Button type="submit" disabled={!Object.values(values).some((v) => v.trim())}>
              Review job patch
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setValues({});
                setEnv('');
                setError('');
              }}
            >
              Clear
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </fieldset>
      </form>
    </section>
  );
}
