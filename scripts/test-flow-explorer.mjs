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
  assert.match(explorer, /new TextEncoder\(\)\.encode\(character\)/);
  assert.match(explorer, /utf16 \+= character\.length/);
  assert.match(explorer, /const from = offset\(node\.start\)/);
  assert.match(explorer, /const to = offset\(node\.end\)/);
  assert.match(explorer, /onReveal\?\.\(from, to\)/);
  assert.match(explorer, /aria-pressed=\{selectedFlowId === node\.id\}/);
});

test('WASM graph is explicitly static and exposes status and errors', () => {
  assert.match(explorer, /análise estática/);
  assert.match(explorer, /flowStatus\?\.state === 'loading'/);
  assert.match(explorer, /flowError/);
});

test('dock supports pointer and keyboard resizing with persisted size', () => {
  assert.match(app, /aria-label="Redimensionar explorador"/);
  assert.match(app, /onPointerDown=\{dockCollapsed \? undefined : resizeDock\}/);
  assert.match(app, /onKeyDown=\{handleDockResizerKeyDown\}/);
  assert.match(app, /onPointerMove=\{moveDock\}/);
  assert.match(app, /setPointerCapture\(event.pointerId\)/);
  assert.match(app, /shellconductor:dock-size/);
  assert.match(css, /touch-action:none/);
});
test('explorer is rendered outside scrollable editor route', () => {
  assert.ok(app.indexOf('className="explorer-dock-resizer"') > app.indexOf('</Routes>'));
  assert.match(app, /cursorOffset=\{followContext \? cursor : undefined\}/);
});
