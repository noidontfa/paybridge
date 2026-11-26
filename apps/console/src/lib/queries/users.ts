'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  changeUserRole,
  deactivateUser,
  listUsers,
  reactivateUser,
  type ManagedRole,
} from '@/lib/api/users';

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
};

export function useUserList() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: ({ signal }) => listUsers(signal),
  });
}

type Change = { id: string } & (
  | { action: 'role'; role: ManagedRole }
  | { action: 'deactivate' }
  | { action: 'reactivate' }
);

const SUCCESS: Record<Change['action'], string> = {
  role: 'Role changed.',
  deactivate: 'User deactivated.',
  reactivate: 'User reactivated.',
};

/** One of the three User changes; the list is refetched either way. */
export function useChangeUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      if (change.action === 'role')
        return changeUserRole(change.id, change.role);
      return change.action === 'deactivate'
        ? deactivateUser(change.id)
        : reactivateUser(change.id);
    },
    onSuccess: (_result, change) => toast.success(SUCCESS[change.action]),
    onError: (error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: userKeys.all }),
  });
}
