import { LangVariant, parse } from 'sh-syntax';
import { byName } from './commands';
import { cliSpecs, type CliSpec } from './cli-specs';
import { resolveShellCommandWords } from './shell-command-ast';

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

type AstPosition = { offset?: number };
type AstNode = {
  type?: string;
  start?: number;
  end?: number;
  args?: AstNode[];
  word?: AstNode | null;
  opPos?: AstPosition;
  semicolon?: AstPosition;
  [key: string]: unknown;
};

const operators: Record<string, string> = {
  '|': 'Envia a saída padrão do comando anterior à entrada do próximo.',
  '|&': 'Envia saída padrão e erros do comando anterior à entrada do próximo.',
  '||': 'Executa o próximo comando se o anterior falhar.',
  '&&': 'Executa o próximo comando somente se o anterior tiver sucesso.',
  ';': 'Separa comandos; o próximo executa independentemente do código de saída.',
  '&': 'Executa o comando em segundo plano.',
  '>': 'Redireciona a saída para um arquivo, substituindo seu conteúdo.',
  '>>': 'Acrescenta a saída ao final de um arquivo.',
  '<': 'Lê a entrada padrão de um arquivo.',
  '<<': 'Fornece uma entrada here-document ao comando.',
  '<<<': 'Fornece uma here-string como entrada padrão.',
  '<>': 'Abre o destino para leitura e escrita.',
  '>|': 'Força a substituição do destino mesmo quando noclobber está ativo.',
  '>&': 'Duplica ou redireciona um descritor de saída.',
  '<&': 'Duplica ou redireciona um descritor de entrada.',
};

function isNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rangeOf(node: AstNode, source: string): { from: number; to: number } | null {
  if (
    typeof node.start !== 'number' || typeof node.end !== 'number'
    || node.start < 0 || node.end < node.start || node.end > source.length
  ) return null;
  return { from: node.start, to: node.end };
}

function sourceOf(node: AstNode, source: string): string | null {
  const range = rangeOf(node, source);
  return range ? source.slice(range.from, range.to) : null;
}

function operatorAt(source: string, offset: number, candidates: readonly string[]): string | null {
  if (!Number.isInteger(offset) || offset < 0 || offset >= source.length) return null;
  return candidates.find(operator => source.startsWith(operator, offset)) ?? null;
}

function pushUnique(tokens: SemanticToken[], seen: Set<string>, token: SemanticToken): void {
  const key = [token.from, token.to, token.kind, token.title].join(':');
  if (seen.has(key)) return;
  seen.add(key);
  tokens.push(token);
}

function shellOperatorToken(source: string, from: number, operator: string): SemanticToken {
  return {
    from,
    to: from + operator.length,
    text: operator,
    kind: 'operator',
    title: operator,
    description: operators[operator],
    source: 'shell',
  };
}

