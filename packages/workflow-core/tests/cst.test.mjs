import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';
import { patchWorkflowFields, connectStepOutput, importLegacyWorkflow, parseWorkflow } from '../dist/index.js';
const source = `# UTF-16: 🪐
name: 'Deploy' # keep title
on: workflow_dispatch
permissions: {contents: read}
jobs:
  build:
    runs-on: ubuntu-latest
    strategy: {matrix: {node: [20, 22]}}
    steps:
      - uses: actions/cache@v4 # cache comment
        with:
          path: old # input comment
          key: stable
        env: {CUSTOM: keep}
      - uses: actions/upload-artifact@v4
        with:
          name: keep-name
  verify:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo verify
`;
test('field patches preserve all unrelated bytes and inline comments', () => {
  const result = patchWorkflowFields(source, ['jobs', 'build', 'steps', 0], { with: { path: 'new' } });
  assert.equal(result.yaml, source.replace('path: old # input comment', 'path: "new" # input comment'));
  assert.equal(result.valid, true);
});
test('wiring creates a stable source id, merges the target input and preserves unknown fields', () => {
  const result = connectStepOutput(source, 'build', 0, 'cache-hit', 1, 'path');
  const data = parseDocument(result.yaml).toJS();
  assert.equal(data.jobs.build.steps[0].id, 'step_1');
  assert.equal(data.jobs.build.steps[1].with.path, '${{ steps.step_1.outputs.cache-hit }}');
  assert.equal(data.jobs.build.steps[1].with.name, 'keep-name');
  assert.deepEqual(data.jobs.build.steps[0].env, { CUSTOM: 'keep' });
  assert.ok(result.yaml.includes('# cache comment'));
  assert.ok(result.yaml.includes('strategy: {matrix: {node: [20, 22]}}'));
  assert.ok(result.yaml.endsWith(source.slice(source.indexOf('  verify:'))));
});
test('invalid backward and script-input connections fail closed', () => {
  assert.throws(() => connectStepOutput(source, 'build', 1, 'out', 0, 'in'));
  assert.throws(() => connectStepOutput(source, 'verify', 0, 'out', 1, 'in'));
});
test('new field names are serialized as keys, never executable YAML structure', () => {
  const result = patchWorkflowFields(source, ['jobs', 'build', 'steps', 1], { 'strange:\nfield': 'value' });
  assert.equal(parseDocument(result.yaml).getIn(['jobs', 'build', 'steps', 1, 'strange:\nfield']), 'value');
});
test('legacy migration keeps comments, job fields and unknown step fields', () => {
  const data = parseDocument(source).toJS();
  const model = {
    name: 'Deploy',
    source,
    jobId: 'build',
    steps: data.jobs.build.steps.map((step, index) => ({
      ...step,
      id: 'step_' + (index + 1),
      name: 'Step ' + index,
      contract: { inputs: [] },
    })),
  };
  model.steps[0].with.path = 'new';
  const before = JSON.stringify(model);
  const migrated = importLegacyWorkflow(model),
    parsed = parseDocument(migrated).toJS();
  assert.equal(JSON.stringify(model), before);
  assert.deepEqual(parsed.jobs.verify, data.jobs.verify);
  assert.deepEqual(parsed.permissions, data.permissions);
  assert.deepEqual(parsed.jobs.build.strategy, data.jobs.build.strategy);
  assert.deepEqual(parsed.jobs.build.steps[0].env, { CUSTOM: 'keep' });
  assert.equal(parsed.jobs.build.steps[0].contract, undefined);
  assert.ok(migrated.includes('# cache comment'));
  assert.equal(parseWorkflow(migrated).valid, true);
});
test('no invented document for an empty legacy draft', () =>
  assert.equal(importLegacyWorkflow({ name: 'Build', steps: [] }), null));
