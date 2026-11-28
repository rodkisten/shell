import { useStudioRuntime } from '../runtime';
export function useWorkspace() {
  return { repos: [...useStudioRuntime().adapter.repositories] };
}
