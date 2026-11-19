import { byName } from './commands';
import { cliSpecs, type CliSpec } from './cli-specs';
import { resolveShellCommandWords } from './shell-command-ast';
import { parseShellSnapshot, type IndexedShellNode, type ShellSnapshot } from './shell-parser';

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

function indexedRange(entry: IndexedShellNode | undefined, source: string): { from: number; to: number } | null {
  if (
    !entry || entry.from === undefined || entry.to === undefined
    || entry.from < 0 || entry.to < entry.from || entry.to > source.length
  ) return null;
  return { from: entry.from, to: entry.to };
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

function classifyCall(call: IndexedShellNode, snapshot: ShellSnapshot, tokens: SemanticToken[], seen: Set<string>): void {
  const { source } = snapshot;
  if (!Array.isArray(call.node.args) || call.node.args.length === 0) return;
  const args = call.node.args
    .map(arg => isNode(arg) ? snapshot.byObject.get(arg) : undefined)
    .filter((arg): arg is IndexedShellNode => !!arg && !!indexedRange(arg, source));
  const rawWords = args.map(arg => source.slice(arg.from!, arg.to!));
  const resolved = resolveShellCommandWords(rawWords);
  if (!resolved) return;

  const commandNode = args[resolved.commandIndex];
  const commandRange = indexedRange(commandNode, source);
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
    const range = indexedRange(node, source);
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
      const positional = positionals.length
        ? positionals[Math.min(positionalIndex, positionals.length - 1)]
        : undefined;
      const label = typeof positional === 'string' ? positional : positional?.name;
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
export function explainKnownShellTokensFromSnapshot(snapshot: ShellSnapshot): SemanticToken[] {
  return snapshot.memo('semantic-tokens', () => {
    const { source } = snapshot;
    const tokens: SemanticToken[] = [];
    const seenTokens = new Set<string>();

    for (const entry of snapshot.nodes) {
      if (entry.type === 'CallExpr') classifyCall(entry, snapshot, tokens, seenTokens);

      if (entry.type === 'BinaryCmd') {
        const offset = (entry.node.opPos as AstPosition | undefined)?.offset;
        const from = typeof offset === 'number' ? snapshot.offsetToUtf16(offset) : undefined;
        if (from !== undefined) {
          const operator = operatorAt(source, from, ['||', '&&', '|&', '|']);
          if (operator && operators[operator]) {
            pushUnique(tokens, seenTokens, shellOperatorToken(source, from, operator));
          }
        }
      }

      if (entry.type === 'Redirect') {
        const offset = (entry.node.opPos as AstPosition | undefined)?.offset;
        const from = typeof offset === 'number' ? snapshot.offsetToUtf16(offset) : undefined;
        if (from !== undefined) {
          const operator = operatorAt(source, from, ['<<<', '>>', '<<', '<>', '>|', '>&', '<&', '>', '<']);
          if (operator && operators[operator]) {
            pushUnique(tokens, seenTokens, shellOperatorToken(source, from, operator));
          }
        }
        if (isNode(entry.node.word)) {
          const word = snapshot.byObject.get(entry.node.word);
          const range = indexedRange(word, source);
          if (range) {
            pushUnique(tokens, seenTokens, {
              ...range,
              text: source.slice(range.from, range.to),
              kind: 'option',
              title: 'Destino do redirecionamento',
              description: 'Caminho usado pelo operador de redirecionamento.',
              source: 'shell',
            });
          }
        }
      }

      if (entry.type === 'Stmt') {
        const offset = (entry.node.semicolon as AstPosition | undefined)?.offset;
        const from = typeof offset === 'number' ? snapshot.offsetToUtf16(offset) : undefined;
        if (from !== undefined && from > 0) {
          const operator = operatorAt(source, from, [';', '&']);
          if (operator && operators[operator]) {
            pushUnique(tokens, seenTokens, shellOperatorToken(source, from, operator));
          }
        }
      }
    }

    return tokens.sort((a, b) => a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind));
  });
}

export async function explainKnownShellTokens(code: string): Promise<SemanticToken[]> {
  try {
    return explainKnownShellTokensFromSnapshot(await parseShellSnapshot(code));
  } catch {
    return [];
  }
}
