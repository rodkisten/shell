import type { ComponentProps } from 'react';
import { CodeEditor } from '../components/shared/code-editor';
export function StructuredEditor(props: ComponentProps<typeof CodeEditor>) {
  return (
    <CodeEditor
      {...props}
      ariaLabel={props.script ? 'Shell script' : props.expression ? 'GitHub expression' : 'Structured value'}
      completionDescription="Workflow context reference"
    />
  );
}
