import { useId } from 'react';
import { Input } from '../ui/input';

export type SchemaField = {
  id: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'choice' | 'environment';
  required?: boolean;
  defaultValue?: string;
  options?: readonly string[];
};
export function SchemaForm({
  fields,
  values,
  onChange,
  disabled = false,
  errors = {},
}: {
  fields: readonly SchemaField[];
  values: Readonly<Record<string, string>>;
  onChange: (id: string, value: string) => void;
  disabled?: boolean;
  errors?: Readonly<Record<string, string>>;
}) {
  const prefix = useId();
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      {fields.map((field, index) => {
        const id = prefix + '-' + index;
        const value = values[field.id] ?? field.defaultValue ?? '';
        const options = field.type === 'boolean' ? ['true', 'false'] : field.options;
        const error = errors[field.id];
        return (
          <div key={index} className="grid min-w-0 gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            {field.description && (
              <p id={id + '-description'} className="text-xs text-muted-foreground">
                {field.description}
              </p>
            )}
            {options ? (
              <select
                id={id}
                value={value}
                required={field.required}
                aria-invalid={!!error}
                aria-describedby={
                  [field.description ? id + '-description' : '', error ? id + '-error' : '']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onChange={(e) => onChange(field.id, e.target.value)}
                className="min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base"
              >
                <option value="">Select</option>
                {options.map((option, i) => (
                  <option key={i} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                type={field.type === 'number' ? 'number' : 'text'}
                step={field.type === 'number' ? 'any' : undefined}
                required={field.required}
                value={value}
                aria-invalid={!!error}
                aria-describedby={
                  [field.description ? id + '-description' : '', error ? id + '-error' : '']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onChange={(e) => onChange(field.id, e.target.value)}
                autoCapitalize="none"
                className="text-base"
              />
            )}
            {error && (
              <p id={id + '-error'} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
