// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load UsersScreen.
//
// Transfers and Exit are composed HERE: platforms/** may not import frontend/**.
import UserDetailScreen from '@apex/core-users/screens/UserDetailScreen';
import { UserTransitionsSection } from '@/components/transitions/UserTransitionsSection';

export default function UserDetailPage() {
  return (
    <>
      <UserDetailScreen />
      <UserTransitionsSection />
    </>
  );
}
