'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** The API's minimum, shown before the request so a short password costs no round trip. */
export const MIN_PASSWORD_LENGTH = 12;

/** Messages for the refusals of reset, forgot and change-password calls. */
export function passwordMessage(status: number, code: string | undefined): string {
  if (code === 'INVALID_RESET_TOKEN') return 'This reset link is invalid or has expired. Ask for a new one.';
  if (code === 'INVALID_CURRENT_PASSWORD') return 'The current password is not right.';
  if (code === 'WEAK_PASSWORD') return `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (code === 'ACCOUNT_DEACTIVATED') return 'This account has been deactivated. Ask your Organization Admin.';
  if (code === 'SESSION_EXPIRED') return 'Your session has ended. Sign in again.';
  if (status === 502 || status === 0) return 'The Console could not reach the API. Try again in a moment.';
  return 'Something went wrong. Try again.';
}

/** The problem with a new password the form can see itself, or null. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirmation) return 'The two passwords are not the same.';
  return null;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

type Outcome = { ok: true } | { ok: false; message: string; code?: string };

async function submit(path: string, body: object): Promise<Outcome> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const refusal = (await response.json().catch(() => ({}))) as { code?: string };
    return { ok: false, message: passwordMessage(response.status, refusal.code), ...(refusal.code && { code: refusal.code }) };
  } catch {
    return { ok: false, message: passwordMessage(0, undefined) };
  }
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<'input'>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} name={id} required {...props} />
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

/** Asks for a reset link. The page says the same thing for every address. */
export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    setPending(true);
    setError(null);
    const outcome = await submit('/api/auth/forgot-password', { email });
    if (outcome.ok) setSent(true);
    else setError(outcome.message);
    setPending(false);
  }

  if (sent) {
    return (
      <p role="status" className="text-sm">
        If that email belongs to an account, a link to reset the password is on its way. It works once and expires in 30 minutes.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Forgot password">
      <Field id="email" label="Email" type="email" autoComplete="username" autoFocus />
      <ErrorText message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}

/** Sets the new password from the emailed link. */
export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {passwordMessage(400, 'INVALID_RESET_TOKEN')}
      </p>
    );
  }
  if (done) {
    return (
      <p role="status" className="text-sm">
        Your password has been changed and you were signed out everywhere. <Link href="/sign-in" className="underline">Sign in</Link> with the new one.
      </p>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = field(form, 'password');
    const problem = newPasswordProblem(password, field(form, 'confirmation'));
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const outcome = await submit('/api/auth/reset-password', { token, password });
    if (outcome.ok) setDone(true);
    else setError(outcome.message);
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Reset password">
      <Field id="password" label="New password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} autoFocus />
      <Field id="confirmation" label="Repeat the new password" type="password" autoComplete="new-password" />
      <ErrorText message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}

/** A signed-in User changes their own password; their other sign-ins end. */
export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = field(form, 'newPassword');
    const problem = newPasswordProblem(newPassword, field(form, 'confirmation'));
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    const outcome = await submit('/api/auth/change-password', { currentPassword: form.get('currentPassword'), newPassword });
    if (outcome.ok) {
      setDone(true);
      event.currentTarget.reset();
    } else if (outcome.code === 'SESSION_EXPIRED') {
      window.location.assign('/sign-in');
    } else {
      setError(outcome.message);
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4" aria-label="Change password">
      <Field id="currentPassword" label="Current password" type="password" autoComplete="current-password" />
      <Field id="newPassword" label="New password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
      <Field id="confirmation" label="Repeat the new password" type="password" autoComplete="new-password" />
      <ErrorText message={error} />
      {done && (
        <p role="status" className="text-sm">
          Password changed. Your other sign-ins have ended.
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
