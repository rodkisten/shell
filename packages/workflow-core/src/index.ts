import { parseDocument, isMap, isSeq, isScalar, isAlias } from 'yaml';
export { validateWorkflow } from './validate.ts';
export { inspectWorkflow } from './inspect.ts';
import { inspectWorkflow } from './inspect.ts';

export type SourceRange = { from: number; to: number };
export type SyntaxNode = {
  path: (string | number)[];
  kind: string;
  range: SourceRange | null;
};
export type SourcePatch = { from: number; to: number; insert: string };
export function parseWorkflow(source: string) {
  const doc = parseDocument(source, {
    version: '1.2',
    uniqueKeys: true,
    keepSourceTokens: true,
  });
  const nodes: SyntaxNode[] = [];
  function walk(node: unknown, path: (string | number)[], depth: number) {
    if (depth > 100 || nodes.length >= 20000) return;
    if (!isMap(node) && !isSeq(node) && !isScalar(node) && !isAlias(node)) return;
    nodes.push({
      path,
      kind: isMap(node) ? 'map' : isSeq(node) ? 'sequence' : isAlias(node) ? 'alias' : 'scalar',
      range: node.range ? { from: node.range[0], to: node.range[1] } : null,
    });
    if (isMap(node))
      for (const pair of node.items) {
        if (isScalar(pair.key) && typeof pair.key.value === 'string')
          walk(pair.value, [...path, pair.key.value], depth + 1);
      }
    if (isSeq(node)) node.items.forEach((child, i) => walk(child, [...path, i], depth + 1));
  }
  walk(doc.contents, [], 0);
  return {
    ...inspectWorkflow(source),
    nodes,
    offsetEncoding: 'utf-16' as const,
    truncated: nodes.length >= 20000,
  };
}
export function applySourcePatches(source: string, patches: SourcePatch[]) {
  const ordered = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  let cursor = 0,
    result = '';
  for (const p of ordered) {
    if (
      !Number.isSafeInteger(p.from) ||
      !Number.isSafeInteger(p.to) ||
      p.from < cursor ||
      p.to < p.from ||
      p.to > source.length
    )
      throw Error('Invalid or overlapping source patch');
    result += source.slice(cursor, p.from) + p.insert;
    cursor = p.to;
  }
  return result + source.slice(cursor);
}
export function replaceScalar(source: string, path: (string | number)[], value: string) {
  const doc = parseDocument(source, {
    version: '1.2',
    uniqueKeys: true,
    keepSourceTokens: true,
  });
  if (doc.errors.length) throw Error('Invalid source YAML');
  const node = doc.getIn(path, true);
  if (
    !isScalar(node) ||
    !node.range ||
    typeof node.value !== 'string' ||
    node.type === 'BLOCK_LITERAL' ||
    node.type === 'BLOCK_FOLDED' ||
    node.anchor ||
    node.tag
  )
    throw Error('Only untagged inline string scalars are supported');
  const patch = {
    from: node.range[0],
    to: node.range[1],
    insert: JSON.stringify(value),
  };
  const yaml = applySourcePatches(source, [patch]);
  const result = parseWorkflow(yaml);
  return { yaml, patches: [patch], ...result };
}

export * from './adapters.ts';

