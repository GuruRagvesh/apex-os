// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load UserProfileScreen.
import ProfileScreen from '@apex/core-users-profiles/screens/ProfileScreen';

export default function ProfilePage() {
  return <ProfileScreen />;
}
