import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const explorer = readFileSync(new URL('../src/components/ExecutionExplorer.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/execution-explorer.css', import.meta.url), 'utf8');

test('editor exposes dedicated mobile command toolbar', () => {
  assert.match(app, /aria-label="Ferramentas do editor"/);
  for (const label of ['Executar', 'Formatar', 'Validar', 'Explicar', 'Fluxo']) {
    assert.match(app, new RegExp('>\\s*' + label + '<'));
  }
  assert.match(css, /\.editor-command-toolbar\{[^}]*overflow-x:auto/);
});

test('analysis tabs remain keyboard-accessible', () => {
  assert.match(app, /role="tablist"/);
  assert.match(app, /role="tab"/);
  assert.match(app, /aria-selected=\{explorerTab === tab\}/);
});

test('flow nodes reveal UTF-8 offsets in CodeMirror and expose selection', () => {
  assert.match(explorer, /new TextEncoder\(\)\.encode\(source\)/);
  assert.match(explorer, /new TextDecoder\(\)\.decode\(utf8\.slice\(0, position\)\)\.length/);
  assert.match(explorer, /onReveal\?\.\(from, to\)/);
  assert.match(explorer, /aria-pressed=\{selectedFlowId === node\.id\}/);
});

test('WASM graph is explicitly static and exposes status and errors', () => {
  assert.match(explorer, /análise estática/);
  assert.match(explorer, /flowStatus\?\.state === 'loading'/);
  assert.match(explorer, /flowError/);
});
