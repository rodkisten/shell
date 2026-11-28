import { SchemaForm } from '../components/shared/schema-form';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Play, Plus, Trash2 } from 'lucide-react';
import type { BuilderEdit } from './builder-form';
type Kind = 'string' | 'boolean' | 'number' | 'choice' | 'environment';
type Field = {
  id: string;
  type: Kind;
  description: string;
  required: boolean;
  defaultValue: string;
  options: string;
};
export function DispatchEditor({
  body,
  disabled,
  onEdit,
}: {
  body: string;
  disabled: boolean;
  onEdit: (e: BuilderEdit) => void;
}) {
  const [fields, setFields] = useState<Field[]>(() => {
    try {
      return Object.entries(JSON.parse(body).dispatchSchema ?? {}).map(([id, raw]) => {
        const v = raw as {
          type?: Kind;
          description?: string;
          required?: boolean;
          default?: unknown;
          options?: string[];
        };
        return {
          id,
          type: v.type ?? 'string',
          description: v.description ?? '',
          required: !!v.required,
          defaultValue: String(v.default ?? ''),
          options: (v.options ?? []).join('\n'),
        };
      });
    } catch {
      return [];
    }
  });
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Record<string, string>>({});
  function update(i: number, patch: Partial<Field>) {
    setFields((f) => f.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  }
  function review() {
    try {
      const inputs: Record<string, unknown> = Object.create(null);
      for (const f of fields) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(f.id) || Object.hasOwn(inputs, f.id))
          throw Error('Invalid or duplicate input: ' + f.id);
        const options = f.options
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (f.type === 'choice' && (!options.length || new Set(options).size !== options.length))
          throw Error('Provide unique choices');
        if (f.type === 'choice' && f.defaultValue && !options.includes(f.defaultValue))
          throw Error('Default must match a choice');
        if (f.type === 'number' && f.defaultValue && !Number.isFinite(Number(f.defaultValue)))
          throw Error('Invalid numeric default');
        inputs[f.id] = {
          type: f.type,
          description: f.description,
          required: f.required,
          ...(f.type === 'choice' ? { options } : {}),
          ...(f.defaultValue !== ''
            ? {
                default:
                  f.type === 'boolean'
                    ? f.defaultValue === 'true'
                    : f.type === 'number'
                      ? Number(f.defaultValue)
                      : f.defaultValue,
              }
            : {}),
        };
      }
      setError('');
      onEdit({
        kind: 'configure-workflow',
        job: '',
        jobFields: { on: JSON.stringify({ workflow_dispatch: { inputs } }) },
      });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="orb-expression">
      <h3>
        <Play size={16} /> Manual trigger
      </h3>
      <p>Define inputs and preview the run form.</p>
      <fieldset disabled={disabled}>
        {fields.map((f, i) => (
          <section key={i} className="rounded-lg border border-border p-3">
            <div className="orb-expression-row">
              <Input aria-label="Input ID" value={f.id} onChange={(e) => update(i, { id: e.target.value })} />
              <Button type="button" onClick={() => setFields((v) => v.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </Button>
            </div>
            <select
              aria-label="Input type"
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as Kind, defaultValue: '' })}
            >
              {['string', 'boolean', 'number', 'choice', 'environment'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <Input
              placeholder="Description"
              value={f.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <label>
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />{' '}
              Required
            </label>
            {f.type === 'choice' && (
              <textarea
                aria-label="Choices, one per line"
                value={f.options}
                onChange={(e) => update(i, { options: e.target.value })}
              />
            )}{' '}
            {f.type === 'boolean' ? (
              <select
                aria-label="Default"
                value={f.defaultValue}
                onChange={(e) => update(i, { defaultValue: e.target.value })}
              >
                <option value="">No default</option>
                <option>true</option>
                <option>false</option>
              </select>
            ) : (
              <Input
                placeholder="Default"
                value={f.defaultValue}
                onChange={(e) => update(i, { defaultValue: e.target.value })}
              />
            )}
          </section>
        ))}
        <Button
          type="button"
          disabled={fields.length >= 25}
          onClick={() =>
            setFields((v) => [
              ...v,
              {
                id: 'input_' + (v.length + 1),
                type: 'string',
                description: '',
                required: false,
                defaultValue: '',
                options: '',
              },
            ])
          }
        >
          <Plus size={14} /> Add input
        </Button>
        <Button type="button" onClick={review}>
          Review trigger patch
        </Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <section className="rounded-lg border border-border p-3">
        <h4>Run form preview</h4>
        <SchemaForm
          fields={fields.map((f) => ({
            id: f.id,
            label: f.id,
            description: f.description,
            type: f.type,
            required: f.required,
            defaultValue: f.defaultValue,
            options:
              f.type === 'choice'
                ? f.options
                    .split('\n')
                    .map((v) => v.trim())
                    .filter(Boolean)
                : undefined,
          }))}
          values={preview}
          onChange={(id, value) => setPreview((old) => ({ ...old, [id]: value }))}
        />
        <p>Preview only · no workflow is executed.</p>
      </section>
    </section>
  );
}