function classifyCall(call: AstNode, source: string, tokens: SemanticToken[], seen: Set<string>): void {
  if (!Array.isArray(call.args) || call.args.length === 0) return;
  const args = call.args.filter(arg => rangeOf(arg, source));
  const rawWords = args.map(arg => sourceOf(arg, source) ?? '');
  const resolved = resolveShellCommandWords(rawWords);
  if (!resolved) return;

  const commandNode = args[resolved.commandIndex];
  const commandRange = commandNode && rangeOf(commandNode, source);
  if (!commandNode || !commandRange) return;

  const entry = byName.get(resolved.executable);
  let activeSpec: CliSpec | undefined = cliSpecs[resolved.executable];
  if (entry || activeSpec) {
    pushUnique(tokens, seen, {
      ...commandRange,
      text: resolved.executable,
      kind: 'command',
      title: entry?.title ?? activeSpec?.name ?? resolved.executable,
      description: activeSpec?.description ?? entry?.description ?? '',
      example: entry?.example,
      source: activeSpec ? 'cli-spec' : 'catalog',
    });
  }

  const argumentNodes = args.slice(resolved.commandIndex + 1);
  const argumentWords = rawWords.slice(resolved.commandIndex + 1);
  let pendingValue: string | undefined;
  let positionalIndex = 0;

  for (let index = 0; index < argumentWords.length; index++) {
    const value = argumentWords[index];
    const node = argumentNodes[index];
    const range = node && rangeOf(node, source);
    if (!range) continue;

    if (pendingValue) {
      pushUnique(tokens, seen, {
        ...range,
        text: value,
        kind: 'option',
        title: 'Valor de ' + pendingValue,
        description: 'Valor fornecido para a opção ' + pendingValue + '.',
        source: 'cli-spec',
      });
      pendingValue = undefined;
      continue;
    }

    if (activeSpec?.subcommands?.[value]) {
      activeSpec = activeSpec.subcommands[value];
      positionalIndex = 0;
      pushUnique(tokens, seen, {
        ...range,
        text: value,
        kind: 'command',
        title: resolved.executable + ' ' + value,
        description: activeSpec.description,
        source: 'cli-spec',
      });
      continue;
    }

    const longOptionName = value.startsWith('--') ? value.split('=', 1)[0] : value;
    let option = activeSpec?.options?.find(item => item.names.includes(longOptionName));
    let optionName = longOptionName;
    let attachedValue = value.includes('=');

    if (!option && activeSpec && /^-[A-Za-z].+/.test(value)) {
      for (const candidate of activeSpec.options ?? []) {
        const shortName = candidate.names.find(name => /^-[A-Za-z]$/.test(name));
        if (candidate.takesValue && shortName && value.startsWith(shortName) && value.length > shortName.length) {
          option = candidate;
          optionName = shortName;
          attachedValue = true;
          break;
        }
      }
    }

    if (option) {
      pushUnique(tokens, seen, {
        ...range,
        text: value,
        kind: 'option',
        title: resolved.executable + ' ' + optionName,
        description: option.description,
        source: 'cli-spec',
      });
      if (option.takesValue && !attachedValue) pendingValue = optionName;
      continue;
    }

    if (activeSpec && !value.startsWith('-')) {
      const positionals = activeSpec.positionals ?? [];
      const label = positionals.length
        ? positionals[Math.min(positionalIndex, positionals.length - 1)]
        : undefined;
      if (label) {
        pushUnique(tokens, seen, {
          ...range,
          text: value,
          kind: 'option',
          title: label,
          description: 'Argumento posicional: ' + label + '.',
          source: 'cli-spec',
        });
      }
      positionalIndex++;
      continue;
    }

    const flag = entry?.flags?.find(item => item.flag === value);
    if (flag) {
      pushUnique(tokens, seen, {
        ...range,
        text: value,
        kind: 'option',
        title: resolved.executable + ' ' + value,
        description: flag.description,
        example: flag.example,
        source: 'catalog',
      });
    }
  }
}

/**
 * Build semantic tokens from the real mvdan/sh AST. Word and operator ranges
 * come from AST nodes/positions, so quoted pipes, comments and compound shell
 * syntax are never re-tokenized with regexes.
 */
export function explainKnownShellTokensFromAst(code: string, ast: unknown): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const seenTokens = new Set<string>();
  const visited = new WeakSet<object>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (!isNode(value) || visited.has(value)) return;
    visited.add(value);

    if (value.type === 'CallExpr') classifyCall(value, code, tokens, seenTokens);

    if (value.type === 'BinaryCmd') {
      const offset = value.opPos?.offset;
      if (typeof offset === 'number') {
        const operator = operatorAt(code, offset, ['||', '&&', '|&', '|']);
        if (operator && operators[operator]) {
          pushUnique(tokens, seenTokens, shellOperatorToken(code, offset, operator));
        }
      }
    }

    if (value.type === 'Redirect') {
      const offset = value.opPos?.offset;
      if (typeof offset === 'number') {
        const operator = operatorAt(code, offset, ['<<<', '>>', '<<', '<>', '>|', '>&', '<&', '>', '<']);
        if (operator && operators[operator]) {
          pushUnique(tokens, seenTokens, shellOperatorToken(code, offset, operator));
        }
      }
      if (isNode(value.word)) {
        const range = rangeOf(value.word, code);
        if (range) {
          pushUnique(tokens, seenTokens, {
            ...range,
            text: code.slice(range.from, range.to),
            kind: 'option',
            title: 'Destino do redirecionamento',
            description: 'Caminho usado pelo operador de redirecionamento.',
            source: 'shell',
          });
        }
      }
    }

    if (value.type === 'Stmt') {
      const offset = value.semicolon?.offset;
      if (typeof offset === 'number' && offset > 0) {
        const operator = operatorAt(code, offset, [';', '&']);
        if (operator && operators[operator]) {
          pushUnique(tokens, seenTokens, shellOperatorToken(code, offset, operator));
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'parent' || key === 'comments') continue;
      if (child && typeof child === 'object') walk(child);
    }
  };

  walk(ast);
  return tokens.sort((a, b) => a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind));
}

let cachedSource = '';
let cachedSemanticTokens: Promise<SemanticToken[]> | null = null;

/** Parse once per source snapshot and share the in-flight result between editor interactions. */
export function explainKnownShellTokens(code: string): Promise<SemanticToken[]> {
  if (cachedSemanticTokens && code === cachedSource) return cachedSemanticTokens;
  cachedSource = code;
  cachedSemanticTokens = parse(code, { variant: LangVariant.LangZsh, keepComments: true })
    .then(ast => explainKnownShellTokensFromAst(code, ast))
    .catch(() => []);
  return cachedSemanticTokens;
}
