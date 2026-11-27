import { PageHeader } from '@/components/layout/page-header';
import { SuperAdminsScreen } from '@/features/platform/components/super-admins-screen';

export const metadata = { title: 'Super Admins' };

export default function Page() {
  return (
    <>
      <PageHeader title="Super Admins" description="The people who run the platform." />
      <SuperAdminsScreen />
    </>
  );
}