export function editJobNeeds(source: string, id: string, needs: string[]) {
  const doc = parseDocument(source, {
    version: '1.2',
    uniqueKeys: true,
    keepSourceTokens: true,
  });
  if (doc.errors.length) throw Error('Invalid source YAML');
  const job = doc.getIn(['jobs', id], true);
  if (!isMap(job) || job.flow || job.anchor || job.tag) throw Error('Only plain block jobs are supported');
  const existing = job.get('needs', true);
  const unique = [...new Set(needs)];
  if (unique.includes(id) || unique.some((n) => !isMap(doc.getIn(['jobs', n], true))))
    throw Error('Invalid dependency');
  const insert = JSON.stringify(unique);
  let patch: SourcePatch;
  if (existing !== undefined) {
    if (
      (!isScalar(existing) && !isSeq(existing)) ||
      !existing.range ||
      existing.anchor ||
      existing.tag ||
      existing.comment ||
      existing.commentBefore ||
      (isSeq(existing) &&
        (!existing.flow ||
          existing.items.some((n) => !isScalar(n) || n.comment || n.commentBefore || n.anchor || n.tag)))
    )
      throw Error('Complex needs syntax requires manual editing');
    patch = { from: existing.range[0], to: existing.range[1], insert };
  } else {
    const first = job.items[0]?.key;
    if (!isScalar(first) || !first.range) throw Error('Job has no insertion point');
    const from = first.range[0];
    const lineStart = source.lastIndexOf('\n', from - 1) + 1;
    const indent = source.slice(lineStart, from);
    if (!/^ +$/.test(indent)) throw Error('Unsupported indentation');
    patch = {
      from,
      to: from,
      insert: 'needs: ' + insert + (source.includes('\r\n') ? '\r\n' : '\n') + indent,
    };
  }
  const yaml = applySourcePatches(source, [patch]);
  const result = parseWorkflow(yaml);
  if (!result.valid) throw Error('Dependency edit would produce invalid workflow');
  return { yaml, patches: [patch], ...result };
}

