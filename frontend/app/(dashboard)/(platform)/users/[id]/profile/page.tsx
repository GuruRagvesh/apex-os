// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load ProfileScreen.
import UserProfileScreen from '@apex/core-users-profiles/screens/UserProfileScreen';

export default function EmployeeProfilePage() {
  return <UserProfileScreen />;
}
