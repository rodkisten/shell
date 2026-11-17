import { parse, LangVariant } from 'sh-syntax';
import { byName } from './commands';
import { cliSpecs } from './cli-specs';
import { inspectShellAst } from './shell-ast';

export type SemanticToken = {
  from: number;
  to: number;
  text: string;
  kind: 'command' | 'option' | 'operator';
  title: string;
  description: string;
  example?: string;
  source: 'catalog' | 'shell' | 'cli-spec';
};

type AstNode = { type?: string; start?: number; end?: number; args?: AstNode[]; parts?: AstNode[]; value?: string; cmd?: AstNode; stmts?: AstNode[] };
export type ShellAnalysis = { source: string; tokens: SemanticToken[]; overview: ReturnType<typeof inspectShellAst> };

/** sh-syntax positions are UTF-8 bytes. CodeMirror uses UTF-16 offsets. */
function offsets(source: string): Map<number, number> {
  const map = new Map<number, number>();
  let byte = 0;
  for (let i = 0; i < source.length;) {
    const point = source.codePointAt(i);
    if (point === undefined) break;
    map.set(byte, i);
    const char = String.fromCodePoint(point);
    byte += new TextEncoder().encode(char).length;
    i += char.length;
  }
  map.set(byte, source.length);
  return map;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * Build semantic selections from the parser's typed AST nodes. We only
 * annotate static literal command names: dynamic expansions remain unknown.
 * No regular-expression shell tokenizer is involved.
 */
function tokensFromAst(ast: unknown, source: string): SemanticToken[] {
  const map = offsets(source);
  const tokens: SemanticToken[] = [];
  const seen = new WeakSet<object>();
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const node = object(value);
    if (!node) return;
    if (node.type === 'CallExpr' && Array.isArray(node.args)) {
      const first = object(node.args[0]);
      const start = typeof first?.start === 'number' ? map.get(first.start) : undefined;
      const end = typeof first?.end === 'number' ? map.get(first.end) : undefined;
      if (start !== undefined && end !== undefined && start < end) {
        const name = source.slice(start, end);
        // Shell quoting, variable expansion and command substitution must
        // not be mistaken for a literal executable name.
        if (/^[a-zA-Z_][a-zA-Z_0-9.+-]*$/.test(name)) {
          const entry = byName.get(name);
          const spec = cliSpecs[name];
          if (entry || spec) tokens.push({
            from: start, to: end, text: name, kind: 'command',
            title: entry?.title ?? spec?.name ?? name,
            description: spec?.description ?? entry?.description ?? '',
            example: entry?.example,
            source: spec ? 'cli-spec' : 'catalog',
          });
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'position' && key !== 'opPos' && key !== 'semicolon' && child && typeof child === 'object') walk(child);
    }
  }
  walk(ast);
  return tokens.sort((a, b) => a.from - b.from);
}

/** One bounded in-flight parse per source, reused by editor and explain panel. */
let cached: Promise<ShellAnalysis> | undefined;
let cachedSource: string | undefined;
export function analyzeShell(source: string): Promise<ShellAnalysis> {
  if (cached && cachedSource === source) return cached;
  cachedSource = source;
  cached = parse(source, { variant: LangVariant.LangZsh, keepComments: true })
    .then(ast => ({ source, tokens: tokensFromAst(ast, source), overview: inspectShellAst(ast, source) }));
  cached.catch(() => { if (cachedSource === source) { cached = undefined; cachedSource = undefined; } });
  return cached;
}

/** Synchronous accessor for CodeMirror events; never triggers a parse. */
export function explainKnownShellTokens(source: string): SemanticToken[] {
  return cachedSource === source && resolved?.source === source ? resolved.tokens : [];
}
let resolved: ShellAnalysis | undefined;
const originalAnalyze = analyzeShell;
/** Prepares the shared analysis and makes it available to synchronous hovers. */
export async function prepareShellAnalysis(source: string): Promise<ShellAnalysis> {
  const analysis = await originalAnalyze(source);
  if (cachedSource === source) resolved = analysis;
  return analysis;
}
