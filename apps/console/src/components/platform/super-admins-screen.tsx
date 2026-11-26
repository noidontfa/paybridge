'use client';

import { ErrorState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/operator';
import { useChangeSuperAdmin, useInviteSuperAdmin, useSuperAdminList } from '@/lib/queries/platform';

/** Platform area: the Super Admin team, with invite, deactivate and reactivate. */
export function SuperAdminsScreen() {
  const canManage = useCan('super-admins:manage');
  const { data, error, isPending, refetch } = useSuperAdminList();
  const invite = useInviteSuperAdmin();
  const change = useChangeSuperAdmin();

  if (!canManage) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">
        Managing Super Admins needs the Permission to manage Super Admins.
      </p>
    );
  }

  return (
    <div className="grid gap-6 px-4 pb-6">
      <form
        aria-label="Invite Super Admin"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const value = new FormData(form).get('email');
          invite.mutate(typeof value === 'string' ? value : '', { onSuccess: () => form.reset() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sa-email" className="text-sm font-medium">
            Email
          </label>
          <Input id="sa-email" name="email" type="email" required />
        </div>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? 'Sending…' : 'Invite Super Admin'}
        </Button>
      </form>

      {isPending && !error ? (
        <Skeleton role="status" aria-label="Loading super admins" className="h-40 rounded-xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <Table aria-label="Super Admins">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((admin) => (
              <TableRow key={admin.id} aria-label={admin.email}>
                <TableCell>{admin.name}</TableCell>
                <TableCell>{admin.email}</TableCell>
                <TableCell>
                  <Badge variant={admin.active ? 'secondary' : 'outline'}>{admin.active ? 'Active' : 'Deactivated'}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ id: admin.id, active: !admin.active })}
                  >
                    {admin.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
