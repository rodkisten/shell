import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { validateWorkflow } from './validate.ts';

export function inspectWorkflow(source: string) {
  const validation = validateWorkflow(source);
  const doc = parseDocument(source, { version: '1.2', uniqueKeys: true });
  const str = (v: unknown) => (isScalar(v) && typeof v.value === 'string' ? v.value : null);
  const keys = (v: unknown) =>
    isMap(v)
      ? v.items.flatMap((p) => {
          const key = str(p.key);
          return key === null ? [] : [key];
        })
      : [];
  const jobs = doc.get('jobs', true);
  const triggers = doc.get('on', true);
  const triggerNames = isMap(triggers)
    ? keys(triggers)
    : isSeq(triggers)
      ? triggers.items.flatMap((v) => str(v) ?? [])
      : [str(triggers)].filter(Boolean);
  const call = isMap(triggers) ? triggers.get('workflow_call', true) : null;
  const dispatch = isMap(triggers) ? triggers.get('workflow_dispatch', true) : null;
  const dispatchInputs: unknown = isMap(dispatch) ? dispatch.get('inputs', true) : null;
  const details =
    isMap(jobs) && !doc.errors.length
      ? jobs.items.flatMap((pair) => {
          const id = str(pair.key),
            job = pair.value;
          if (!id || !isMap(job)) return [];
          const steps = job.get('steps', true);
          const strategy: unknown = job.get('strategy', true);
          return [
            {
              id,
              name: str(job.get('name', true)),
              uses: str(job.get('uses', true)),
              inputs: keys(job.get('with', true)),
              outputs: keys(job.get('outputs', true)),
              env: keys(job.get('env', true)),
              matrix: isMap(strategy)
                ? keys(strategy.get('matrix', true)).filter((k) => k !== 'include' && k !== 'exclude')
                : [],
              steps: isSeq(steps)
                ? steps.items.flatMap((step, index) =>
                    isMap(step)
                      ? [
                          {
                            index,
                            id: str(step.get('id', true)),
                            name: str(step.get('name', true)),
                            uses: str(step.get('uses', true)),
                            kind: step.has('uses') ? 'action' : step.has('run') ? 'shell' : 'unknown',
                            run: str(step.get('run', true)),
                            condition: str(step.get('if', true)),
                            outputHints: Array.from(
                              new Set(
                                Array.from(
                                  (str(step.get('run', true)) ?? '').matchAll(
                                    /(?:echo|printf)\s+[\x27\x22]?([A-Za-z_][\w-]*)=[^\n]*\$GITHUB_OUTPUT/g,
                                  ),
                                  (m) => m[1],
                                ),
                              ),
                            ),
                            shell: str(step.get('shell', true)),
                            inputs: keys(step.get('with', true)),
                            env: keys(step.get('env', true)),
                          },
                        ]
                      : [],
                  )
                : [],
            },
          ];
        })
      : [];
  return {
    ...validation,
    triggerNames,
    dispatchSchema: isMap(dispatchInputs) ? dispatchInputs.toJSON() : {},
    env: keys(doc.get('env', true)),
    interface: {
      inputs: isMap(call) ? keys(call.get('inputs', true)) : [],
      outputs: isMap(call) ? keys(call.get('outputs', true)) : [],
      secrets: isMap(call) ? keys(call.get('secrets', true)) : [],
      dispatchInputs: isMap(dispatch) ? keys(dispatch.get('inputs', true)) : [],
    },
    details,
  };
}
