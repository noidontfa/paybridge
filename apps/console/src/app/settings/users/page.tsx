import { PageHeader } from '@/components/layout/page-header';
import { UsersScreen } from '@/features/users/components/users-screen';

export const metadata = { title: 'Users' };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Users"
        description="The people in this Organization: their Role, and who may sign in."
      />
      <UsersScreen />
    </>
  );
}
