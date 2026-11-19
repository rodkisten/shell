export type WasmFlowNode = { id: string; kind: string; start: number; end: number };
export type WasmFlowEdge = { from: string; to: string; kind: string };
export type WasmFlowResult = { nodes: WasmFlowNode[]; edges: WasmFlowEdge[]; warnings: string[] };
type WasmResponse = WasmFlowResult | { error: string };
declare global {
  interface Window {
    Go?: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
    shellFlowAnalyze?: (source: string) => string;
  }
}
let loading: Promise<void> | undefined;
function loadRuntime(): Promise<void> {
  return loading ??= (async () => {
    if (!window.Go) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/wasm/wasm_exec.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load Go WASM runtime'));
        document.head.append(script);
      });
    }
    if (!window.Go) throw new Error('Go WASM runtime unavailable');
    const go = new window.Go();
    const response = await fetch('/wasm/shell-flow.wasm');
    if (!response.ok) throw new Error('Shell flow WASM not built');
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    void go.run(instance);
    if (!window.shellFlowAnalyze) throw new Error('Shell flow WASM did not register its API');
  })().catch(error => { loading = undefined; throw error; });
}
export async function analyzeShellWasm(source: string): Promise<WasmFlowResult> {
  await loadRuntime();
  const raw = window.shellFlowAnalyze?.(source);
  if (!raw) throw new Error('WASM analyzer unavailable');
  const result = JSON.parse(raw) as WasmResponse;
  if ('error' in result) throw new Error(result.error);
  return result;
}
