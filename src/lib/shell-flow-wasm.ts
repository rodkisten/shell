export type WasmFlowNode = { id: string; kind: string; start: number; end: number };
export type WasmFlowEdge = { from: string; to: string; kind: string };
export type WasmFlowResult = { nodes: WasmFlowNode[]; edges: WasmFlowEdge[]; warnings: string[]; decisions?: Record<string, "true" | "false" | "unknown">; reachable?: Record<string, boolean> };
export type FlowWasmStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; message?: string };
type Pending = { resolve: (value: WasmFlowResult) => void; reject: (error: Error) => void };
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();
let status: FlowWasmStatus = { state: 'idle' };
const listeners = new Set<(status: FlowWasmStatus) => void>();
function publish(next: FlowWasmStatus) {
  status = next;
  for (const listener of listeners) listener(status);
}
export function getShellFlowStatus(): FlowWasmStatus { return status; }
export function subscribeShellFlowStatus(listener: (status: FlowWasmStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => { listeners.delete(listener); };
}
function fail(error: Error) {
  publish({ state: 'error', message: error.message });
  for (const item of pending.values()) item.reject(error);
  pending.clear();
  worker?.terminate();
  worker = undefined;
}
function getWorker(): Worker {
  if (worker) return worker;
  publish({ state: 'loading' });
  try {
    const created = new Worker('/wasm/flow-worker.js');
    created.onmessage = (event: MessageEvent) => {
      const message = event.data as { type: string; id?: number; state?: FlowWasmStatus['state']; message?: string; result?: WasmFlowResult };
      if (message.type === 'status') {
        if (message.state === 'error') fail(new Error(message.message ?? 'Falha ao iniciar Go WASM'));
        else if (message.state === 'ready') publish({ state: 'ready' });
        return;
      }
      if (message.id === undefined) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.type === 'result' && message.result) request.resolve(message.result);
      else request.reject(new Error(message.message ?? 'Falha na análise WASM'));
    };
    created.onerror = () => fail(new Error('Falha no Web Worker do Shell Flow'));
    worker = created;
    created.postMessage({ type: 'init' });
    return created;
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
export function initializeShellFlowWasm(): void { getWorker(); }
export function analyzeShellWasm(source: string, variables: Record<string, string | readonly string[]> = {}): Promise<WasmFlowResult> {
  const current = getWorker();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    current.postMessage({ type: 'analyze', id, source, variables });
  });
}