export type BuilderEdit = {
  kind:
    | 'add-job'
    | 'duplicate-job'
    | 'add-step'
    | 'remove-step'
    | 'move-step'
    | 'configure-step'
    | 'configure-job'
    | 'configure-workflow';
  job: string;
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  inputs?: Record<string, string>;
  index?: number;
  direction?: number;
  condition?: string;
  timeout?: number;
  continueOnError?: boolean;
  env?: Record<string, string>;
  jobFields?: Record<string, string>;
};
export function editWorkflow(source: string, edit: BuilderEdit) {
  const doc = parseDocument(source, {
    version: '1.2',
    uniqueKeys: true,
    keepSourceTokens: true,
  });
  if (doc.errors.length) throw Error('Invalid YAML');
  if (edit.kind === 'configure-workflow') {
    const root = doc.contents;
    if (!isMap(root) || root.flow || root.anchor || root.tag) throw Error('Expected plain workflow mapping');
    const allowed = new Set(['name', 'run-name', 'on', 'permissions', 'concurrency', 'env', 'defaults']);
    const entries = Object.entries(edit.jobFields ?? {});
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw Error('Invalid workflow fields');
    const patches: SourcePatch[] = [];
    const added: string[] = [];
    for (const [key, raw] of entries) {
      const value: unknown = JSON.parse(raw);
      if (value === null) throw Error('Null workflow fields are not supported');
      const existing = root.get(key, true);
      if (
        key === 'on' &&
        isMap(existing) &&
        !existing.flow &&
        typeof value === 'object' &&
        value &&
        Object.keys(value).length === 1 &&
        Object.hasOwn(value, 'workflow_dispatch')
      ) {
        const dispatchValue = (value as Record<string, unknown>).workflow_dispatch;
        const current: unknown = existing.get('workflow_dispatch', true);
        const newline = source.includes('\r\n') ? '\r\n' : '\n';
        if (current === undefined) {
          const first = existing.items[0]?.key;
          if (!isScalar(first) || !first.range || first.commentBefore)
            throw Error('Unsupported trigger insertion');
          const from = source.lastIndexOf('\n', first.range[0] - 1) + 1;
          const indent = source.slice(from, first.range[0]);
          if (!/^ +$/.test(indent)) throw Error('Unsupported trigger indentation');
          patches.push({
            from,
            to: from,
            insert: indent + 'workflow_dispatch: ' + JSON.stringify(dispatchValue) + newline,
          });
          continue;
        }
        function safe(node: unknown): boolean {
          if (!isMap(node) && !isSeq(node) && !isScalar(node)) return false;
          if (node.anchor || node.tag || node.comment || node.commentBefore) return false;
          if (isMap(node)) return node.items.every((p) => safe(p.key) && safe(p.value));
          if (isSeq(node)) return node.items.every(safe);
          return true;
        }
        const pair = existing.items.find((p) => isScalar(p.key) && p.key.value === 'workflow_dispatch');
        if (
          !pair ||
          !isScalar(pair.key) ||
          !pair.key.range ||
          !safe(pair.key) ||
          !safe(current) ||
          (!isMap(current) && !isScalar(current)) ||
          !current.range
        )
          throw Error('Dispatch contains comments, aliases or unsupported YAML; edit source instead');
        const from = pair.key.range[0],
          to = current.range[1];
        const tail = source.slice(from, to);
        patches.push({
          from,
          to,
          insert: 'workflow_dispatch: ' + JSON.stringify(dispatchValue) + (tail.endsWith('\n') ? newline : ''),
        });
        continue;
      }
      let insert = JSON.stringify(value);
      if (
        key === 'on' &&
        typeof value === 'object' &&
        value &&
        Object.keys(value).length === 1 &&
        Object.hasOwn(value, 'workflow_dispatch')
      ) {
        if (isScalar(existing) && typeof existing.value === 'string' && existing.value !== 'workflow_dispatch')
          insert = JSON.stringify({ [existing.value]: null, ...value });
        if (isSeq(existing)) {
          if (
            existing.anchor ||
            existing.tag ||
            existing.comment ||
            existing.commentBefore ||
            !existing.range ||
            !existing.items.every(
              (n) =>
                isScalar(n) &&
                typeof n.value === 'string' &&
                !n.comment &&
                !n.commentBefore &&
                !n.anchor &&
                !n.tag,
            )
          )
            throw Error('Complex trigger list requires source editing');
          const names = existing.items.map((n) => String((n as { value: unknown }).value));
          const from = existing.range[0],
            to = existing.range[1];
          const prefix = source.slice(source.lastIndexOf('\n', from - 1) + 1, from);
          patches.push({
            from,
            to,
            insert:
              (/^ +$/.test(prefix) ? '' : '') +
              JSON.stringify({
                ...Object.fromEntries(names.map((n) => [n, null])),
                ...value,
              }) +
              (source.slice(from, to).endsWith('\n') ? (source.includes('\r\n') ? '\r\n' : '\n') : ''),
          });
          continue;
        }
      }
      if (existing === undefined) {
        added.push(key + ': ' + insert);
        continue;
      }
      if (
        !isScalar(existing) ||
        !existing.range ||
        existing.anchor ||
        existing.tag ||
        existing.comment ||
        existing.commentBefore ||
        existing.type === 'BLOCK_LITERAL' ||
        existing.type === 'BLOCK_FOLDED'
      )
        throw Error('Complex existing field requires YAML editing: ' + key);
      patches.push({ from: existing.range[0], to: existing.range[1], insert });
    }
    if (added.length) {
      const first = root.items[0]?.key;
      if (!isScalar(first) || !first.range) throw Error('Missing workflow insertion point');
      const from = first.range[0];
      if (source.slice(source.lastIndexOf('\n', from - 1) + 1, from) !== '')
        throw Error('Unsupported root indentation');
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      patches.push({ from, to: from, insert: added.join(newline) + newline });
    }
    const yaml = applySourcePatches(source, patches);
    const result = parseWorkflow(yaml);
    if (!result.valid) throw Error('Invalid workflow after edit');
    return { yaml, patches, ...result };
  }
  const jobs = doc.get('jobs', true);
  if (!isMap(jobs) || jobs.flow || jobs.anchor || jobs.tag) throw Error('Expected plain block jobs');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  function insertion(node: unknown, lines: string[]): SourcePatch {
    if (!isMap(node) && !isSeq(node)) throw Error('Expected block collection');
    if (node.flow || node.anchor || node.tag || !node.range) throw Error('Unsupported collection');
    const end = node.range[1];
    const from = source.lastIndexOf('\n', Math.max(0, end - 1)) + 1;
    const at = end === from ? end : source.indexOf('\n', end);
    const pos = at < 0 ? source.length : at === end && end === from ? end : at + 1;
    return {
      from: pos,
      to: pos,
      insert: (pos > 0 && source[pos - 1] !== '\n' ? newline : '') + lines.join(newline) + newline,
    };
  }
  function indentAt(offset: number) {
    const start = source.lastIndexOf('\n', offset - 1) + 1;
    const prefix = source.slice(start, offset);
    if (!/^ *$/.test(prefix)) throw Error('Unsupported indentation');
    return prefix;
  }
  const first = jobs.items[0]?.key;
  if (!isScalar(first) || !first.range) throw Error('Missing job insertion point');
  const indent = indentAt(first.range[0]);
  const job = jobs.get(edit.job, true);
  let patch: SourcePatch;
  if (edit.kind === 'add-job' || edit.kind === 'duplicate-job') {
    const id = edit.id ?? '';
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) || jobs.has(id)) throw Error('Invalid or duplicate job ID');
    if (edit.kind === 'add-job')
      patch = insertion(jobs, [
        indent + id + ':',
        indent + '  runs-on: ubuntu-latest',
        indent + '  steps:',
        indent + '    - run: "echo Ready"',
      ]);
    else {
      if (!isMap(job) || job.flow || job.anchor || job.tag || !job.range) throw Error('Unsupported job');
      const raw = source.slice(job.range[0], job.range[1]);
      if (/[&*][A-Za-z0-9_-]+/.test(raw)) throw Error('Anchors or aliases require manual duplication');
      patch = insertion(jobs, [indent + id + ':', indent + '  ' + raw.trimEnd()]);
    }
  } else if (edit.kind === 'configure-job') {
    if (!isMap(job) || job.flow || job.anchor || job.tag) throw Error('Expected plain block job');
    const allowed = new Set([
      'name',
      'runs-on',
      'strategy',
      'permissions',
      'concurrency',
      'outputs',
      'if',
      'timeout-minutes',
      'env',
      'with',
      'secrets',
      'uses',
    ]);
    const fields = Object.entries(edit.jobFields ?? {});
    if (!fields.length || fields.some(([k]) => !allowed.has(k))) throw Error('Invalid job fields');
    const first = job.items[0]?.key;
    if (!isScalar(first) || !first.range) throw Error('Missing job insertion point');
    const prefix = indentAt(first.range[0]);
    const patches: SourcePatch[] = [];
    const added: string[] = [];
    for (const [key, raw] of fields) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null) throw Error('Null fields are not supported');
      if (job.has('uses') && ['runs-on', 'strategy', 'outputs', 'timeout-minutes', 'env'].includes(key))
        throw Error('Field not supported for reusable workflow job');
      if (!job.has('uses') && ['uses', 'with', 'secrets'].includes(key))
        throw Error('Reusable workflow fields require an existing reusable job');
      const value = JSON.stringify(parsed);
      const existing = job.get(key, true);
      if (existing === undefined) {
        added.push(prefix + key + ': ' + value);
        continue;
      }
      if (
        !isScalar(existing) ||
        !existing.range ||
        existing.anchor ||
        existing.tag ||
        existing.comment ||
        existing.commentBefore ||
        existing.type === 'BLOCK_LITERAL' ||
        existing.type === 'BLOCK_FOLDED'
      )
        throw Error('Complex existing field requires YAML editing: ' + key);
      patches.push({
        from: existing.range[0],
        to: existing.range[1],
        insert: value,
      });
    }
    if (added.length) patches.push(insertion(job, added));
    const yaml = applySourcePatches(source, patches);
    const result = parseWorkflow(yaml);
    if (!result.valid) throw Error('Invalid workflow after job edit');
    return { yaml, patches, ...result };
  } else {
    if (!isMap(job) || job.flow || job.has('uses')) throw Error('Expected executable job');
    const steps = job.get('steps', true);
    if (!isSeq(steps) || steps.flow || !steps.items.length) throw Error('Expected existing block steps');
    const firstStep = steps.items[0];
    if (!isMap(firstStep) || !firstStep.range) throw Error('Unsupported step');
    const start = source.lastIndexOf('\n', firstStep.range[0] - 1) + 1;
    const prefix = source.slice(start, firstStep.range[0]).match(/^( *)- +$/);
    if (!prefix) throw Error('Unsupported step indentation');
    if (edit.kind === 'remove-step' || edit.kind === 'move-step' || edit.kind === 'configure-step') {
      const index = edit.index ?? -1;
      const item = steps.items[index];
      if (!isMap(item) || !item.range || !Number.isInteger(index)) throw Error('Invalid step');
      const startOf = (i: number) => {
        const n = steps.items[i];
        if (!isMap(n) || !n.range) throw Error('Unsupported step');
        return source.lastIndexOf('\n', n.range[0] - 1) + 1;
      };
      const endOf = (i: number) => {
        const n = steps.items[i];
        if (!isMap(n) || !n.range) throw Error('Unsupported step');
        const end = n.range[1];
        if (source[end - 1] === '\n') return end;
        const next = source.indexOf('\n', end);
        return next < 0 ? source.length : next + 1;
      };
      const from = startOf(index),
        to = endOf(index);
      if (edit.kind === 'remove-step') {
        if (steps.items.length === 1) throw Error('Cannot remove last step');
        patch = { from, to, insert: '' };
      } else if (edit.kind === 'move-step') {
        const other = index + (edit.direction === -1 ? -1 : 1);
        if (other < 0 || other >= steps.items.length) throw Error('Step already at boundary');
        const a = Math.min(index, other),
          b = Math.max(index, other),
          left = startOf(a),
          middle = startOf(b),
          right = endOf(b);
        if (endOf(a) !== middle) throw Error('Comments between steps require manual editing');
        const first = source.slice(left, middle),
          second = source.slice(middle, right);
        patch = {
          from: left,
          to: right,
          insert: second + (second.endsWith('\n') ? '' : newline) + first,
        };
      } else if (edit.run !== undefined) {
        const run = item.get('run', true);
        if (
          !isScalar(run) ||
          !run.range ||
          typeof run.value !== 'string' ||
          run.anchor ||
          run.tag ||
          run.comment ||
          run.commentBefore
        )
          throw Error('Script requires a plain scalar without comments or anchors');
        const [start, end] = run.range;
        patch = {
          from: start,
          to: end,
          insert: JSON.stringify(edit.run) + (source[end - 1] === '\n' ? newline : ''),
        };
      } else {
        const fields: Record<string, unknown> = {};
        if (edit.condition !== undefined) fields.if = edit.condition;
        if (edit.timeout !== undefined) fields['timeout-minutes'] = edit.timeout;
        if (edit.continueOnError !== undefined) fields['continue-on-error'] = edit.continueOnError;
        if (edit.env !== undefined) fields.env = edit.env;
        if (!Object.keys(fields).length) throw Error('No configuration supplied');
        if (Object.keys(fields).some((k) => item.has(k))) throw Error('Existing fields require manual editing');
        patch = {
          from: to,
          to,
          insert:
            (source[to - 1] === '\n' ? '' : newline) +
            Object.entries(fields)
              .map(([k, v]) => prefix[1] + '  ' + k + ': ' + JSON.stringify(v))
              .join(newline) +
            newline,
        };
      }
      const yaml = applySourcePatches(source, [patch]);
      const result = parseWorkflow(yaml);
      if (!result.valid) throw Error('Edit would produce invalid workflow');
      return { yaml, patches: [patch], ...result };
    }
    if (Boolean(edit.run) === Boolean(edit.uses)) throw Error('Choose run or uses');
    const line = edit.run ? 'run: ' + JSON.stringify(edit.run) : 'uses: ' + JSON.stringify(edit.uses);
    const fields = Object.entries(edit.inputs ?? {});
    if (fields.length && !edit.uses) throw Error('Inputs require an action');
    patch = insertion(steps, [
      prefix[1] + '- ' + (edit.name ? 'name: ' + JSON.stringify(edit.name) : line),
      ...(edit.name ? [prefix[1] + '  ' + line] : []),
      ...(fields.length
        ? [
            prefix[1] + '  with:',
            ...fields.map(([k, v]) => prefix[1] + '    ' + JSON.stringify(k) + ': ' + JSON.stringify(v)),
          ]
        : []),
    ]);
  }
  const yaml = applySourcePatches(source, [patch]);
  const result = parseWorkflow(yaml);
  if (!result.valid) throw Error('Edit would produce invalid workflow');
  return { yaml, patches: [patch], ...result };
}

export { patchWorkflowFields, connectStepOutput } from './fields.ts';
export { importLegacyWorkflow } from './legacy.ts';
