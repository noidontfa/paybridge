import { OrganizationsScreen } from '@/components/platform/organizations-screen';
import { PageHeader } from '@/components/layout/page-header';

export const metadata = { title: 'Organizations' };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Organizations"
        description="Create, suspend and reactivate the businesses on PayBridge."
      />
      <OrganizationsScreen />
    </>
  );
}
