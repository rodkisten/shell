import { byName, COMMANDS } from './commands';
import { activeShellCommand, type ActiveShellCommand } from './shell-command-ast';
import { cliCompletions } from './cli-completions';

export type Hint = {
  label: string;
  title: string;
  description: string;
  example: string;
  kind: 'command' | 'flag';
};

function commandHints(query: string): Hint[] {
  const normalized = query.toLowerCase();
  return COMMANDS
    .filter(cmd => !normalized || cmd.name.startsWith(normalized) || cmd.title.toLowerCase().includes(normalized))
    .sort((a, b) => Number(b.name === normalized) - Number(a.name === normalized))
    .slice(0, 8)
    .map(cmd => ({
      label: cmd.name,
      title: cmd.title,
      description: cmd.description,
      example: cmd.example,
      kind: 'command' as const,
    }));
}

/**
 * Build hints from an already parsed command context. No pipeline splitting,
 * quote matching or shell tokenization happens here.
 */
export function contextualHintsFromActive(active: ActiveShellCommand | null, cursor: number): Hint[] {
  if (!active) return commandHints('');

  const entry = byName.get(active.executable);
  const editingExecutable = cursor <= active.executableTo;
  if (editingExecutable) return commandHints(active.executable);

  const completions = cliCompletions(active, cursor);
  if (completions.length) {
    return completions.slice(0, 8).map(item => ({
      label: item.label,
      title: item.kind === 'subcommand'
        ? active.executable + ' ' + item.label
        : active.executable + ' ' + item.label,
      description: item.description,
      example: item.kind === 'subcommand'
        ? active.executable + ' ' + item.label
        : active.executable + ' ' + item.label + (item.takesValue ? ' …' : ''),
      kind: item.kind === 'option' ? 'flag' as const : 'command' as const,
    }));
  }

  if (!entry) return commandHints(active.executable);
  return [];
}

/**
 * Parse the real shell AST and derive contextual suggestions from the active
 * CallExpr. Parser failures fail closed to the command catalog rather than
 * guessing shell structure with regexes.
 */
export async function contextualHints(code: string, cursor: number): Promise<Hint[]> {
  const active = await activeShellCommand(code, cursor);
  return contextualHintsFromActive(active, cursor);
}
