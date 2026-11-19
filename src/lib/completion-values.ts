import { readCompletionContext, type ShellCompletionContext } from './terminal';
import type { CliValueRequest } from './cli-completions';

export type ValueCompletion = {
  label: string;
  detail: string;
  info: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function valueCompletions(request: CliValueRequest | null): Promise<ValueCompletion[]> {
  if (!request) return [];

  let values = request.values ?? [];
  let sourceLabel = 'CLI spec';

  if (request.valueSource) {
    const context: ShellCompletionContext = await readCompletionContext();
    if (request.valueSource === 'npm-script') {
      values = context.npmScripts;
      sourceLabel = 'package.json · scripts';
    } else if (request.valueSource === 'npm-workspace') {
      values = context.npmWorkspaces;
      sourceLabel = 'package.json · workspaces';
    } else if (request.valueSource === 'git-branch') {
      values = context.gitBranches;
      sourceLabel = '.git · branches';
    }
  }

  return unique(values)
    .filter(value => !request.needle || value.startsWith(request.needle))
    .slice(0, 40)
    .map(value => ({
      label: value,
      detail: sourceLabel,
      info: request.label + ': ' + value,
    }));
}
