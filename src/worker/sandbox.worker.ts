import { runZshScript } from '@brandon.zylstra/zsh-wasm';

type Request = { id: number; action: 'execute' | 'reset' | 'completion-context'; script?: string };
type CommandResult = { ok: boolean; stdout: string; stderr: string; exitCode: number };

// BusyBox is a separate POSIX ash runtime, not an alias for Zsh.
// Lazy import keeps the WASM runtime out of the initial editor bundle.
async function runBusyBox(script: string): Promise<CommandResult> {
  const { run } = await import('wasi-sh');
  const result = await run({ script });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

function busyBoxScript(script: string): string | null {
  const trimmed = script.trim();
  // Opt-in for complete POSIX shell scripts and real BusyBox pipelines.
  const directive = /^#\s*shellconductor:busybox\s*(?:\r?\n|$)/i;
  if (directive.test(trimmed)) return trimmed.replace(directive, '');
  // Explicit shell selection, without hijacking ordinary Zsh commands.
  const prefix = /^busybox-sh(?:\s+|$)/;
  if (prefix.test(trimmed)) return trimmed.replace(prefix, '');
  return null;
}

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
      token += command[++i];
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else {
        token += char;
        started = true;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
      continue;
    }
    // Shell operators must be handled by the shell, not the HTTP adapter.
    if (/[|;&<>`$(){}]/.test(char)) return null;
    token += char;
    started = true;
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
      body = value();
      if (method === 'GET') method = 'POST';
    } else if (arg === '-I' || arg === '--head') {
      method = 'HEAD';
      headOnly = true;
    } else if (arg === '-i' || arg === '--include') showHeaders = true;
    else if (arg === '-f' || arg === '--fail') fail = true;
    else if (arg === '-L' || arg === '--location') follow = true;
    else if (arg === '-s' || arg === '--silent' || arg === '-S' || arg === '--show-error') {
      /* No progress meter. */
    } else if (arg === '--max-time') {
      timeoutSeconds = Number(value());
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 30) {
        throw new Error('curl: --max-time deve estar entre 1 e 30 segundos');
      }
    } else if (arg === '--url') url = value();
    else if (arg.startsWith('-')) throw new Error('curl: opção não suportada no navegador: ' + arg);
    else if (!url) url = arg;
    else throw new Error('curl: somente uma URL por execução é suportada');
  }
  if (!url) throw new Error('curl: informe uma URL');
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('curl: somente HTTP e HTTPS são permitidos');
  }
  try {
    const response = await fetch(parsed.href, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: follow ? 'follow' : 'manual',
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      credentials: 'omit',
    });
    const headerText = `HTTP ${response.status} ${response.statusText}\n${[...response.headers]
      .map(([key, val]) => `${key}: ${val}`)
      .join('\n')}\n\n`;
    if (fail && !response.ok) {
      return { ok: false, stdout: '', stderr: `curl: HTTP ${response.status}\n`, exitCode: 22 };
    }
    return {
      ok: true,
      stdout: (showHeaders || headOnly ? headerText : '') + (headOnly ? '' : await response.text()),
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stdout: '',
      stderr: `curl: ${message}. Verifique CORS, conectividade e permissões do servidor.\n`,
      exitCode: 7,
    };
  }
}

async function completionContext(): Promise<CommandResult> {
  // Only inspect local IDBFS state. No network calls and no external binaries.
  // Zsh builtins read package.json and Git refs, keeping autocomplete private.
  const probe = String.raw`
emulate -L zsh
setopt null_glob extended_glob
print -r -- '__SC_PACKAGE_BEGIN__'
if [[ -r package.json ]]; then
  print -r -- "$(<package.json)"
fi
print -r -- '__SC_PACKAGE_END__'
print -r -- '__SC_WORKSPACES_BEGIN__'
integer count=0
for file in */package.json */*/package.json; do
  [[ "$file" == node_modules/* || "$file" == */node_modules/* ]] && continue
  [[ -r "$file" ]] || continue
  print -r -- "__SC_FILE__$file"
  print -r -- "$(<"$file")"
  print -r -- ''
  (( ++count >= 60 )) && break
done
print -r -- '__SC_WORKSPACES_END__'
print -r -- '__SC_BRANCHES_BEGIN__'
for ref in .git/refs/heads/* .git/refs/heads/**/*; do
  [[ -f "$ref" ]] || continue
  print -r -- "${'${ref#.git/refs/heads/}'}"
done
if [[ -r .git/packed-refs ]]; then
  while IFS=' ' read -r hash ref; do
    [[ "$ref" == refs/heads/* ]] && print -r -- "${'${ref#refs/heads/}'}"
  done < .git/packed-refs
fi
print -r -- '__SC_BRANCHES_END__'
`;
  const result = await runZshScript(probe, { fs: 'idbfs' });
  const stdout = result.stdout ?? '';
  const between = (start: string, end: string) => {
    const from = stdout.indexOf(start);
    const to = stdout.indexOf(end);
    if (from < 0 || to < 0 || to < from) return '';
    return stdout.slice(from + start.length, to).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  };

  const npmScripts: string[] = [];
  const npmWorkspaces: string[] = [];
  const gitBranches = between('__SC_BRANCHES_BEGIN__', '__SC_BRANCHES_END__')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  const rootText = between('__SC_PACKAGE_BEGIN__', '__SC_PACKAGE_END__');
  if (rootText) {
    try {
      const pkg = JSON.parse(rootText) as { scripts?: Record<string, unknown>; workspaces?: unknown };
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        npmScripts.push(...Object.keys(pkg.scripts));
      }
      if (Array.isArray(pkg.workspaces)) {
        npmWorkspaces.push(...pkg.workspaces.filter((value): value is string => typeof value === 'string'));
      } else if (pkg.workspaces && typeof pkg.workspaces === 'object') {
        const packages = (pkg.workspaces as { packages?: unknown }).packages;
        if (Array.isArray(packages)) {
          npmWorkspaces.push(...packages.filter((value): value is string => typeof value === 'string'));
        }
      }
    } catch {
      /* malformed package.json should not break autocomplete */
    }
  }

  const workspaceText = between('__SC_WORKSPACES_BEGIN__', '__SC_WORKSPACES_END__');
  for (const block of workspaceText.split('__SC_FILE__').slice(1)) {
    const newline = block.indexOf('\n');
    if (newline < 0) continue;
    const json = block.slice(newline + 1).trim();
    try {
      const pkg = JSON.parse(json) as { name?: unknown };
      if (typeof pkg.name === 'string' && pkg.name) npmWorkspaces.push(pkg.name);
    } catch {
      /* ignore malformed nested manifests */
    }
  }

  const context = {
    npmScripts: [...new Set(npmScripts)].sort(),
    npmWorkspaces: [...new Set(npmWorkspaces)].sort(),
    gitBranches: [...new Set(gitBranches)].sort(),
  };
  return { ok: true, stdout: JSON.stringify(context), stderr: '', exitCode: 0 };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, action, script } = event.data;
  try {
    if (action === 'reset') {
      self.postMessage({ id, ok: true, stdout: 'Ambiente reiniciado.\n', stderr: '', exitCode: 0 });
      return;
    }
    if (action === 'completion-context') {
      self.postMessage({ id, ...(await completionContext()) });
      return;
    }
    if (!script?.trim() || script.length > 50_000) {
      throw new Error('Script vazio ou muito grande (limite: 50 KB).');
    }
    const posixScript = busyBoxScript(script);
    if (posixScript !== null) {
      if (!posixScript.trim()) throw new Error('BusyBox: script vazio.');
      self.postMessage({ id, ...(await runBusyBox(posixScript)) });
      return;
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
    // The upstream public API documents stdout/stderr, not an exit status.
    // Never report an unobserved exit as success.
    const exitCode =
      'exitCode' in result && typeof result.exitCode === 'number' ? result.exitCode : -1;
    self.postMessage({
      id,
      ok: exitCode === 0 || exitCode === -1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode,
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
