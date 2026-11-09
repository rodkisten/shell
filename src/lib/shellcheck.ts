export type Finding = {
  line: number;
  endLine?: number;
  column: number;
  endColumn?: number;
  level: 'error' | 'warning' | 'info' | 'style';
  code: number;
  message: string;
  fix?: { replacements: Array<{ line: number; column: number; endLine: number; endColumn: number; replacement: string }> };
};
let client: Promise<any> | undefined;
async function start() {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('ShellCheck precisa de isolamento COOP/COEP. Verifique os cabeçalhos da hospedagem e atualize o Safari.');
  }
  const { createShellCheck } = await import('@vscode-shellcheck/shellcheck-wasm');
  const [{ default: wasmUrl }, { default: workerUrl }] = await Promise.all([
    import('@vscode-shellcheck/shellcheck-wasm/shellcheck.wasm?url'),
    import('@vscode-shellcheck/shellcheck-wasm/browser/worker.js?url'),
  ]);
  const module = WebAssembly.compileStreaming(fetch(wasmUrl));
  return createShellCheck({
    module,
    createWorker() {
      const worker = new Worker(workerUrl, { type: 'classic' });
      return {
        postMessage(message: unknown) { worker.postMessage(message); },
        onMessage(listener: (message: unknown) => void) { worker.addEventListener('message', e => listener(e.data)); },
        onError(listener: (error: unknown) => void) { worker.addEventListener('error', listener); },
        terminate() { worker.terminate(); },
      };
    },
  });
}
export async function checkShell(script: string, signal?: AbortSignal): Promise<Finding[]> {
  if (!script.trim()) return [];
  if (!client) client = start().catch((error) => { client = undefined; throw error; });
  const check = await client;
  const result = await check.lint({ args: ['--format=json1', '--shell=bash', '-'], stdin: script }, { signal });
  if (!result.stdout) {
    if (result.exitCode > 1) throw new Error(result.stderr || 'ShellCheck não conseguiu analisar o script.');
    return [];
  }
  const data = JSON.parse(result.stdout) as { comments: Finding[] };
  return data.comments || [];
}
function offset(text: string, line: number, column: number) {
  const lines = text.split('\n');
  return lines.slice(0, Math.max(0, line - 1)).reduce((sum, part) => sum + part.length + 1, 0) + column - 1;
}
export function applyAvailableFixes(script: string, findings: Finding[]) {
  const changes = findings.flatMap((finding) => finding.fix?.replacements || [])
    .map((r) => ({ from: offset(script, r.line, r.column), to: offset(script, r.endLine, r.endColumn), replacement: r.replacement }))
    .sort((a, b) => b.from - a.from);
  let fixed = script; let lastStart = Infinity; let count = 0;
  for (const change of changes) {
    if (change.to > lastStart || change.from < 0 || change.to > fixed.length) continue;
    fixed = fixed.slice(0, change.from) + change.replacement + fixed.slice(change.to);
    lastStart = change.from;
    count++;
  }
  return { code: fixed, count };
}
