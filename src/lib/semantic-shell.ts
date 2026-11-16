import { byName } from './commands';
import { cliSpecs, type CliSpec } from './cli-specs';

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
  source: 'catalog' | 'shell' | 'cli-spec';
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
  let activeSpec: CliSpec | undefined;
  let pendingValue: string | undefined;
  let positionalIndex = 0;
  let redirectTarget = false;
  let lineStart = 0;

  for (const line of code.split('\n')) {
    // The current token scanner is intentionally not a shell AST.
    // Skip compound syntax rather than incorrectly labeling control words.
    if (/(?:^|[;\s])(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|function)\b|\$\(|\$\{|\x60|<<|\(\(/.test(line)) {
      lineStart += line.length + 1;
      continue;
    }
    const comment = /^\s*#/.test(line);
    if (comment) {
      lineStart += line.length + 1;
      continue;
    }
    for (const match of line.matchAll(tokenPattern)) {
      const value = match[0];
      const from = lineStart + (match.index ?? 0);
      const to = from + value.length;
      // Shell comments begin at a token boundary, not inside quoted strings.
      if (value.startsWith('#')) break;
      if (value.includes('      if (redirectTarget) {
        tokens.push({ from, to, text: value, kind: 'option', title: 'Destino do redirecionamento', description: 'Caminho usado pelo operador de redirecionamento anterior.', source: 'shell' });
        redirectTarget = false;
        continue;
      }
      const operator = operators[value];
      if (operator) {
        tokens.push({ from, to, text: value, kind: 'operator', title: value, description: operator, source: 'shell' });
        redirectTarget = value === '>' || value === '>>' || value === '<';
        expectingCommand = !redirectTarget;
        if (expectingCommand) { currentCommand = ''; activeSpec = undefined; pendingValue = undefined; positionalIndex = 0; }
        continue;
      }
      if (value === '&') {
        expectingCommand = true;
        currentCommand = '';
        activeSpec = undefined;
        pendingValue = undefined;
        positionalIndex = 0;
        continue;
      }
      if (expectingCommand) {
        if (/^[A-Za-z_][\w]*=/.test(value)) continue;
        if (value === 'sudo' || value === 'command' || value === 'builtin') continue;
        expectingCommand = false;
        currentCommand = value;
        activeSpec = cliSpecs[value];
        pendingValue = undefined;
        positionalIndex = 0;
        const entry = byName.get(value);
        if (entry || activeSpec) tokens.push({
          from, to, text: value, kind: 'command', title: entry?.title ?? activeSpec?.name ?? value,
          description: activeSpec?.description ?? entry?.description ?? '', example: entry?.example,
          source: activeSpec ? 'cli-spec' : 'catalog',
        });
        continue;
      }
      if (pendingValue) {
        tokens.push({ from, to, text: value, kind: 'option', title: 'Valor de ' + pendingValue, description: 'Valor fornecido para a opção ' + pendingValue + '.', source: 'cli-spec' });
        pendingValue = undefined;
        continue;
      }
      if (activeSpec?.subcommands?.[value]) {
        activeSpec = activeSpec.subcommands[value];
        positionalIndex = 0;
        tokens.push({ from, to, text: value, kind: 'command', title: currentCommand + ' ' + value, description: activeSpec.description, source: 'cli-spec' });
        continue;
      }
      const optionName = value.startsWith('--') ? value.split('=')[0] : value;
      const option = activeSpec?.options?.find(item => item.names.includes(optionName));
      if (option) {
        tokens.push({ from, to, text: value, kind: 'option', title: currentCommand + ' ' + optionName, description: option.description, source: 'cli-spec' });
        if (option.takesValue && !value.includes('=')) pendingValue = optionName;
        continue;
      }
      if (activeSpec && !value.startsWith('-')) {
        const label = activeSpec.positionals?.[Math.min(positionalIndex, (activeSpec.positionals?.length ?? 1) - 1)];
        if (label) tokens.push({ from, to, text: value, kind: 'option', title: label, description: 'Argumento posicional: ' + label + '.', source: 'cli-spec' });
        positionalIndex++;
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
    activeSpec = undefined;
    pendingValue = undefined;
    positionalIndex = 0;
    redirectTarget = false;
  }
  return tokens;
}
)) {
        expectingCommand = false;
        activeSpec = undefined;
        pendingValue = undefined;
        continue;
      }
      if (redirectTarget) {
        tokens.push({ from, to, text: value, kind: 'option', title: 'Destino do redirecionamento', description: 'Caminho usado pelo operador de redirecionamento anterior.', source: 'shell' });
        redirectTarget = false;
        continue;
      }
      const operator = operators[value];
      if (operator) {
        tokens.push({ from, to, text: value, kind: 'operator', title: value, description: operator, source: 'shell' });
        redirectTarget = value === '>' || value === '>>' || value === '<';
        expectingCommand = !redirectTarget;
        if (expectingCommand) { currentCommand = ''; activeSpec = undefined; pendingValue = undefined; positionalIndex = 0; }
        continue;
      }
      if (value === '&') {
        expectingCommand = true;
        currentCommand = '';
        activeSpec = undefined;
        pendingValue = undefined;
        positionalIndex = 0;
        continue;
      }
      if (expectingCommand) {
        if (/^[A-Za-z_][\w]*=/.test(value)) continue;
        if (value === 'sudo' || value === 'command' || value === 'builtin') continue;
        expectingCommand = false;
        currentCommand = value;
        activeSpec = cliSpecs[value];
        pendingValue = undefined;
        positionalIndex = 0;
        const entry = byName.get(value);
        if (entry || activeSpec) tokens.push({
          from, to, text: value, kind: 'command', title: entry?.title ?? activeSpec?.name ?? value,
          description: activeSpec?.description ?? entry?.description ?? '', example: entry?.example,
          source: activeSpec ? 'cli-spec' : 'catalog',
        });
        continue;
      }
      if (pendingValue) {
        tokens.push({ from, to, text: value, kind: 'option', title: 'Valor de ' + pendingValue, description: 'Valor fornecido para a opção ' + pendingValue + '.', source: 'cli-spec' });
        pendingValue = undefined;
        continue;
      }
      if (activeSpec?.subcommands?.[value]) {
        activeSpec = activeSpec.subcommands[value];
        positionalIndex = 0;
        tokens.push({ from, to, text: value, kind: 'command', title: currentCommand + ' ' + value, description: activeSpec.description, source: 'cli-spec' });
        continue;
      }
      const optionName = value.startsWith('--') ? value.split('=')[0] : value;
      const option = activeSpec?.options?.find(item => item.names.includes(optionName));
      if (option) {
        tokens.push({ from, to, text: value, kind: 'option', title: currentCommand + ' ' + optionName, description: option.description, source: 'cli-spec' });
        if (option.takesValue && !value.includes('=')) pendingValue = optionName;
        continue;
      }
      if (activeSpec && !value.startsWith('-')) {
        const label = activeSpec.positionals?.[Math.min(positionalIndex, (activeSpec.positionals?.length ?? 1) - 1)];
        if (label) tokens.push({ from, to, text: value, kind: 'option', title: label, description: 'Argumento posicional: ' + label + '.', source: 'cli-spec' });
        positionalIndex++;
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
    activeSpec = undefined;
    pendingValue = undefined;
    positionalIndex = 0;
    redirectTarget = false;
  }
  return tokens;
}
