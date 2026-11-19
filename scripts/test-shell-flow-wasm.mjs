import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';

const root = new URL('../public/wasm/', import.meta.url);
await import(pathToFileURL(new URL('wasm_exec.js', root).pathname).href);
const go = new globalThis.Go();
const wasm = await readFile(new URL('shell-flow.wasm', root));
const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
void go.run(instance);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(typeof globalThis.shellFlowAnalyze, 'function');

function analyze(source) {
  const result = JSON.parse(globalThis.shellFlowAnalyze(source));
  assert.equal(result.error, undefined, JSON.stringify(result));
  return result;
}
function hasEdge(result, kind) {
  return result.edges.some(edge => edge.kind === kind);
}
for (const [source, required] of [
  ['echo a; echo b', ['next']],
  ['true && echo yes; echo after', ['true', 'false']],
  ['false || echo fallback; echo after', ['false', 'true']],
  ['echo a | cat', ['pipeline']],
  ['if true; then echo yes; else echo no; fi; echo done', ['true', 'false']],
  ['if true; then echo a; elif false; then echo b; else echo c; fi', ['true', 'false']],
]) {
  const result = analyze(source);
  for (const kind of required) {
    assert.ok(hasEdge(result, kind), `Missing ${kind} for ${source}: ${JSON.stringify(result)}`);
  }
  console.log('PASS', source);
}
const invalid = JSON.parse(globalThis.shellFlowAnalyze('if then'));
assert.ok(invalid.error, 'Invalid syntax must return an error');
console.log('WASM smoke tests passed');
