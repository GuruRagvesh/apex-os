// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load UsersScreen.
import UserDetailScreen from '@apex/core-users/screens/UserDetailScreen';

export default function UserDetailPage() {
  return <UserDetailScreen />;
}
