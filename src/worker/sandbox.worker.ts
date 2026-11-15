import { runZshScript } from '@brandon.zylstra/zsh-wasm';

type Request = { id: number; action: 'execute' | 'reset'; script?: string };
type CommandResult = { ok: boolean; stdout: string; stderr: string; exitCode: number };

// This adapter intentionally handles only a standalone curl invocation. Running
// curl inside Zsh pipelines requires a shared process/stream bridge; never
// silently emulate a pipeline with string concatenation.
function tokenize(command: string): string[] | null {
  const tokens: string[] = [];
  let token = '';
  let quote: "'" | '"' | null = null;
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      if (i + 1 >= command.length) return null;
      token += command[++i]; started = true; continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else { token += char; started = true; }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\\s/.test(char)) {
      if (started) { tokens.push(token); token = ''; started = false; }
      continue;
    }
    // Shell operators must be handled by the shell, not the HTTP adapter.
    if (/[|;&<>`$(){}]/.test(char)) return null;
    token += char; started = true;
  }
  if (quote) return null;
  if (started) tokens.push(token);
  return tokens;
}

async function curlFetch(args: string[]): Promise<CommandResult> {
  const headers = new Headers();
  let method = 'GET';
  let body: string | undefined;
  let url = '';
  let fail = false;
  let showHeaders = false;
  let headOnly = false;
  let follow = false;
  let timeoutSeconds = 20;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      if (i + 1 >= args.length) throw new Error('curl: argumento ausente para ' + arg);
      return args[++i];
    };
    if (arg === '-X' || arg === '--request') method = value().toUpperCase();
    else if (arg === '-H' || arg === '--header') {
      const header = value();
      const index = header.indexOf(':');
      if (index <= 0) throw new Error('curl: cabeçalho inválido: ' + header);
      headers.append(header.slice(0, index).trim(), header.slice(index + 1).trim());
    } else if (arg === '-d' || arg === '--data' || arg === '--data-raw') {
      body = value(); if (method === 'GET') method = 'POST';
    } else if (arg === '-I' || arg === '--head') { method = 'HEAD'; headOnly = true; }
    else if (arg === '-i' || arg === '--include') showHeaders = true;
    else if (arg === '-f' || arg === '--fail') fail = true;
    else if (arg === '-L' || arg === '--location') follow = true;
    else if (arg === '-s' || arg === '--silent' || arg === '-S' || arg === '--show-error') { /* No progress meter. */ }
    else if (arg === '--max-time') {
      timeoutSeconds = Number(value());
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 30) throw new Error('curl: --max-time deve estar entre 1 e 30 segundos');
    } else if (arg === '--url') url = value();
    else if (arg.startsWith('-')) throw new Error('curl: opção não suportada no navegador: ' + arg);
    else if (!url) url = arg;
    else throw new Error('curl: somente uma URL por execução é suportada');
  }
  if (!url) throw new Error('curl: informe uma URL');
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('curl: somente HTTP e HTTPS são permitidos');
  try {
    const response = await fetch(parsed.href, {
      method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: follow ? 'follow' : 'manual', signal: AbortSignal.timeout(timeoutSeconds * 1000),
      credentials: 'omit',
    });
    const headerText = `HTTP ${response.status} ${response.statusText}\\n${[...response.headers].map(([key, val]) => `${key}: ${val}`).join('\\n')}\\n\\n`;
    if (fail && !response.ok) return { ok: false, stdout: '', stderr: `curl: HTTP ${response.status}\\n`, exitCode: 22 };
    return { ok: true, stdout: (showHeaders || headOnly ? headerText : '') + (headOnly ? '' : await response.text()), stderr: '', exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, stdout: '', stderr: `curl: ${message}. Verifique CORS, conectividade e permissões do servidor.\\n`, exitCode: 7 };
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, action, script } = event.data;
  try {
    if (action === 'reset') {
      self.postMessage({ id, ok: true, stdout: 'Ambiente reiniciado.\\n', stderr: '', exitCode: 0 });
      return;
    }
    if (!script?.trim() || script.length > 50_000) {
      throw new Error('Script vazio ou muito grande (limite: 50 KB).');
    }
    const tokens = tokenize(script.trim());
    if (tokens?.[0] === 'curl') {
      const result = await curlFetch(tokens.slice(1));
      self.postMessage({ id, ...result });
      return;
    }
    // IDBFS persists /home/user across invocations and browser reloads.
    // zsh-wasm runs its own nested worker to keep the UI responsive.
    const result = await runZshScript(script, { fs: 'idbfs' });
    self.postMessage({
      id,
      ok: true,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      // The upstream public API documents stdout/stderr, not an exit status.
      // Never report an unobserved exit as success.
      exitCode: 'exitCode' in result && typeof result.exitCode === 'number' ? result.exitCode : -1,
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
