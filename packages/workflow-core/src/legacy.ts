import { parseDocument, isMap, isSeq, isNode, stringify } from 'yaml';
/** Import the old Shell draft once; preserve the original storage entry as backup. */
export function importLegacyWorkflow(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const model = value as { name?: unknown; steps?: unknown; source?: unknown; jobId?: unknown };
  if (!Array.isArray(model.steps) || (!model.steps.length && typeof model.source !== 'string')) return null;
  const steps = model.steps.map((step) => {
    if (!step || typeof step !== 'object') throw Error('Invalid legacy workflow draft');
    return Object.fromEntries(
      Object.entries(step).filter(
        ([key]) => key !== 'contract' && !['__proto__', 'constructor', 'prototype'].includes(key),
      ),
    );
  });
  if (typeof model.source !== 'string')
    return stringify({
      name: typeof model.name === 'string' ? model.name : 'Workflow',
      on: { workflow_dispatch: {} },
      jobs: { build: { 'runs-on': 'ubuntu-latest', steps } },
    });
  const doc = parseDocument(model.source, { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length) throw Error('Legacy source YAML is invalid; original draft retained');
  const jobs = doc.get('jobs', true);
  if (!isMap(jobs)) throw Error('Legacy source has no jobs; original draft retained');
  const id = typeof model.jobId === 'string' ? model.jobId : jobs.items[0]?.key?.toString();
  const old = doc.getIn(['jobs', id, 'steps'], true);
  if (!isSeq(old)) throw Error('Legacy job has no steps; original draft retained');
  const original = [...old.items];
  old.items = steps.map((step, index) => {
    const existing =
      original.find((node) => isMap(node) && step.id && node.get('id') === step.id) ?? original[index];
    if (!isMap(existing)) return doc.createNode(step);
    if (existing.anchor || existing.tag)
      throw Error('Anchored legacy steps require manual recovery; original retained');
    const next = existing.clone();
    for (const [key, val] of Object.entries(step)) {
      const current = next.get(key, true);
      if (JSON.stringify(isNode(current) ? current.toJSON() : current) !== JSON.stringify(val))
        next.set(key, doc.createNode(val));
    }
    return next;
  });
  if (typeof model.name === 'string' && doc.get('name') !== model.name) doc.set('name', model.name);
  return doc.toString();
}
