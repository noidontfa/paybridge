'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/shared/copy-button';
import type { ReactNode } from 'react';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/shared/data-table/data-table';
import { EmptyListState } from '@/components/shared/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_KEY_LABEL_MAX_LENGTH, type ApiKey, type CreatedApiKey } from '@/features/api-keys/api';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/features/api-keys/hooks/queries';
import { useCan } from '@/features/auth/hooks/use-operator';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');

/** API Keys of the current Organization: create (shown once), list, revoke. */
export function ApiKeysScreen() {
  const canManage = useCan('api-keys:manage');
  const { data, error, isPending, refetch } = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  if (!canManage) {
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        You do not have permission to manage API Keys. Ask an Organization Admin.
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    const result = await create.mutateAsync(label.trim());
    setCreated(result);
    setLabel('');
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <form aria-label="Create API Key" onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Label
          <Input
            value={label}
            maxLength={API_KEY_LABEL_MAX_LENGTH}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Billing system"
            className="w-64"
          />
        </label>
        <Button type="submit" disabled={create.isPending || !label.trim()}>
          Create API Key
        </Button>
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </form>

      {created && (
        <div role="status" aria-label="New API Key" className="rounded-xl border border-primary p-4">
          <p className="mb-2 text-sm font-medium">Copy this key now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm break-all">{created.key}</code>
            <CopyButton value={created.key} label="API Key" />
            <Button variant="outline" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <DataTable
        label="API Keys"
        columns={apiKeyColumns((key) =>
          key.revokedAt ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={revoke.isPending}
              aria-label={`Revoke ${key.label}`}
              onClick={() => revoke.mutate(key.id)}
            >
              Revoke
            </Button>
          ),
        )}
        rows={data?.items ?? []}
        getRowId={(key) => key.id}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        emptyState={<EmptyListState title="No API Keys yet." description="Create one above for your server to call the PayBridge API." />}
      />
    </div>
  );
}

const column = createDataTableColumnHelper<ApiKey>();

function apiKeyColumns(actions: (key: ApiKey) => ReactNode): DataTableColumns<ApiKey> {
  return column.columns([
    column.accessor('label', {
      id: 'label',
      header: 'Label',
      cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    }),
    column.display({
      id: 'prefix',
      header: 'Prefix',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.prefix}…</span>,
    }),
    column.display({
      id: 'createdAt',
      header: 'Created',
      cell: ({ row }) => <span className="whitespace-nowrap">{when(row.original.createdAt)}</span>,
    }),
    column.display({
      id: 'lastUsedAt',
      header: 'Last used',
      cell: ({ row }) =>
        row.original.lastUsedAt ? (
          <span className="whitespace-nowrap">{when(row.original.lastUsedAt)}</span>
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    }),
    column.display({
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.revokedAt ? (
          <Badge variant="outline" title={`Revoked ${when(row.original.revokedAt)}`}>
            Revoked {when(row.original.revokedAt)}
          </Badge>
        ) : (
          <Badge variant="secondary">Active</Badge>
        ),
    }),
    column.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { align: 'right' },
      cell: ({ row }) => actions(row.original),
    }),
  ]);
}
