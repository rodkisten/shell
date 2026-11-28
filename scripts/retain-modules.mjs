/** Retain two prior builds from this deployment lane, never PR artifacts in main. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.MODULE_SHA;
const lane = process.env.PR_NUMBER ? `pr${process.env.PR_NUMBER}` : 'main';
if (
  !repository ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
  !/^[a-f0-9]{40}$/.test(sha || '') ||
  !/^(main|pr[1-9]\d*)$/.test(lane)
)
  throw new Error('Invalid retention context');
const prefix = `code-${lane}-module-`;
const { artifacts } = JSON.parse(
  execFileSync('gh', ['api', `repos/${repository}/actions/artifacts?per_page=100`], { encoding: 'utf8' }),
);
const previous = artifacts
  .filter(
    (a) =>
      !a.expired &&
      a.name.startsWith(prefix) &&
      /^[a-f0-9]{40}$/.test(a.name.slice(prefix.length)) &&
      !a.name.endsWith(sha),
  )
  .slice(0, 2);
for (const artifact of previous) {
  const oldSha = artifact.name.slice(prefix.length);
  const temp = mkdtempSync(join(tmpdir(), 'code-module-'));
  try {
    const bytes = execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], {
      maxBuffer: 100 * 1024 * 1024,
    });
    const { writeFileSync } = await import('node:fs');
    const zip = join(temp, 'module.zip');
    writeFileSync(zip, bytes);
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    if (
      entries.length > 500 ||
      entries.some((name) => !name.startsWith(`code/${oldSha}/`) || name.includes('..') || name.includes('\\'))
    )
      throw new Error('Unexpected module archive path');
    execFileSync('unzip', ['-q', zip, '-d', join(temp, 'extracted')]);
    const source = join(temp, 'extracted', 'code', oldSha);
    let total = 0;
    function inspect(dir) {
      for (const entry of readdirSync(dir)) {
        const file = join(dir, entry),
          stat = lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
          throw new Error('Unsafe archive entry');
        if (stat.isDirectory()) inspect(file);
        else total += stat.size;
      }
    }
    inspect(source);
    if (total > 100 * 1024 * 1024) throw new Error('Module archive too large');
    const manifest = JSON.parse(readFileSync(join(source, 'rod-module.json'), 'utf8'));
    if (manifest.gitSha !== oldSha || manifest.id !== 'code') throw new Error('Archive SHA mismatch');
    mkdirSync('dist/client/modules/code', { recursive: true });
    cpSync(source, `dist/client/modules/code/${oldSha}`, { recursive: true });
    console.log(`Retained module ${oldSha} from ${lane}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
