import type { Metadata } from 'next';
import TermsScreen from '@apex/system-public-site/screens/TermsScreen';

// `metadata` only takes effect in a route file, so it stays here verbatim.
export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return <TermsScreen />;
}
