// Published source carries CSS types for consumers that do not enable vite/client.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./style-types.d.ts" />
import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiWorkbench } from './pages/api-workbench';
import { StudioProvider, type StudioAdapter } from './runtime';
import styles from './styles.css?inline';
import flowStyles from '@xyflow/react/dist/style.css?inline';
export type { StudioAdapter, StudioRequest, RouteState } from './runtime';
export { WorkflowGraph } from './pages/workflow-graph';
export { SourceEditor } from './pages/source-editor';
export { kitchenSinkWorkflow } from './pages/workflow-example';
export default function WorkflowStudio({
  adapter,
  file,
}: {
  adapter: StudioAdapter;
  file?: { repo: string; ref?: string; path: string };
}) {
  const host = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [aborted, setAborted] = useState(adapter.signal.aborted);
  useLayoutEffect(() => {
    const element = host.current!;
    const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    const content = document.createElement('div');
    root.append(content);
    setMount(content);
    return () => content.remove();
  }, []);
  useEffect(() => {
    setAborted(adapter.signal.aborted);
    const abort = () => setAborted(true);
    adapter.signal.addEventListener('abort', abort, { once: true });
    return () => adapter.signal.removeEventListener('abort', abort);
  }, [adapter.signal]);
  return (
    <div
      ref={host}
      data-rod-module="code"
      style={{
        height: '100%',
        minWidth: 0,
        position: 'relative',
        contain: 'layout style',
        containerType: 'size',
        containerName: 'workflow',
        flex: '1 1 auto',
        overflow: 'auto',
        minHeight: 320,
      }}
    >
      {mount &&
        !aborted &&
        createPortal(
          <>
            <style>
              {styles.replaceAll(':root', ':host') +
                flowStyles +
                '\n:host{display:block} input,textarea,select,.cm-editor .cm-content{font-size:16px!important} .orb-studio{min-width:0;width:100%}'}
            </style>
            <StudioProvider key={adapter.namespace} adapter={adapter}>
              <ApiWorkbench file={file} />
            </StudioProvider>
          </>,
          mount,
        )}
    </div>
  );
}
export { publicGitHubClient } from './public-client';
