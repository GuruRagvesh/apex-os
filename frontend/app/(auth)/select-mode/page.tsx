import { redirect } from 'next/navigation';

// The super admin / team lead chooser is gone: one workspace for everyone.
// Kept as a redirect so old bookmarks still land on Home.
export default function SelectModePage() {
  redirect('/dashboard');
}
