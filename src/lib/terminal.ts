type Result = { ok: boolean; stdout: string; stderr: string; exitCode: number };
export type ShellCompletionContext = {
  npmScripts: string[];
  npmWorkspaces: string[];
  gitBranches: string[];
};
const EMPTY_COMPLETION_CONTEXT: ShellCompletionContext = { npmScripts: [], npmWorkspaces: [], gitBranches: [] };
type Waiter = { resolve: (value: Result) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };
let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Waiter>();

function stop(reason = 'Execução cancelada') {
  worker?.terminate();
  worker = null;
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timeout);
    waiter.reject(new Error(reason));
  }
  pending.clear();
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../worker/sandbox.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<Result & { id: number }>) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      clearTimeout(task.timeout);
      pending.delete(event.data.id);
      task.resolve(event.data);
    });
    worker.addEventListener('error', () => stop('O terminal Zsh WASM encontrou um erro e foi reiniciado.'));
  }
  return worker;
}

function ask(action: 'execute' | 'reset' | 'completion-context', script?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => stop('Limite de 30 segundos atingido. O sandbox foi reiniciado.'), 30_000);
    pending.set(id, { resolve, reject, timeout });
    try {
      getWorker().postMessage({ id, action, script });
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

let completionContextCache: { expires: number; promise: Promise<ShellCompletionContext> } | null = null;

function invalidateCompletionContext() {
  completionContextCache = null;
}

export async function readCompletionContext(): Promise<ShellCompletionContext> {
  if (completionContextCache && completionContextCache.expires > Date.now())
    return completionContextCache.promise;
  // Do not start filesystem inspection while a foreground terminal request is
  // active. Autocomplete is optional; command execution is not.
  if (pending.size > 0) return EMPTY_COMPLETION_CONTEXT;

  const promise = ask('completion-context')
    .then(result => {
      if (!result.ok || !result.stdout) return EMPTY_COMPLETION_CONTEXT;
      try {
        const parsed = JSON.parse(result.stdout) as Partial<ShellCompletionContext>;
        return {
          npmScripts: Array.isArray(parsed.npmScripts) ? parsed.npmScripts.filter((v): v is string => typeof v === 'string') : [],
          npmWorkspaces: Array.isArray(parsed.npmWorkspaces) ? parsed.npmWorkspaces.filter((v): v is string => typeof v === 'string') : [],
          gitBranches: Array.isArray(parsed.gitBranches) ? parsed.gitBranches.filter((v): v is string => typeof v === 'string') : [],
        };
      } catch {
        return EMPTY_COMPLETION_CONTEXT;
      }
    })
    .catch(() => EMPTY_COMPLETION_CONTEXT);
  completionContextCache = { expires: Date.now() + 5_000, promise };
  return promise;
}

export const executeScript = async (script: string) => {
  const result = await ask('execute', script);
  invalidateCompletionContext();
  return result;
};
export async function resetShell() {
  stop('Ambiente reiniciado.');
  invalidateCompletionContext();
  return { ok: true, stdout: 'Processo reiniciado. Arquivos persistidos foram preservados.\n', stderr: '', exitCode: 0 };
}
export const cancelShell = () => stop('Execução interrompida.');
