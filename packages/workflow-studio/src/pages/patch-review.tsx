import { PatchReview as SharedPatchReview } from '../components/shared/patch-review';
export function PatchReview(props: { before: string; after: string }) {
  return <SharedPatchReview {...props} title="Review YAML patch" />;
}
