import React, { useEffect, useState } from 'react';
import { highlightFlowSource } from './lib/flow-highlight';

type Diagnostic = { id: string; type: string; message: string; detail: string; timestamp: string; url: string };
type DiagnosticsAPI = { events: Diagnostic[]; capture: (type: string, message: string, detail?: string) => void; subscribe: (listener: (entry: Diagnostic) => void) => () => void; clear: () => void };
declare global { interface Window { __shellDiagnostics?: DiagnosticsAPI } }

export class ShellErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    window.__shellDiagnostics?.capture('react', error.message, [error.stack, info.componentStack].filter(Boolean).join('\n'));
  }
  render() {
    if (this.state.error) return <div role="alert" style={{ padding: 24, color: '#fca5a5' }}>
      <strong>Falha na interface React</strong><p>{this.state.error.message}</p>
      <button type="button" onClick={() => location.reload()}>Recarregar</button>
      <DiagnosticsPanel />
    </div>;
    return this.props.children;
  }
}

export function DiagnosticsPanel() {
  const [entries, setEntries] = useState<Diagnostic[]>(() => [...(window.__shellDiagnostics?.events ?? [])]);
  const [open, setOpen] = useState(false);
  useEffect(() => window.__shellDiagnostics?.subscribe(() => setEntries([...(window.__shellDiagnostics?.events ?? [])])), []);
  return <aside className="shell-diagnostics" aria-label="Diagnósticos do navegador">
    <button type="button" className="shell-diagnostics-toggle" onClick={() => setOpen(value => !value)}>
      Diagnósticos {entries.length ? '(' + entries.length + ')' : ''} {open ? '−' : '+'}
    </button>
    {open && <section className="shell-diagnostics-content">
      <header><strong>Eventos capturados</strong><button type="button" onClick={() => window.__shellDiagnostics?.clear()}>Limpar</button></header>
      {entries.length === 0 ? <p>Nenhum erro capturado nesta sessão.</p> : entries.slice().reverse().map(entry =>
        <article key={entry.id}>
          <small>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.type}</small>
          <strong>{entry.message}</strong>
          {entry.detail && <pre><code dangerouslySetInnerHTML={{ __html: highlightFlowSource(entry.detail) }} /></pre>}
        </article>)}
    </section>}
  </aside>;
}
