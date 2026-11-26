'use client';

import { ErrorState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/operator';
import { useOrganizationList } from '@/lib/queries/organizations';
import { useCreateOrganization, useSetOrganizationSuspension } from '@/lib/queries/platform';

/** Platform area: every Organization, with create, suspend and reactivate. */
export function OrganizationsScreen() {
  const canManage = useCan('organizations:manage');
  const { data, error, isPending, refetch } = useOrganizationList(canManage);
  const create = useCreateOrganization();
  const setSuspension = useSetOrganizationSuspension();

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

      {isPending && !error ? (
        <Skeleton role="status" aria-label="Loading organizations" className="h-40 rounded-xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <Table aria-label="Organizations">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((organization) => {
              const suspended = organization.status === 'SUSPENDED';
              return (
                <TableRow key={organization.id} aria-label={organization.name}>
                  <TableCell>{organization.name}</TableCell>
                  <TableCell>
                    <Badge variant={suspended ? 'outline' : 'secondary'}>{suspended ? 'Suspended' : 'Active'}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setSuspension.isPending}
                      onClick={() => setSuspension.mutate({ id: organization.id, suspend: !suspended })}
                    >
                      {suspended ? 'Reactivate' : 'Suspend'}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
