import { byName } from './commands';
import { cliSpecs, type CliOption, type CliSpec, type CliValueSpec } from './cli-specs';
import { activeShellCommand, type ActiveShellCommand } from './shell-command-ast';

export type CommandHelpItem = {
  label: string;
  description: string;
  kind: 'subcommand' | 'option' | 'argument';
  takesValue?: boolean;
  effect?: CliOption['effect'];
};

export type CommandHelpModel = {
  executable: string;
  path: string[];
  title: string;
  description: string;
  signature: string;
  snippet: string;
  usedOptions: CommandHelpItem[];
  current?: CommandHelpItem;
  options: CommandHelpItem[];
  subcommands: CommandHelpItem[];
  source: 'cli-spec' | 'catalog';
};

type ResolvedScope = {
  current: CliSpec;
  scopes: CliSpec[];
  path: string[];
  awaitingOption?: CliOption;
  positionalIndex: number;
};

function optionIn(scopes: readonly CliSpec[], name: string): CliOption | undefined {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const match = scopes[index].options?.find(option => option.names.includes(name));
    if (match) return match;
  }
  return undefined;
}

function resolveScope(root: CliSpec, words: readonly string[]): ResolvedScope {
  const scopes = [root];
  const path: string[] = [];
  let current = root;
  let awaitingOption: CliOption | undefined;
  let positionalIndex = 0;
  let positionalOnly = false;

  for (const word of words) {
    if (awaitingOption) {
      awaitingOption = undefined;
      positionalIndex++;
      continue;
    }
    if (word === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && word.startsWith('-')) {
      const name = word.split('=', 1)[0];
      const option = optionIn(scopes, name);
      if (option?.takesValue && !word.includes('=')) awaitingOption = option;
      continue;
    }
    if (!positionalOnly) {
      const next = current.subcommands?.[word];
      if (next) {
        current = next;
        scopes.push(next);
        path.push(word);
        positionalIndex = 0;
        continue;
      }
    }
    positionalIndex++;
  }

  return { current, scopes, path, awaitingOption, positionalIndex };
}

function positionalLabel(value: string | CliValueSpec | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.name;
}

function signature(executable: string, scope: ResolvedScope): string {
  const parts = [executable, ...scope.path];
  const options = scope.scopes.some(item => item.options?.length);
  if (options) parts.push('[options]');
  for (const positional of scope.current.positionals ?? []) {
    const label = positionalLabel(positional);
    if (label) parts.push('<' + label + '>');
  }
  if (scope.current.subcommands && Object.keys(scope.current.subcommands).length) parts.push('<subcommand>');
  return parts.join(' ');
}

function currentItem(active: ActiveShellCommand, cursor: number, scope: ResolvedScope): CommandHelpItem | undefined {
  const last = active.arguments.at(-1);
  if (scope.awaitingOption) {
    const name = scope.awaitingOption.names.at(-1) ?? scope.awaitingOption.names[0] ?? 'opção';
    return {
      label: name + ' <valor>',
      description: scope.awaitingOption.description,
      kind: 'argument',
      takesValue: true,
      effect: scope.awaitingOption.effect,
    };
  }

  if (last && last.from <= cursor && cursor <= last.to) {
    const text = last.text;
    if (text.startsWith('-')) {
      const option = optionIn(scope.scopes, text.split('=', 1)[0]);
      if (option) return {
        label: option.names.join(', ') + (option.takesValue ? ' <valor>' : ''),
        description: option.description,
        kind: 'option',
        takesValue: option.takesValue,
        effect: option.effect,
      };
    }
    const subcommand = scope.current.subcommands?.[text];
    if (subcommand) return {
      label: active.executable + ' ' + [...scope.path, text].join(' '),
      description: subcommand.description,
      kind: 'subcommand',
    };
  }

  const positional = scope.current.positionals?.[Math.max(0, scope.positionalIndex)];
  const label = positionalLabel(positional);
  return label ? {
    label: '<' + label + '>',
    description: 'Argumento posicional esperado neste ponto do comando.',
    kind: 'argument',
  } : undefined;
}

function dedupOptions(scopes: readonly CliSpec[]): CommandHelpItem[] {
  const seen = new Set<string>();
  const items: CommandHelpItem[] = [];
  for (const scope of scopes) {
    for (const option of scope.options ?? []) {
      const label = option.names.join(', ');
      if (seen.has(label)) continue;
      seen.add(label);
      items.push({
        label: label + (option.takesValue ? ' <valor>' : ''),
        description: option.description,
        kind: 'option',
        takesValue: option.takesValue,
        effect: option.effect,
      });
    }
  }
  return items;
}

function usedOptions(items: CommandHelpItem[], words: readonly string[]) {
  const flags = new Set<string>();
  for (const word of words) {
    if (word === '--') break;
    if (!word.startsWith('-')) continue;
    const name = word.split('=', 1)[0];
    flags.add(name);
    if (/^-[a-zA-Z]{2,}$/.test(name)) for (const char of name.slice(1)) flags.add('-' + char);
  }
  return items.filter(item => item.label.split(', ').some(label => flags.has(label.split(' ')[0])));
}

export function commandHelpFromActive(
  active: ActiveShellCommand | null,
  cursor: number,
  source = '',
): CommandHelpModel | null {
  if (!active) return null;
  const root = cliSpecs[active.executable];

  if (!root) {
    const catalog = byName.get(active.executable);
    if (!catalog) return { executable: active.executable, path: [], title: active.executable, description: 'Sem descrição no catálogo local.', signature: active.executable, snippet: source.slice(active.from, active.to), options: [], usedOptions: [], subcommands: [], source: 'catalog' };
    const options = (catalog.flags ?? []).map(flag => ({ label: flag.flag, description: flag.description, kind: 'option' as const }));
    return {
      executable: active.executable,
      path: [],
      title: catalog.title,
      description: catalog.description,
      signature: active.executable + ' [argumentos]',
      options,
      usedOptions: usedOptions(options, active.words),
      snippet: source.slice(active.from, active.to),
      subcommands: [],
      source: 'catalog',
    };
  }

  const last = active.arguments.at(-1);
  const editingLast = !!last && last.from <= cursor && cursor <= last.to;
  const words = editingLast ? active.words.slice(0, -1) : active.words;
  const scope = resolveScope(root, words);
  const title = [active.executable, ...scope.path].join(' ');

  return {
    executable: active.executable,
    path: scope.path,
    title,
    description: scope.current.description || root.description,
    signature: signature(active.executable, scope),
    current: currentItem(active, cursor, scope),
    options: dedupOptions(scope.scopes),
    usedOptions: usedOptions(dedupOptions(scope.scopes), active.words),
    snippet: source.slice(active.from, active.to),
    subcommands: Object.entries(scope.current.subcommands ?? {}).map(([name, child]) => ({
      label: name,
      description: child.description,
      kind: 'subcommand' as const,
    })),
    source: 'cli-spec',
  };
}

export async function commandHelp(source: string, cursor: number): Promise<CommandHelpModel | null> {
  return commandHelpFromActive(await activeShellCommand(source, cursor), cursor, source);
}
