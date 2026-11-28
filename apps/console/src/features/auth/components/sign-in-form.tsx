'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Messages for the API's sign-in refusals. Unknown email and wrong password read the same. */
export function signInMessage(status: number, code: string | undefined): string {
  if (code === 'INVALID_CREDENTIALS') return 'The email or password is not right.';
  if (code === 'ACCOUNT_DEACTIVATED') return 'This account has been deactivated. Ask your Organization Admin.';
  if (code === 'ORGANIZATION_SUSPENDED') return 'Your Organization is suspended. Contact PayBridge.';
  if (status === 502 || status === 0) return 'The Console could not reach the API. Try again in a moment.';
  return 'Sign-in failed. Try again.';
}

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      if (response.ok) {
        // A full navigation, so the server renders with the new session.
        window.location.assign('/');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      setError(signInMessage(response.status, body.code));
    } catch {
      setError(signInMessage(0, undefined));
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Sign in">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <Link href="/forgot-password" className="text-sm underline">
        Forgot your password?
      </Link>
    </form>
  );
}
