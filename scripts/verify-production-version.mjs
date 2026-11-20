#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const url = process.env.SHELL_VERSION_URL || 'https://shell.migos.club/api/version';
const expected = process.env.EXPECTED_SHA || (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
})();
const retries = Math.max(1, Math.min(30, Number(process.env.VERSION_RETRIES || 12)));
const delay = Math.max(1000, Math.min(30000, Number(process.env.VERSION_DELAY_MS || 5000)));
if (!/^[a-f0-9]{40}$/i.test(expected)) {
  console.error('EXPECTED_SHA must be a complete 40-character Git SHA.');
  process.exit(2);
}
if (!/^https:\/\//.test(url)) {
  console.error('SHELL_VERSION_URL must be HTTPS.');
  process.exit(2);
}
let lastError = '';
for (let attempt = 1; attempt <= retries; attempt++) {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const info = await response.json();
    if (!info || typeof info.sha !== 'string') throw new Error('Missing version.sha');
    if (info.sha === expected) {
      console.log('Production verified: ' + info.sha + ' (' + info.builtAt + ')');
      process.exit(0);
    }
    lastError = 'Expected ' + expected + ', received ' + info.sha;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  console.error('Attempt ' + attempt + '/' + retries + ': ' + lastError);
  if (attempt < retries) await new Promise(resolve => setTimeout(resolve, delay));
}
console.error('Production version verification failed: ' + lastError);
process.exit(1);
