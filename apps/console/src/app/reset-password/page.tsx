import Link from 'next/link';
import { ResetPasswordForm } from '@/components/password-forms';
import { PRODUCT_NAME } from '@/components/layout/navigation';

export const metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-sm text-muted-foreground">Choose a new password (at least 12 characters).</p>
      </div>
      <ResetPasswordForm token={typeof token === 'string' ? token : undefined} />
      <Link href="/forgot-password" className="text-sm underline">
        Ask for a new link
      </Link>
    </main>
  );
}
