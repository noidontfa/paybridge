'use client';

import { ErrorState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ManagedUser } from '@/features/users/api/users';
import { useCan } from '@/lib/operator';
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
  if (isPending && !error) {
    return (
      <Skeleton
        role="status"
        aria-label="Loading users"
        className="mx-4 h-40 rounded-xl"
      />
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
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
      <Table aria-label="Users">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((user) => (
            <TableRow key={user.id} aria-label={user.email}>
              <TableCell>{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>{user.roleLabel}</TableCell>
              <TableCell>
                <Badge variant={user.active ? 'secondary' : 'outline'}>
                  {user.active ? 'Active' : 'Deactivated'}
                </Badge>
              </TableCell>
              <TableCell>{act(user)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
