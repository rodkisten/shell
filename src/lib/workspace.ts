import { executeScript } from './terminal';

export type WorkspaceEntry = { name: string; directory: boolean };
const ROOT = '/home/user';

function quote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function workspacePath(directory: string, name = '') {
  const parts = (directory + '/' + name).split('/').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (!stack.length) throw new Error('Caminho fora do workspace.');
      stack.pop();
      continue;
    }
    if (part.includes('\\0') || part.includes('\\') || part === '~') throw new Error('Caminho inválido.');
    stack.push(part);
  }
  return ROOT + (stack.length ? '/' + stack.join('/') : '');
}

async function run(script: string) {
  const result = await executeScript(script);
  if (!result.ok || result.exitCode !== 0) {
    throw new Error(result.stderr || 'Não foi possível acessar o workspace.');
  }
  return result.stdout;
}

export async function listWorkspace(directory = ''): Promise<WorkspaceEntry[]> {
  const stdout = await run('cd ' + quote(workspacePath(directory)) + ' && ls -1Ap');
  return stdout.split('\n').filter(Boolean).map(line => ({
    name: line.endsWith('/') ? line.slice(0, -1) : line,
    directory: line.endsWith('/'),
  })).filter(item => item.name !== '.' && item.name !== '..');
}

export function readWorkspaceFile(name: string, directory = '') {
  return run('cat -- ' + quote(workspacePath(directory, name)));
}

export async function saveWorkspaceFile(name: string, contents: string, directory = '') {
  const path = workspacePath(directory, name);
  const bytes = new TextEncoder().encode(contents);
  if (bytes.length > 32_000) throw new Error('Arquivo maior que 32 KB. Use o terminal para arquivos maiores.');
  const escaped = Array.from(bytes, b => '\\' + b.toString(8).padStart(3, '0')).join('');
  await run('printf %b ' + quote(escaped) + ' > ' + quote(path));
}

export async function createWorkspaceDirectory(name: string, directory = '') {
  await run('mkdir -- ' + quote(workspacePath(directory, name)));
}

export async function deleteWorkspaceEntry(name: string, directory: boolean, parent = '') {
  await run((directory ? 'rmdir -- ' : 'rm -- ') + quote(workspacePath(parent, name)));
}
