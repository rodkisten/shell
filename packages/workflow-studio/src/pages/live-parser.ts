import { parseWorkflow } from '@code/workflow-core';
import { useEffect, useState } from 'react';
export type ParserDiagnostic = {
  severity: 'error' | 'warning';
  message: string;
  offset: number | null;
};
type Snapshot = {
  source: string;
  body: string;
  diagnostics: ParserDiagnostic[];
  status: 'idle' | 'waiting' | 'parsing' | 'ready' | 'error';
  error?: string;
};
const empty: Snapshot = {
  source: '',
  body: '',
  diagnostics: [],
  status: 'idle',
};
function readDiagnostics(data: unknown): ParserDiagnostic[] {
  if (!data || typeof data !== 'object' || !('diagnostics' in data) || !Array.isArray(data.diagnostics)) return [];
  return data.diagnostics.filter(
    (d): d is ParserDiagnostic =>
      d &&
      typeof d.message === 'string' &&
      (d.severity === 'error' || d.severity === 'warning') &&
      (d.offset === null || Number.isInteger(d.offset)),
  );
}
export function useLiveParser(source: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  useEffect(() => {
    if (!enabled || !source.trim()) {
      setSnapshot(empty);
      return;
    }
    if (source.length > 262144) {
      setSnapshot({
        ...empty,
        status: 'error',
        error: 'Source exceeds parser limit',
      });
      return;
    }
    const controller = new AbortController();
    setSnapshot((old) => ({ ...old, status: 'waiting', error: undefined }));
    const timer = setTimeout(async () => {
      setSnapshot((old) => ({ ...old, status: 'parsing' }));
      try {
        const data = parseWorkflow(source);
        if (!controller.signal.aborted)
          setSnapshot({
            source,
            body: JSON.stringify(data),
            diagnostics: readDiagnostics(data),
            status: 'ready',
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setSnapshot((old) => ({
            ...old,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          }));
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, enabled]);
  return snapshot;
}
