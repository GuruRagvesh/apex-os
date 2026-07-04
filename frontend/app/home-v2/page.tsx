import { ApexLandingPage } from '@/components/landing/ApexLandingPage';

// Kept as a review/alias route now that this content is promoted to /.
// Renders the exact same shared component, with the preview banner enabled.
export default function HomeV2Page() {
  return <ApexLandingPage showPreviewBanner />;
}
