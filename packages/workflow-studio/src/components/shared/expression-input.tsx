import { CodeEditor } from './code-editor';
export function ExpressionInput({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  label = 'Expression',
  placeholder = '',
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}) {
  return (
    <CodeEditor
      expression
      value={value}
      onChange={onChange}
      suggestions={suggestions}
      disabled={disabled}
      ariaLabel={label}
      placeholder={placeholder}
    />
  );
}
