import { PageHeader } from '@/components/page-header';
import { UsersScreen } from '@/components/users/users-screen';

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
