import { byName } from './commands';

/**
 * Initial offline semantic lookup layer for CodeMirror.
 * This intentionally does not claim to understand arbitrary shell syntax:
 * the authoritative shell AST and external CLI specifications are separate
 * follow-up integrations.
 */
export type SemanticToken = {
  from: number;
  to: number;
  text: string;
  kind: 'command' | 'option' | 'operator';
  title: string;
  description: string;
  example?: string;
  source: 'catalog' | 'shell';
};

const operators: Record<string, string> = {
  '|': 'Envia a saída padrão do comando anterior à entrada do próximo.',
  '||': 'Executa o próximo comando se o anterior falhar.',
  '&&': 'Executa o próximo comando somente se o anterior tiver sucesso.',
  ';': 'Separa comandos; o próximo executa independentemente do código de saída.',
  '>': 'Redireciona a saída para um arquivo, substituindo seu conteúdo.',
  '>>': 'Acrescenta a saída ao final de um arquivo.',
  '<': 'Lê a entrada padrão de um arquivo.',
};

const tokenPattern = /"(?:\\.|[^"\\])*"|'[^']*'|\|\||&&|>>|[|;&<>]|[^\s|;&<>]+/g;

/** Conservative tokenization: quoted strings are kept together. */
export function explainKnownShellTokens(code: string): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  let expectingCommand = true;
  let currentCommand = '';
  let lineStart = 0;

  for (const line of code.split('\n')) {
    const comment = /^\s*#/.test(line);
    if (comment) {
      lineStart += line.length + 1;
      continue;
    }
    for (const match of line.matchAll(tokenPattern)) {
      const value = match[0];
      const from = lineStart + (match.index ?? 0);
      const to = from + value.length;
      const operator = operators[value];
      if (operator) {
        tokens.push({ from, to, text: value, kind: 'operator', title: value, description: operator, source: 'shell' });
        expectingCommand = value !== '>' && value !== '>>' && value !== '<';
        if (expectingCommand) currentCommand = '';
        continue;
      }
      if (value === '&') {
        expectingCommand = true;
        currentCommand = '';
        continue;
      }
      if (expectingCommand) {
        if (/^[A-Za-z_][\w]*=/.test(value)) continue;
        if (value === 'sudo' || value === 'command' || value === 'builtin') continue;
        expectingCommand = false;
        currentCommand = value;
        const entry = byName.get(value);
        if (entry) tokens.push({
          from, to, text: value, kind: 'command', title: entry.title,
          description: entry.description, example: entry.example, source: 'catalog',
        });
        continue;
      }
      const entry = byName.get(currentCommand);
      const flag = entry?.flags?.find((item) => item.flag === value);
      if (flag) tokens.push({
        from, to, text: value, kind: 'option', title: currentCommand + ' ' + value,
        description: flag.description, example: flag.example, source: 'catalog',
      });
    }
    lineStart += line.length + 1;
    expectingCommand = true;
    currentCommand = '';
  }
  return tokens;
}
