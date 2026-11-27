import { PageHeader } from '@/components/layout/page-header';
import { InvitationsPanel } from '@/features/users/components/invitations-panel';

export const metadata = { title: 'Invitations' };

export default function InvitationsPage() {
  return (
    <>
      <PageHeader title="Invitations" description="Invite people to your Organization and see who has not joined yet." />
      <div className="px-4 pb-4">
        <InvitationsPanel />
      </div>
    </>
  );
}
