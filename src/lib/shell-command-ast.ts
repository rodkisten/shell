import { LangVariant, parse } from 'sh-syntax';

type AstNode = {
  type?: string;
  start?: number;
  end?: number;
  args?: AstNode[];
  [key: string]: unknown;
};

export type ShellCommandWord = {
  text: string;
  from: number;
  to: number;
};

export type ActiveShellCommand = {
  executable: string;
  words: string[];
  executableFrom: number;
  executableTo: number;
  arguments: ShellCommandWord[];
  from: number;
  to: number;
};

export type ResolvedShellCommandWords = {
  commandIndex: number;
  executable: string;
  words: string[];
};

function isNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve literal wrappers without re-tokenizing shell source. The caller must
 * supply words that already came from AST Word node boundaries.
 */
export function resolveShellCommandWords(words: readonly string[]): ResolvedShellCommandWords | null {
  let commandIndex = 0;
  while (commandIndex < words.length) {
    const word = words[commandIndex];
    if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(word)) {
      commandIndex++;
      continue;
    }
    if (word === 'command') {
      commandIndex++;
      while (words[commandIndex] === '-p' || words[commandIndex] === '--') commandIndex++;
      if (words[commandIndex]?.startsWith('-')) return null;
      continue;
    }
    // "builtin" only invokes shell builtins. Never resolve it as an external
    // executable for Fig/CLI metadata.
    if (word === 'builtin') return null;
    if (word === 'env') {
      commandIndex++;
      while (commandIndex < words.length) {
        const arg = words[commandIndex];
        if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(arg)) {
          commandIndex++;
        } else if (arg === '--') {
          commandIndex++;
          break;
        } else if (arg === '-i' || arg === '--ignore-environment' || arg === '-0' || arg === '--null') {
          commandIndex++;
        } else if (arg === '-S' || arg === '--split-string' || arg.startsWith('--split-string=') || /^-S.+/.test(arg)) {
          // env -S re-parses a string into multiple arguments, so the AST's
          // original Word boundaries are not the eventual command boundaries.
          return null;
        } else if (/^--(?:unset|chdir|argv0)=.+$/.test(arg) || /^-[uCa].+$/.test(arg)) {
          commandIndex++;
        } else if (arg === '-u' || arg === '--unset' || arg === '-C' || arg === '--chdir' || arg === '-a' || arg === '--argv0') {
          if (!words[commandIndex + 1]) return null;
          commandIndex += 2;
        } else if (arg.startsWith('-')) {
          return null;
        } else {
          break;
        }
      }
      continue;
    }
    if (word === 'sudo') {
      commandIndex++;
      while (commandIndex < words.length) {
        const arg = words[commandIndex];
        if (arg === '--') {
          commandIndex++;
          break;
        }
        if (
          ['-n', '-E', '-H', '-k', '-K', '-S', '-b', '--non-interactive', '--preserve-env'].includes(arg)
          || /^--preserve-env=.+$/.test(arg)
        ) {
          commandIndex++;
          continue;
        }
        if (/^--(?:user|group|prompt|role|type)=.+$/.test(arg) || /^-[ughpCrt].+$/.test(arg)) {
          commandIndex++;
          continue;
        }
        if (['-u', '-g', '-h', '-p', '-C', '-r', '-t', '--user', '--group', '--prompt', '--role', '--type'].includes(arg)) {
          if (!words[commandIndex + 1]) return null;
          commandIndex += 2;
          continue;
        }
        if (arg.startsWith('-')) return null;
        break;
      }
      continue;
    }
    break;
  }

  const executable = words[commandIndex];
  if (!executable || !/^[a-zA-Z][\w.-]*$/.test(executable)) return null;
  return { commandIndex, executable, words: words.slice(commandIndex + 1) };
}

/**
 * Read the active CallExpr from mvdan/sh's real AST. Never split shell source
 * on pipes, semicolons or whitespace: those can occur inside quoted words.
 * Fail closed for incomplete/unsupported syntax rather than guessing.
 */
export async function activeShellCommand(
  source: string,
  cursor: number,
): Promise<ActiveShellCommand | null> {
  if (cursor < 0 || cursor > source.length) return null;
  let ast: unknown;
  try {
    ast = await parse(source, { variant: LangVariant.LangZsh, keepComments: true });
  } catch {
    return null;
  }

  const calls: AstNode[] = [];
  const visited = new WeakSet<object>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isNode(value) || visited.has(value)) return;
    visited.add(value);
    if (value.type === 'CallExpr') calls.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === 'parent' || key === 'comments') continue;
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(ast);

  const candidates = calls.filter(call =>
    typeof call.start === 'number' && typeof call.end === 'number'
    && call.start <= cursor
    && (cursor <= call.end || (
      !/[\r\n;|&]/.test(source.slice(call.end, cursor))
      && source.slice(call.end, cursor).trim() === ''
    ))
  ).sort((a, b) =>
    (a.end! - a.start!) - (b.end! - b.start!)
    || (b.start ?? 0) - (a.start ?? 0)
  );

  const call = candidates[0];
  if (!call || !Array.isArray(call.args) || !call.args.length) return null;
  const visibleWords = call.args.filter(arg =>
    typeof arg.start === 'number' && typeof arg.end === 'number'
    && arg.start <= cursor
  ).map(arg => ({
    text: source.slice(arg.start!, Math.min(arg.end!, cursor)),
    from: arg.start!,
    to: Math.min(arg.end!, cursor),
  }));
  if (!visibleWords.length) return null;

  const resolved = resolveShellCommandWords(visibleWords.map(word => word.text));
  if (!resolved) return null;
  const executableWord = visibleWords[resolved.commandIndex];
  if (!executableWord) return null;
  const arguments_ = visibleWords.slice(resolved.commandIndex + 1);
  return {
    executable: resolved.executable,
    words: resolved.words,
    executableFrom: executableWord.from,
    executableTo: executableWord.to,
    arguments: arguments_,
    from: call.start!,
    to: call.end!,
  };
}
