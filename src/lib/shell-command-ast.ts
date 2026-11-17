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
  const candidates = calls.filter(call =>
    typeof call.start === 'number' && typeof call.end === 'number'
    && call.start <= cursor && call.end <= cursor
    && source.slice(call.end, cursor).trim() === '',
  ).sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  const call = candidates[0];
  if (!call || !Array.isArray(call.args) || !call.args.length) return null;
  const words = call.args.filter(arg =>
    typeof arg.start === 'number' && typeof arg.end === 'number'
    && arg.end <= cursor
  ).map(arg => source.slice(arg.start!, arg.end!));
  if (!words.length) return null;
  // Dynamic executable names cannot be resolved safely as static Fig specs.
  if (!/^[a-zA-Z][\w.-]*$/.test(words[0])) return null;
  return { executable: words[0], words: words.slice(1), from: call.start!, to: call.end! };
}
