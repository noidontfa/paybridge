import { SignInForm } from '@/features/auth/components/sign-in-form';
import { PRODUCT_NAME } from '@/components/layout/navigation';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-sm text-muted-foreground">Sign in with your email and password.</p>
      </div>
      <SignInForm />
    </main>
  );
}
