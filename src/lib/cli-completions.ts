import type { ActiveShellCommand } from './shell-command-ast';
import { cliSpecs, type CliOption, type CliSpec, type CliValueSource, type CliValueSpec } from './cli-specs';
import { fromFigWordsContext, type CompletionItem } from './completion-sources';
import figCurl from './specs/fig-curl.json';
import figDocker from './specs/fig-docker.json';
import figNpm from './specs/fig-npm.json';

export type CliCompletion = {
  label: string;
  description: string;
  kind: 'subcommand' | 'option';
  source: 'fig' | 'cli-spec';
  detail: string;
  takesValue?: boolean;
};

const figSpecs: Record<string, unknown> = {
  curl: figCurl,
  docker: figDocker,
  npm: figNpm,
};

type CompletionCursor = {
  completedWords: string[];
  needle: string;
  positionalOnly: boolean;
};

function completionCursor(active: ActiveShellCommand, cursor: number): CompletionCursor {
  const last = active.arguments.at(-1);
  const editingLast = !!last && last.from <= cursor && cursor <= last.to;
  const completedWords = editingLast ? active.words.slice(0, -1) : [...active.words];
  const needle = editingLast ? last.text : '';
  return {
    completedWords,
    needle,
    positionalOnly: completedWords.includes('--'),
  };
}

function optionByName(spec: CliSpec, name: string): CliOption | undefined {
  return spec.options?.find(option => option.names.includes(name));
}

function resolveSpec(root: CliSpec, words: readonly string[]) {
  const scopes: CliSpec[] = [root];
  let current = root;
  let awaitingValue = false;
  let awaitingOption: CliOption | undefined;
  let positionalOnly = false;
  let positionalIndex = 0;

  for (const word of words) {
    if (awaitingValue) {
      awaitingValue = false;
      awaitingOption = undefined;
      continue;
    }
    if (word === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && word.startsWith('-')) {
      const name = word.split('=', 1)[0];
      const option = [...scopes].reverse()
        .map(scope => optionByName(scope, name))
        .find(Boolean);
      awaitingValue = Boolean(option?.takesValue && !word.includes('='));
      awaitingOption = awaitingValue ? option : undefined;
      continue;
    }
    if (positionalOnly) continue;
    const next = current.subcommands?.[word];
    if (next) {
      current = next;
      scopes.push(next);
      positionalIndex = 0;
      continue;
    }
    positionalIndex++;
  }

  return { current, scopes, awaitingValue, awaitingOption, positionalOnly, positionalIndex };
}

function fromCliSpec(executable: string, words: readonly string[]): CliCompletion[] {
  const root = cliSpecs[executable];
  if (!root) return [];
  const { current, scopes, awaitingValue, positionalOnly } = resolveSpec(root, words);
  if (awaitingValue || positionalOnly) return [];

  const output: CliCompletion[] = [];
  for (const [name, subcommand] of Object.entries(current.subcommands ?? {})) {
    output.push({
      label: name,
      description: subcommand.description,
      kind: 'subcommand',
      source: 'cli-spec',
      detail: executable + ' · subcommand',
    });
  }

  const seenOptions = new Set<string>();
  for (const scope of scopes) {
    for (const option of scope.options ?? []) {
      for (const name of option.names) {
        if (seenOptions.has(name)) continue;
        seenOptions.add(name);
        output.push({
          label: name,
          description: option.description,
          kind: 'option',
          source: 'cli-spec',
          detail: executable + ' · opção',
          ...(option.takesValue ? { takesValue: true } : {}),
        });
      }
    }
  }
  return output;
}

function fromFigSpec(executable: string, words: readonly string[]): { items: CliCompletion[]; awaitingValue: boolean; positionalOnly: boolean } {
  const spec = figSpecs[executable];
  if (!spec) return { items: [], awaitingValue: false, positionalOnly: false };
  const context = fromFigWordsContext(spec, words);
  return {
    awaitingValue: context.awaitingValue,
    positionalOnly: context.positionalOnly,
    items: context.items
    .filter((item): item is CompletionItem & { kind: 'subcommand' | 'option' } =>
      item.kind === 'subcommand' || item.kind === 'option'
    )
    .map(item => ({
      label: item.name,
      description: item.description,
      kind: item.kind,
      source: 'fig' as const,
      detail: 'Fig · ' + executable,
      ...(item.takesValue ? { takesValue: true } : {}),
    })),
  };
}

export function cliCompletions(
  active: ActiveShellCommand | null,
  cursor: number,
): CliCompletion[] {
  if (!active || cursor <= active.executableTo) return [];
  const { completedWords, needle, positionalOnly } = completionCursor(active, cursor);
  if (positionalOnly) return [];

  const rootSpec = cliSpecs[active.executable];
  const localState = rootSpec ? resolveSpec(rootSpec, completedWords) : undefined;
  const figState = fromFigSpec(active.executable, completedWords);
  if (localState?.awaitingValue || figState.awaitingValue || figState.positionalOnly) return [];

  const merged = new Map<string, CliCompletion>();
  const candidates = [
    ...fromCliSpec(active.executable, completedWords),
    ...figState.items,
  ];

  for (const candidate of candidates) {
    if (needle.startsWith('-') && candidate.kind !== 'option') continue;
    if (needle && !candidate.label.startsWith(needle)) continue;
    const key = candidate.kind + ':' + candidate.label;
    const previous = merged.get(key);
    if (!previous || candidate.source === 'fig') {
      merged.set(key, previous && candidate.source === 'fig'
        ? {
            ...candidate,
            detail: previous.source === 'cli-spec'
              ? candidate.detail + ' + local'
              : candidate.detail,
            description: candidate.description || previous.description,
            takesValue: candidate.takesValue ?? previous.takesValue,
          }
        : candidate);
    }
  }

  return [...merged.values()].sort((a, b) => {
    const kind = Number(a.kind === 'option') - Number(b.kind === 'option');
    if (kind) return kind;
    const exact = Number(b.label === needle) - Number(a.label === needle);
    return exact || a.label.localeCompare(b.label);
  });
}


export type CliValueRequest = {
  label: string;
  needle: string;
  values?: string[];
  valueSource?: CliValueSource;
};

function positionalSpec(spec: CliSpec, index: number): CliValueSpec | undefined {
  const values = spec.positionals ?? [];
  if (!values.length) return undefined;
  const raw = values[Math.min(index, values.length - 1)];
  return typeof raw === 'string' ? { name: raw } : raw;
}

export function cliValueRequest(
  active: ActiveShellCommand | null,
  cursor: number,
): CliValueRequest | null {
  if (!active || cursor <= active.executableTo) return null;
  const root = cliSpecs[active.executable];
  if (!root) return null;

  const { completedWords, needle, positionalOnly } = completionCursor(active, cursor);
  if (positionalOnly) return null;
  const state = resolveSpec(root, completedWords);

  if (state.awaitingOption) {
    return {
      label: state.awaitingOption.names.at(-1) ?? state.awaitingOption.names[0] ?? 'Valor',
      needle,
      values: state.awaitingOption.values,
      valueSource: state.awaitingOption.valueSource,
    };
  }

  const positional = positionalSpec(state.current, state.positionalIndex);
  if (!positional || (!positional.values?.length && !positional.valueSource)) return null;
  return {
    label: positional.name,
    needle,
    values: positional.values,
    valueSource: positional.valueSource,
  };
}
