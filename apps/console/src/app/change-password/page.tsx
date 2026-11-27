import { PageHeader } from '@/components/layout/page-header';
import { ChangePasswordForm } from '@/features/auth/components/password-forms';

export const metadata = { title: 'Change password' };

export default function ChangePasswordPage() {
  return (
    <>
      <PageHeader title="Change password" description="Your other sign-ins end when you change it." />
      <div className="px-4 pb-4">
        <ChangePasswordForm />
      </div>
    </>
  );
}
