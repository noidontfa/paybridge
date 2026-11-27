'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorState } from '@/components/shared/data-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/services/errors';
import {
  listInvitations,
  resendInvitation,
  revokeInvitation,
  sendInvitation,
  type InvitableRole,
} from '@/features/users/api/invitations';
import { useCan } from '@/features/auth/hooks/use-operator';

const KEY = ['invitations'] as const;

/** What a refusal of an Invitation action says. */
export function invitationMessage(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'EMAIL_TAKEN':
      return 'This email already belongs to a User.';
    case 'INVITATION_PENDING':
      return 'This email already has a pending Invitation. Re-send it instead.';
    case 'ORGANIZATION_REQUIRED':
      return 'Choose an Organization in the switcher first.';
    case 'INVITATION_NOT_FOUND':
      return 'This Invitation is no longer pending.';
    case 'ACCOUNT_DEACTIVATED':
    case 'ROLE_CHANGED':
    case 'ORGANIZATION_SUSPENDED':
      return error.message;
    case 'FORBIDDEN':
      return 'You are not allowed to do that.';
    default:
      return error.message;
  }
}

const formatDate = (iso: string) => new Date(iso).toLocaleString();

/** Pending Invitations of the Organization, with send, re-send and revoke. */
export function InvitationsPanel() {
  const allowed = useCan('users:manage');
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<InvitableRole>('OPERATOR');
  const canInviteSuperAdmin = useCan('super-admins:manage');
  const choosesOrganization = useCan('organizations:manage');

  const list = useQuery({ queryKey: KEY, queryFn: ({ signal }) => listInvitations(signal), enabled: allowed });
  const onSettled = () => client.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => setError(invitationMessage(e));
  const send = useMutation({ mutationFn: sendInvitation, onSettled, onError, onMutate: () => setError(null) });
  const resend = useMutation({ mutationFn: resendInvitation, onSettled, onError, onMutate: () => setError(null) });
  const revoke = useMutation({ mutationFn: revokeInvitation, onSettled, onError, onMutate: () => setError(null) });

  if (!allowed) {
    return <p className="text-sm text-muted-foreground">Only an Organization Admin can manage Invitations.</p>;
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            They get an email with a link to set their own password. It works once and expires in 7 days.
            {choosesOrganization && ' Choose an Organization in the switcher first, unless you invite a Super Admin.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            aria-label="Invite"
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const value = new FormData(form).get('email');
              const email = typeof value === 'string' ? value : '';
              send.mutate({ email, role }, { onSuccess: () => form.reset() });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-email" className="text-sm font-medium">
                Email
              </label>
              <Input id="invite-email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-role" className="text-sm font-medium">
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as InvitableRole)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="OPERATOR">Operator</option>
                <option value="ORGANIZATION_ADMIN">Organization Admin</option>
                {canInviteSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
            </div>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data && list.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending Invitations.</p>
          ) : (
            <ul className="divide-y text-sm">
              {list.data?.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{item.email}</span>
                    <span className="text-muted-foreground">
                      {item.roleLabel} · expires {formatDate(item.expiresAt)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={resend.isPending} onClick={() => resend.mutate(item.id)}>
                      Re-send
                    </Button>
                    <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>
                      Revoke
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
