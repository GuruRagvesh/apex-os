import type { Metadata } from 'next';
import PrivacyScreen from '@apex/system-public-site/screens/PrivacyScreen';

// `metadata` only takes effect in a route file, so it stays here verbatim.
export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return <PrivacyScreen />;
}
