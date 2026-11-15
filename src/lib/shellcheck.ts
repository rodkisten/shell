import { parse, LangVariant } from 'sh-syntax';
export type Finding = {
  line: number;
  endLine?: number;
  column: number;
  endColumn?: number;
  level: 'error' | 'warning' | 'info' | 'style';
  code: number;
  message: string;
  fix?: { replacements: Array<{ line: number; column: number; endLine: number; endColumn: number; replacement: string }> };
};
/**
 * Syntax-only validation. The upstream Zsh parser is experimental and does not
 * implement ShellCheck's semantic diagnostics. Never present Bash findings as
 * authoritative Zsh errors.
 */
export async function checkShell(script: string, signal?: AbortSignal): Promise<Finding[]> {
  if (!script.trim() || signal?.aborted) return [];
  try {
    await parse(script, { variant: LangVariant.LangZsh, keepComments: true });
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const location = /(?:^|:|\s)(\d+):(\d+)/.exec(message);
    return [{
      line: location ? Number(location[1]) : 1,
      column: location ? Number(location[2]) : 1,
      level: 'warning',
      code: 0,
      message: 'Parser experimental de Zsh: ' + message,
    }];
  }
}
function offset(text: string, line: number, column: number) {
  const lines = text.split('\n');
  return lines.slice(0, Math.max(0, line - 1)).reduce((sum, part) => sum + part.length + 1, 0) + column - 1;
}
export function applyAvailableFixes(script: string, findings: Finding[]) {
  const changes = findings.flatMap((finding) => finding.fix?.replacements || [])
    .map((r) => ({ from: offset(script, r.line, r.column), to: offset(script, r.endLine, r.endColumn), replacement: r.replacement }))
    .sort((a, b) => b.from - a.from);
  let fixed = script; let lastStart = Infinity; let count = 0;
  for (const change of changes) {
    if (change.to > lastStart || change.from < 0 || change.to > fixed.length) continue;
    fixed = fixed.slice(0, change.from) + change.replacement + fixed.slice(change.to);
    lastStart = change.from;
    count++;
  }
  return { code: fixed, count };
}
