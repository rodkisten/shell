import { runZshScript } from 'zsh-wasm';

type Request = { id: number; action: 'execute' | 'reset'; script?: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, action, script } = event.data;
  try {
    if (action === 'reset') {
      self.postMessage({ id, ok: true, stdout: 'Ambiente reiniciado.\n', stderr: '', exitCode: 0 });
      return;
    }
    if (!script?.trim() || script.length > 50_000) {
      throw new Error('Script vazio ou muito grande (limite: 50 KB).');
    }
    // IDBFS persists /home/user across invocations and browser reloads.
    // zsh-wasm runs its own nested worker to keep the UI responsive.
    const result = await runZshScript(script, { fs: 'idbfs' });
    self.postMessage({
      id,
      ok: true,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: 'exitCode' in result && typeof result.exitCode === 'number' ? result.exitCode : 0,
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    });
  }
};
