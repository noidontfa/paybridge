import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { SettingsPanel } from '@/components/settings-panel';
import { getEnvironment } from '@/lib/environment';

export const metadata = { title: 'Settings' };

// Environment values come from the server at request time, never from the bundle.
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Preferences for this browser and the current environment." />
      <div className="px-4 pb-4">
        <p className="mb-4 text-sm">
          <Link href="/settings/invitations" className="underline">
            Invitations
          </Link>{' '}
          (Organization Admins invite people and see who has not joined yet)
        </p>
        <SettingsPanel environment={getEnvironment()} />
      </div>
    </>
  );
}
