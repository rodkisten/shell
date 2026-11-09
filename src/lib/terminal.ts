type Result = { ok: boolean; stdout: string; stderr: string; exitCode: number };
type Waiter = { resolve: (value: Result) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };
let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Waiter>();
function stop(reason = 'Execução cancelada') {
  worker?.terminate(); worker = null;
  for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error(reason)); }
  pending.clear();
}
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../worker/sandbox.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<Result & { id: number }>) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      clearTimeout(task.timeout); pending.delete(event.data.id); task.resolve(event.data);
    });
    worker.addEventListener('error', () => stop('O terminal WASM encontrou um erro e foi reiniciado.'));
  }
  return worker;
}
function ask(action: 'execute' | 'reset', script?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => stop('Limite de 9 segundos atingido. O sandbox foi reiniciado.'), 9000);
    pending.set(id, { resolve, reject, timeout });
    getWorker().postMessage({ id, action, script });
  });
}
export const executeScript = (script: string) => ask('execute', script);
export async function resetShell() { stop(); return ask('reset'); }
export const cancelShell = () => stop('Execução interrompida.');
