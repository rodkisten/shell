import { InspectorFields } from './inspector-fields';
import { Button } from '../components/ui/button';
import { StructuredEditor } from './structured-editor';
import { useState } from 'react';
import type { BuilderEdit } from './builder-form';
const presets = {
  push: { push: { branches: ['main'], paths: ['src/**'] } },
  pull_request: {
    pull_request: {
      branches: ['main'],
      types: ['opened', 'synchronize', 'reopened'],
    },
  },
  schedule: { schedule: [{ cron: '0 8 * * *' }] },
  workflow_dispatch: {
    workflow_dispatch: {
      inputs: {
        environment: {
          type: 'choice',
          options: ['staging', 'production'],
          required: true,
        },
      },
    },
  },
  workflow_call: {
    workflow_call: {
      inputs: { environment: { type: 'string', required: true } },
    },
  },
};
const fields = [
  ['name', '"Build"'],
  ['run-name', '"Build workflow"'],
  ['on', '{"push":{"branches":["main"]}}'],
  ['permissions', '{"contents":"read"}'],
  ['concurrency', '{"group":"build","cancel-in-progress":true}'],
  ['env', '{"CI":"true"}'],
  ['defaults', '{"run":{"shell":"bash"}}'],
];
export function WorkflowInspector({
  disabled,
  onEdit,
}: {
  disabled: boolean;
  onEdit: (edit: BuilderEdit) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  return (
    <section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const jobFields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
            if (!Object.keys(jobFields).length) throw Error('Choose at least one field');
            for (const value of Object.values(jobFields)) JSON.parse(value);
            setError('');
            onEdit({ kind: 'configure-workflow', job: '', jobFields });
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <fieldset disabled={disabled}>
          <p>Trigger presets replace the draft trigger value. Review before applying.</p>
          <label>
            Trigger preset
            <select
              value=""
              onChange={(e) => {
                const key = e.target.value as keyof typeof presets;
                if (presets[key])
                  setValues((v) => ({
                    ...v,
                    on: JSON.stringify(presets[key], null, 2),
                  }));
              }}
            >
              <option value="">Choose preset</option>
              {Object.keys(presets).map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </label>
          <InspectorFields
            values={values}
            groups={[
              { title: 'General', keys: ['name', 'run-name'] },
              { title: 'Triggers', keys: ['on'] },
              { title: 'Execution', keys: ['concurrency', 'defaults'] },
              {
                title: 'Permissions & environment',
                keys: ['permissions', 'env'],
              },
            ]}
            render={(key) => {
              const example = fields.find((f) => f[0] === key)?.[1];
              return (
                <label key={key}>
                  {key}
                  <StructuredEditor
                    disabled={disabled}
                    placeholder={example}
                    value={values[key] ?? ''}
                    onChange={(value) => setValues((v) => ({ ...v, [key]: value }))}
                  />
                </label>
              );
            }}
          />
          <div className="orb-form-actions">
            <Button type="submit" disabled={!Object.values(values).some((v) => v.trim())}>
              Review workflow patch
            </Button>
            <Button
              type="button"
              onClick={() => {
                setValues({});
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
