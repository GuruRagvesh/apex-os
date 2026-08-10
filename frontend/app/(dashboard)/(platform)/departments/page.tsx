// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load DepartmentDetailScreen.
import DepartmentsScreen from '@apex/core-organization-departments/screens/DepartmentsScreen';

export default function DepartmentsPage() {
  return <DepartmentsScreen />;
}
