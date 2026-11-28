import { useStudioRuntime } from '../runtime';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
export type Draft = {
  id: string;
  repo: string;
  ref: string;
  path: string;
  yaml: string;
  original: string;
  updatedAt: number;
};
export const documentId = (repo: string, ref: string, path: string) => JSON.stringify([repo, ref, path]);
export function useDrafts(repos: string[]) {
  const { draftDB: db } = useStudioRuntime();
  const [error, setError] = useState('');
  const items = useLiveQuery(
    async () => {
      try {
        return (
          await db.drafts
            .where('repo')
            .anyOf([...repos, '@local'])
            .toArray()
        ).sort((a, b) => b.updatedAt - a.updatedAt);
      } catch (e) {
        setError(String(e));
        return [];
      }
    },
    [repos.join(',')],
    [],
  );
  return {
    items,
    error,
    get: (id: string) => db.drafts.get(id),
    save: (draft: Draft) => db.drafts.put(draft),
    remove: (id: string) => db.drafts.delete(id),
  };
}
