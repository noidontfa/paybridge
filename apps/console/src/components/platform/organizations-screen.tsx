'use client';

import { useMemo } from 'react';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/data-table/data-table';
import { EmptyListState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrganizationSummary } from '@/lib/api/organizations';
import { useCan } from '@/lib/operator';
import { useOrganizationList } from '@/lib/queries/organizations';
import { useCreateOrganization, useSetOrganizationSuspension } from '@/lib/queries/platform';

/** Platform area: every Organization, with create, suspend and reactivate. */
export function OrganizationsScreen() {
  const canManage = useCan('organizations:manage');
  const { data, error, isPending, refetch } = useOrganizationList(canManage);
  const create = useCreateOrganization();
  const setSuspension = useSetOrganizationSuspension();
  const columns = useMemo(
    () =>
      organizationColumns({
        pending: setSuspension.isPending,
        onToggle: (organization, suspend) => setSuspension.mutate({ id: organization.id, suspend }),
      }),
    [setSuspension],
  );

  if (!canManage) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">
        Managing Organizations needs the Permission to manage Organizations.
      </p>
    );
  }

  return (
    <div className="grid gap-6 px-4 pb-6">
      <form
        aria-label="Create Organization"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const text = (key: string) => {
            const value = data.get(key);
            return typeof value === 'string' ? value : '';
          };
          create.mutate({ name: text('name'), adminEmail: text('adminEmail') }, { onSuccess: () => form.reset() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-name" className="text-sm font-medium">
            Organization name
          </label>
          <Input id="org-name" name="name" required maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-admin-email" className="text-sm font-medium">
            First Organization Admin email
          </label>
          <Input id="org-admin-email" name="adminEmail" type="email" required />
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create Organization'}
        </Button>
      </form>

      <DataTable
        label="Organizations"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(organization) => organization.id}
        getRowLabel={(organization) => organization.name}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        emptyState={<EmptyListState title="No Organizations yet." description="Create the first one above." />}
      />
    </div>
  );
}

const orgColumn = createDataTableColumnHelper<OrganizationSummary>();

function organizationColumns({
  pending,
  onToggle,
}: {
  pending: boolean;
  onToggle: (organization: OrganizationSummary, suspend: boolean) => void;
}): DataTableColumns<OrganizationSummary> {
  return orgColumn.columns([
    orgColumn.accessor('name', {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    }),
    orgColumn.display({
      id: 'state',
      header: 'State',
      cell: ({ row }) => {
        const suspended = row.original.status === 'SUSPENDED';
        return <Badge variant={suspended ? 'outline' : 'secondary'}>{suspended ? 'Suspended' : 'Active'}</Badge>;
      },
    }),
    orgColumn.display({
      id: 'actions',
      header: 'Actions',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const suspended = row.original.status === 'SUSPENDED';
        return (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onToggle(row.original, !suspended)}>
            {suspended ? 'Reactivate' : 'Suspend'}
          </Button>
        );
      },
    }),
  ]);
}
