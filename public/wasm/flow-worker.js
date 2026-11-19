/* Classic worker: Go's wasm_exec.js uses importScripts and a worker-global Go. */
let ready;
async function initialize() {
  if (ready) return ready;
  ready = (async () => {
    importScripts('/wasm/wasm_exec.js');
    const go = new self.Go();
    const response = await fetch('/wasm/shell-flow.wasm');
    if (!response.ok) throw new Error('Shell Flow WASM indisponível (HTTP ' + response.status + ')');
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    void go.run(instance).catch(error => {
      self.postMessage({ type: 'status', state: 'error', message: String(error) });
    });
    for (let i = 0; i < 100 && typeof self.shellFlowAnalyze !== 'function'; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (typeof self.shellFlowAnalyze !== 'function') throw new Error('Go WASM não registrou a API');
    self.postMessage({ type: 'status', state: 'ready' });
  })().catch(error => {
    ready = undefined;
    self.postMessage({ type: 'status', state: 'error', message: String(error) });
    throw error;
  });
  return ready;
}
self.onmessage = async event => {
  const { id, type, source } = event.data ?? {};
  if (type !== 'analyze' && type !== 'init') return;
  try {
    await initialize();
    if (type === 'analyze') {
      const parsed = JSON.parse(self.shellFlowAnalyze(source));
      if (parsed.error) throw new Error(parsed.error);
      self.postMessage({ id, type: 'result', result: parsed });
    }
  } catch (error) {
    if (type === 'analyze') self.postMessage({ id, type: 'error', message: String(error) });
  }
};
