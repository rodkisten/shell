import { executeScript } from './terminal';

export type WorkspaceEntry = { name: string; directory: boolean };

function quote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function pathOf(name: string) {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\0')) {
    throw new Error('Nome de arquivo inválido.');
  }
  return '/home/user/' + name;
}

async function run(script: string) {
  const result = await executeScript(script);
  if (!result.ok || result.exitCode !== 0) {
    throw new Error(result.stderr || 'Não foi possível acessar o workspace.');
  }
  return result.stdout;
}

export async function listWorkspace(): Promise<WorkspaceEntry[]> {
  const stdout = await run("cd /home/user && ls -1Ap");
  return stdout.split('\n').filter(Boolean).map(line => ({
    name: line.endsWith('/') ? line.slice(0, -1) : line,
    directory: line.endsWith('/'),
  })).filter(item => item.name !== '.' && item.name !== '..');
}

export function readWorkspaceFile(name: string) {
  return run('cat -- ' + quote(pathOf(name)));
}

export async function saveWorkspaceFile(name: string, contents: string) {
  const path = pathOf(name);
  // Pass the file contents as stdin so user data never becomes executable shell code.
  // executeScript currently accepts only scripts, so encode via safe per-byte octal escapes.
  const bytes = new TextEncoder().encode(contents);
  if (bytes.length > 32_000) throw new Error('Arquivo maior que 32 KB. Use o terminal para arquivos maiores.');
  const escaped = Array.from(bytes, b => '\\' + b.toString(8).padStart(3, '0')).join('');
  await run('printf %b ' + quote(escaped) + ' > ' + quote(path));
}

export async function createWorkspaceDirectory(name: string) {
  await run('mkdir -- ' + quote(pathOf(name)));
}

export async function deleteWorkspaceEntry(name: string, directory: boolean) {
  await run((directory ? 'rmdir -- ' : 'rm -- ') + quote(pathOf(name)));
}
