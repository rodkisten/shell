import { byName, COMMANDS } from './commands';
export type Hint = { label: string; title: string; description: string; example: string; kind: 'command' | 'flag' };

export function contextualHints(code: string, cursor: number): Hint[] {
  const line = code.slice(0, cursor).split('\n').pop() || '';
  const segment = line.split(/(?:\|\||&&|[|;&])/).pop() || '';
  const text = segment.trimStart();
  const chunks = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const command = chunks[0];
  const trailingSpace = /\s$/.test(text);
  if (command && (chunks.length > 1 || trailingSpace)) {
    const entry = byName.get(command);
    if (entry) {
      const needle = trailingSpace ? '' : (chunks[chunks.length - 1] || '');
      return (entry.flags || []).filter((flag) => !needle || flag.flag.startsWith(needle)).map((flag) => ({
        label: flag.flag, title: entry.name + ' ' + flag.flag, description: flag.description, example: flag.example, kind: 'flag' as const,
      })).slice(0, 8);
    }
  }
  const query = (chunks[0] || '').toLowerCase();
  return COMMANDS.filter((cmd) => !query || cmd.name.startsWith(query) || cmd.title.toLowerCase().includes(query))
    .sort((a,b) => Number(b.name === query) - Number(a.name === query))
    .slice(0, 8)
    .map((cmd) => ({ label: cmd.name, title: cmd.title, description: cmd.description, example: cmd.example, kind: 'command' as const }));
}
