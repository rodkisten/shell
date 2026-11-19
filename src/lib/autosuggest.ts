import { COMMANDS } from './commands';
import { cliCompletions, cliValueRequest } from './cli-completions';
import { valueCompletions } from './completion-values';
import { activeShellCommand, type ActiveShellCommand } from './shell-command-ast';
import { getEntries } from './storage';

export type Autosuggestion = {
  from: number;
  insert: string;
  source: 'history' | 'command' | 'subcommand' | 'option' | 'value';
  label: string;
};

let historyCache: { expires: number; lines: string[] } | null = null;

async function recentHistoryLines(): Promise<string[]> {
  if (historyCache && historyCache.expires > Date.now()) return historyCache.lines;
  try {
    const entries = await getEntries();
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const entry of entries.slice(0, 60)) {
      for (const line of entry.script.split(/\r?\n/)) {
        const value = line.trimEnd();
        if (!value.trim() || seen.has(value)) continue;
        seen.add(value);
        lines.push(value);
        if (lines.length >= 120) break;
      }
      if (lines.length >= 120) break;
    }
    historyCache = { expires: Date.now() + 4_000, lines };
    return lines;
  } catch {
    return [];
  }
}

function currentLine(source: string, cursor: number) {
  const from = source.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  return { from, prefix: source.slice(from, cursor) };
}

function previousDraftLines(source: string, lineFrom: number): string[] {
  return source
    .slice(0, lineFrom)
    .split(/\r?\n/)
    .reverse()
    .map(line => line.trimEnd())
    .filter(Boolean);
}

function asSuggestion(
  cursor: number,
  needle: string,
  label: string,
  source: Autosuggestion['source'],
): Autosuggestion | null {
  if (!needle || !label.startsWith(needle) || label.length <= needle.length) return null;
  const insert = label.slice(needle.length);
  return insert ? { from: cursor, insert, source, label } : null;
}

function activeNeedle(active: ActiveShellCommand, cursor: number): string {
  if (cursor <= active.executableTo) return active.executable;
  const last = active.arguments.at(-1);
  return last && last.from <= cursor && cursor <= last.to ? last.text : '';
}

/**
 * Shell-like autosuggestion. History wins, then dynamic values and finally
 * deterministic CLI metadata. No network requests and no generative guessing.
 */
export async function shellAutosuggestion(source: string, cursor: number): Promise<Autosuggestion | null> {
  if (cursor < 0 || cursor > source.length) return null;
  // Never paint through text to the right of the caret.
  if (cursor < source.length && /[^\s;|&)]/.test(source[cursor] ?? '')) return null;

  const line = currentLine(source, cursor);
  if (line.prefix.trim()) {
    const local = previousDraftLines(source, line.from)
      .find(candidate => candidate.startsWith(line.prefix) && candidate.length > line.prefix.length);
    if (local) {
      return {
        from: cursor,
        insert: local.slice(line.prefix.length),
        source: 'history',
        label: local,
      };
    }

    const stored = (await recentHistoryLines())
      .find(candidate => candidate.startsWith(line.prefix) && candidate.length > line.prefix.length);
    if (stored) {
      return {
        from: cursor,
        insert: stored.slice(line.prefix.length),
        source: 'history',
        label: stored,
      };
    }
  }

  const active = await activeShellCommand(source, cursor);
  if (!active) return null;

  const needle = activeNeedle(active, cursor);
  if (cursor <= active.executableTo) {
    const command = COMMANDS.find(item =>
      item.name.startsWith(needle) && item.name !== needle
    );
    return command ? asSuggestion(cursor, needle, command.name, 'command') : null;
  }

  // Empty-token guesses such as picking an arbitrary git subcommand are noisy.
  // History may suggest after a space, metadata waits until the user gives us
  // at least one character of intent.
  if (!needle) return null;

  const values = await valueCompletions(cliValueRequest(active, cursor));
  const value = values.find(item => item.label.startsWith(needle) && item.label !== needle);
  if (value) return asSuggestion(cursor, needle, value.label, 'value');

  const cli = cliCompletions(active, cursor)
    .find(item => item.label.startsWith(needle) && item.label !== needle);
  if (cli) {
    return asSuggestion(
      cursor,
      needle,
      cli.label,
      cli.kind === 'subcommand' ? 'subcommand' : 'option',
    );
  }

  return null;
}
