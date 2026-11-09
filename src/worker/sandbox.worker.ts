import { initBashkit, Bash } from '@everruns/bashkit-wasm';
type Request = { id: number; action: 'execute' | 'reset'; script?: string };
let init: Promise<void> | undefined;
let bash: Bash | undefined;
async function shell() {
  if (!init) init = initBashkit().then(() => undefined);
  await init;
  if (!bash) bash = new Bash({ maxCommands: 350, maxLoopIterations: 1200, timeoutMs: 6000 });
  return bash;
}
self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, action, script } = event.data;
  try {
    if (action === 'reset') { bash = undefined; self.postMessage({ id, ok: true, stdout: 'Ambiente reiniciado.\n', stderr: '', exitCode: 0 }); return; }
    if (!script || script.length > 50_000) throw new Error('Script vazio ou muito grande (limite: 50 KB).');
    const instance = await shell();
    const response = instance.executeSync(script);
    self.postMessage({ id, ok: true, stdout: response.stdout, stderr: response.stderr, exitCode: response.exitCode });
  } catch (error) {
    self.postMessage({ id, ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1 });
  }
};
