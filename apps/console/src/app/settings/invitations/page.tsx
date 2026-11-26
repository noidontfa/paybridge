import { PageHeader } from '@/components/page-header';
import { InvitationsPanel } from '@/components/settings/invitations-panel';

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
