// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load DepartmentsScreen.
import DepartmentDetailScreen from '@apex/core-organization-departments/screens/DepartmentDetailScreen';

export default function DepartmentDetailPage() {
  return <DepartmentDetailScreen />;
}
