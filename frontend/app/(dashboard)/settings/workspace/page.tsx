import { redirect } from 'next/navigation';

export default function WorkspaceSettingsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = searchParams?.tab ?? 'company';
  redirect(`/settings?tab=${encodeURIComponent(tab)}`);
}
