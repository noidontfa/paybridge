'use client';

import { useMemo } from 'react';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/data-table/data-table';
import { EmptyListState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ManagedUser } from '@/lib/api/users';
import { useCan } from '@/lib/operator';
import { useChangeSuperAdmin, useInviteSuperAdmin, useSuperAdminList } from '@/lib/queries/platform';

/** Platform area: the Super Admin team, with invite, deactivate and reactivate. */
export function SuperAdminsScreen() {
  const canManage = useCan('super-admins:manage');
  const { data, error, isPending, refetch } = useSuperAdminList();
  const invite = useInviteSuperAdmin();
  const change = useChangeSuperAdmin();
  const columns = useMemo(
    () =>
      superAdminColumns({
        pending: change.isPending,
        onToggle: (admin, active) => change.mutate({ id: admin.id, active }),
      }),
    [change],
  );

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

      <DataTable
        label="Super Admins"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(admin) => admin.id}
        getRowLabel={(admin) => admin.email}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        emptyState={<EmptyListState title="No Super Admins yet." description="Invite one above." />}
      />
    </div>
  );
}

const adminColumn = createDataTableColumnHelper<ManagedUser>();

function superAdminColumns({
  pending,
  onToggle,
}: {
  pending: boolean;
  onToggle: (admin: ManagedUser, active: boolean) => void;
}): DataTableColumns<ManagedUser> {
  return adminColumn.columns([
    adminColumn.accessor('name', {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    }),
    adminColumn.accessor('email', { id: 'email', header: 'Email' }),
    adminColumn.display({
      id: 'state',
      header: 'State',
      cell: ({ row }) => (
        <Badge variant={row.original.active ? 'secondary' : 'outline'}>{row.original.active ? 'Active' : 'Deactivated'}</Badge>
      ),
    }),
    adminColumn.display({
      id: 'actions',
      header: 'Actions',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onToggle(row.original, !row.original.active)}>
          {row.original.active ? 'Deactivate' : 'Reactivate'}
        </Button>
      ),
    }),
  ]);
}
