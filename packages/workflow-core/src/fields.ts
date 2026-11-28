import { parseDocument, isMap, isScalar, isSeq, type YAMLMap } from 'yaml';
import { applySourcePatches, parseWorkflow, type SourcePatch } from './index.ts';
/** Merge only requested fields, preserving untouched source and comments verbatim. */
export function patchWorkflowFields(source: string, path: (string | number)[], fields: Record<string, unknown>) {
  const doc = parseDocument(source, { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length) throw Error('Invalid YAML');
  const parent = path.length ? doc.getIn(path, true) : doc.contents;
  if (!isMap(parent)) throw Error('Expected a workflow mapping');
  const patches: SourcePatch[] = [];
  function patch(map: YAMLMap, values: Record<string, unknown>) {
    if (map.anchor || map.tag) throw Error('Anchored mappings require manual editing');
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || ['__proto__', 'prototype', 'constructor'].includes(key))
        throw Error('Invalid field');
      const node = map.get(key, true);
      if (isMap(node) && value && typeof value === 'object' && !Array.isArray(value)) {
        patch(node, value as Record<string, unknown>);
        continue;
      }
      if (node) {
        if (!isScalar(node) || !node.range || node.anchor || node.tag)
          throw Error('Structured field replacement requires manual editing');
        const text = JSON.stringify(value);
        if (text === undefined) throw Error('Invalid value');
        patches.push({
          from: node.range[0],
          to: node.range[1],
          insert: text + (source[node.range[1] - 1] === '\n' ? '\n' : ''),
        });
      } else {
        const first = map.items[0]?.key;
        if (map.flow || !map.range || !isScalar(first) || !first.range)
          throw Error('Empty or flow mappings require manual editing');
        const line = source.lastIndexOf('\n', first.range[0] - 1) + 1;
        const indent = ' '.repeat(first.range[0] - line);
        const at = map.range[1];
        patches.push({
          from: at,
          to: at,
          insert:
            (source[at - 1] === '\n' ? '' : '\n') +
            indent +
            JSON.stringify(key) +
            ': ' +
            JSON.stringify(value) +
            '\n',
        });
      }
    }
  }
  patch(parent, fields);
  const yaml = applySourcePatches(source, patches),
    result = parseWorkflow(yaml);
  if (!result.valid) throw Error('Edit would produce invalid workflow');
  return { ...result, yaml, patches };
}
export function connectStepOutput(
  source: string,
  job: string,
  from: number,
  output: string,
  to: number,
  input: string,
) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to <= from ||
    !/^[-\w]+$/.test(input) ||
    !/^[-\w]+$/.test(output)
  )
    throw Error('Outputs must connect an earlier step to a later action input');
  const doc = parseDocument(source, { uniqueKeys: true });
  const steps = doc.getIn(['jobs', job, 'steps'], true);
  if (
    doc.errors.length ||
    !isSeq(steps) ||
    !isMap(steps.items[from]) ||
    !isMap(steps.items[to]) ||
    !steps.items[to].has('uses')
  )
    throw Error('Invalid action connection');
  let id = steps.items[from].get('id');
  let yaml = source;
  if (!id) {
    const ids = new Set(steps.items.filter(isMap).map((step) => step.get('id')));
    id = 'step_' + (from + 1);
    while (ids.has(id)) id = String(id) + '_';
    yaml = patchWorkflowFields(yaml, ['jobs', job, 'steps', from], { id }).yaml;
  }
  if (typeof id !== 'string' || !/^[A-Za-z_][\w-]*$/.test(id)) throw Error('Invalid source step ID');
  return patchWorkflowFields(yaml, ['jobs', job, 'steps', to], {
    with: { [input]: '${{ steps.' + id + '.outputs.' + output + ' }}' },
  });
}
