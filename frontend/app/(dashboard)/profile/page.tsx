// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load UserProfileScreen.
//
// The attendance summary is composed HERE rather than inside ProfileScreen:
// that screen lives in platforms/core/users/profiles, and platforms/** may not
// import frontend/** — the architecture validator rejects it. Composing at the
// route keeps the slice untouched and adds no migration debt.
import ProfileScreen from '@apex/core-users-profiles/screens/ProfileScreen';
import { AttendanceLeaveSummary } from '@/components/attendance/AttendanceLeaveSummary';

export default function ProfilePage() {
  return (
    <>
      <ProfileScreen />
      <div className="mt-4">
        <AttendanceLeaveSummary />
      </div>
    </>
  );
}
