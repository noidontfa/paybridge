import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/password-forms';
import { PRODUCT_NAME } from '@/lib/navigation';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-sm text-muted-foreground">Enter your email and we will send you a link to choose a new password.</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/sign-in" className="text-sm underline">
        Back to sign in
      </Link>
    </main>
  );
}
