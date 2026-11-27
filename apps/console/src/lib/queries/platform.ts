'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createOrganization, reactivateOrganization, suspendOrganization } from '@/lib/api/organizations';
import {
  deactivateSuperAdmin,
  inviteSuperAdmin,
  listSuperAdmins,
  reactivateSuperAdmin,
} from '@/lib/api/super-admins';
import { isApiError } from '@/services/errors';
import { organizationKeys } from './organizations';

export const superAdminKeys = {
  all: ['super-admins'] as const,
  list: () => [...superAdminKeys.all, 'list'] as const,
};

/** What a refusal of a Platform action says. */
export function platformMessage(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'EMAIL_TAKEN':
      return 'This email already belongs to a User.';
    case 'INVITATION_PENDING':
      return 'This email already has a pending Invitation.';
    case 'LAST_SUPER_ADMIN':
      return 'The platform must keep at least one active Super Admin.';
    case 'FORBIDDEN':
      return 'You are not allowed to do that.';
    default:
      return error.message;
  }
}

export function useSuperAdminList() {
  return useQuery({ queryKey: superAdminKeys.list(), queryFn: ({ signal }) => listSuperAdmins(signal) });
}

export function useCreateOrganization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createOrganization,
    onSuccess: (created) => toast.success(`Organization ${created.name} created. The invitation is on its way.`),
    onError: (error) => toast.error(platformMessage(error)),
    onSettled: () => client.invalidateQueries({ queryKey: organizationKeys.all }),
  });
}

export function useSetOrganizationSuspension() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, suspend }: { id: string; suspend: boolean }) =>
      suspend ? suspendOrganization(id) : reactivateOrganization(id),
    onSuccess: (_result, { suspend }) => toast.success(suspend ? 'Organization suspended.' : 'Organization reactivated.'),
    onError: (error) => toast.error(platformMessage(error)),
    onSettled: () => client.invalidateQueries({ queryKey: organizationKeys.all }),
  });
}

export function useInviteSuperAdmin() {
  return useMutation({
    mutationFn: inviteSuperAdmin,
    onSuccess: () => toast.success('Invitation sent.'),
    onError: (error) => toast.error(platformMessage(error)),
  });
}

export function useChangeSuperAdmin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? reactivateSuperAdmin(id) : deactivateSuperAdmin(id),
    onSuccess: (_result, { active }) => toast.success(active ? 'Super Admin reactivated.' : 'Super Admin deactivated.'),
    onError: (error) => toast.error(platformMessage(error)),
    onSettled: () => client.invalidateQueries({ queryKey: superAdminKeys.all }),
  });
}
