'use client';

import type { ReactNode } from 'react';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/shared/data-table/data-table';
import { EmptyListState } from '@/components/shared/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ManagedUser } from '@/features/users/api/users';
import { useCan } from '@/features/auth/hooks/use-operator';
import { useChangeUser, useUserList } from '@/features/users/hooks/queries';

/** Users of the Organization: Role, active state, and the actions an Organization Admin may take. */
export function UsersScreen() {
  const { data, error, isPending, refetch } = useUserList();
  const canManage = useCan('users:manage');
  const change = useChangeUser();

  if (!canManage) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">
        Managing Users needs the Permission to manage Users.
      </p>
    );
  }
  const act = (user: ManagedUser) => {
    const otherRole =
      user.role === 'ORGANIZATION_ADMIN' ? 'OPERATOR' : 'ORGANIZATION_ADMIN';
    return (
      <div className="flex justify-end gap-2">
        {user.role !== 'SUPER_ADMIN' && user.active && (
          <Button
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={() =>
              change.mutate({ id: user.id, action: 'role', role: otherRole })
            }
          >
            {otherRole === 'OPERATOR'
              ? 'Make Operator'
              : 'Make Organization Admin'}
          </Button>
        )}
        {user.active ? (
          <Button
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate({ id: user.id, action: 'deactivate' })}
          >
            Deactivate
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate({ id: user.id, action: 'reactivate' })}
          >
            Reactivate
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="px-4 pb-6">
      <DataTable
        label="Users"
        columns={userColumns(act)}
        rows={data?.items ?? []}
        getRowId={(user) => user.id}
        getRowLabel={(user) => user.email}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        emptyState={<EmptyListState title="No Users yet." description="Invite people from Invitations." />}
      />
    </div>
  );
}

const column = createDataTableColumnHelper<ManagedUser>();

function userColumns(actions: (user: ManagedUser) => ReactNode): DataTableColumns<ManagedUser> {
  return column.columns([
    column.accessor('name', {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    }),
    column.accessor('email', { id: 'email', header: 'Email' }),
    column.accessor('roleLabel', { id: 'role', header: 'Role' }),
    column.display({
      id: 'state',
      header: 'State',
      cell: ({ row }) => (
        <Badge variant={row.original.active ? 'secondary' : 'outline'}>{row.original.active ? 'Active' : 'Deactivated'}</Badge>
      ),
    }),
    column.display({
      id: 'actions',
      header: 'Actions',
      meta: { align: 'right' },
      cell: ({ row }) => actions(row.original),
    }),
  ]);
}
