import { LangVariant, parse } from 'sh-syntax';

export type ShellAst = Awaited<ReturnType<typeof parse>>;

const CACHE_LIMIT = 4;
const astCache = new Map<string, Promise<ShellAst>>();

function remember(source: string, promise: Promise<ShellAst>): Promise<ShellAst> {
  astCache.delete(source);
  astCache.set(source, promise);
  while (astCache.size > CACHE_LIMIT) {
    const oldest = astCache.keys().next().value;
    if (oldest === undefined) break;
    astCache.delete(oldest);
  }
  return promise;
}

/**
 * Parse a Zsh source snapshot once and share the exact in-flight AST Promise
 * across autocomplete, hover, semantic inspection, validation and explanation.
 *
 * The cache is deliberately tiny: mobile editing produces many snapshots and
 * retaining old source/AST pairs indefinitely would trade CPU savings for RAM.
 */
export function parseShellAst(source: string): Promise<ShellAst> {
  const cached = astCache.get(source);
  if (cached) return remember(source, cached);

  return remember(source, parse(source, {
    variant: LangVariant.LangZsh,
    keepComments: true,
  }));
}
