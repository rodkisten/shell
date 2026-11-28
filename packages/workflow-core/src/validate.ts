import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
type Diagnostic = {
  severity: 'error' | 'warning';
  message: string;
  offset: number | null;
};
export function validateWorkflow(source: string) {
  const doc = parseDocument(source, { uniqueKeys: true, version: '1.2' });
  const diagnostics: Diagnostic[] = [
    ...doc.errors.map((e) => ({
      severity: 'error' as const,
      message: e.message,
      offset: e.pos[0],
    })),
    ...doc.warnings.map((e) => ({
      severity: 'warning' as const,
      message: e.message,
      offset: e.pos[0],
    })),
  ];
  const error = (message: string) => diagnostics.push({ severity: 'error', message, offset: null });
  const jobs: { id: string; needs: string[] }[] = [];
  if (!doc.errors.length) {
    if (!isMap(doc.contents)) error('Workflow must be a mapping');
    else {
      if (!doc.has('on')) error('Missing on trigger');
      const nodes = doc.get('jobs', true);
      if (!isMap(nodes) || !nodes.items.length) error('jobs must be a non-empty mapping');
      else
        for (const pair of nodes.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || !isMap(pair.value)) {
            error('Invalid job definition');
            continue;
          }
          const id = pair.key.value;
          if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) error('Invalid job ID: ' + id);
          const n = pair.value.get('needs', true);
          const needs: string[] = [];
          if (isScalar(n) && typeof n.value === 'string') needs.push(n.value);
          else if (isSeq(n)) {
            for (const item of n.items) {
              if (isScalar(item) && typeof item.value === 'string') needs.push(item.value);
              else error('Invalid needs entry in ' + id);
            }
          } else if (n !== undefined) error('Invalid needs in ' + id);
          jobs.push({ id, needs });
        }
      const graph = new Map(jobs.map((j) => [j.id, j.needs]));
      const visiting = new Set<string>(),
        done = new Set<string>();
      function visit(id: string) {
        if (visiting.has(id)) {
          error('Dependency cycle at ' + id);
          return;
        }
        if (done.has(id)) return;
        visiting.add(id);
        for (const dep of graph.get(id) ?? []) {
          if (!graph.has(dep)) error('Unknown dependency ' + dep + ' in ' + id);
          else visit(dep);
        }
        visiting.delete(id);
        done.add(id);
      }
      for (const id of graph.keys()) visit(id);
    }
  }
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    jobs,
  };
}
