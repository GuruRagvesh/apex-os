// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load UserDetailScreen.
import UsersScreen from '@apex/core-users/screens/UsersScreen';

export default function UsersPage() {
  return <UsersScreen />;
}
