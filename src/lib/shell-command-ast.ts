import { LangVariant, parse } from 'sh-syntax';

type AstNode = {
  type?: string;
  start?: number;
  end?: number;
  args?: AstNode[];
  [key: string]: unknown;
};

export type ActiveShellCommand = {
  executable: string;
  words: string[];
  from: number;
  to: number;
};

function isNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    if (value.type === 'CallExpr') {
      calls.push(value);
      // Do not descend into word expansions here: a nested command substitution
      // is collected by traversal of the AST node's own child objects.
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'parent' || key === 'comments') continue;
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(ast);
  // Only extend an AST command across trailing horizontal whitespace.
  // A newline or shell separator ends its completion context.
  const candidates = calls.filter(call =>
    typeof call.start === 'number' && typeof call.end === 'number'
    && call.start <= cursor
    // The cursor may be inside the last word while it is being typed.
    // It may also follow the completed AST command by horizontal spaces.
    && (cursor <= call.end || (
      !/[\r\n;|&]/.test(source.slice(call.end, cursor))
      && source.slice(call.end, cursor).trim() === ''
    ))
  ).sort((a, b) =>
    // Prefer the innermost AST command for nested command substitutions.
    (a.end! - a.start!) - (b.end! - b.start!)
    || (b.start ?? 0) - (a.start ?? 0)
  );
  const call = candidates[0];
  if (!call || !Array.isArray(call.args) || !call.args.length) return null;
  const words = call.args.filter(arg =>
    typeof arg.start === 'number' && typeof arg.end === 'number'
    && arg.start <= cursor
  ).map(arg => source.slice(arg.start!, Math.min(arg.end!, cursor)));
  if (!words.length) return null;
  // Resolve literal wrappers from AST word boundaries. Only skip options
  // whose arity is known; unknown flags fail closed instead of guessing.
  let commandIndex = 0;
  while (commandIndex < words.length) {
    const word = words[commandIndex];
    if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(word)) {
      commandIndex++;
      continue;
    }
    if (word === 'command') {
      commandIndex++;
      // The command builtin accepts -p and -- before the executable.
      while (words[commandIndex] === '-p' || words[commandIndex] === '--') {
        commandIndex++;
      }
      if (words[commandIndex]?.startsWith('-')) return null;
      continue;
    }
    // "builtin" only invokes shell builtins. Never suggest external Fig
    // flags for "builtin curl" or other executables.
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
          // env -S re-parses a string into multiple arguments; the AST's
          // original word boundaries are not the eventual command boundaries.
          return null;
        } else if (/^--(?:unset|chdir)=.+$/.test(arg) || /^-[uC].+$/.test(arg)) {
          commandIndex++;
        } else if (arg === '-u' || arg === '--unset' || arg === '-C' || arg === '--chdir') {
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
        if (['-n', '-E', '-H', '-k', '-K', '-S', '-b', '--non-interactive', '--preserve-env'].includes(arg) || /^--preserve-env=.+$/.test(arg)) {
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
  // Dynamic executable names cannot be resolved safely as static Fig specs.
  if (!executable || !/^[a-zA-Z][\w.-]*$/.test(executable)) return null;
  return { executable, words: words.slice(commandIndex + 1), from: call.start!, to: call.end! };
}
