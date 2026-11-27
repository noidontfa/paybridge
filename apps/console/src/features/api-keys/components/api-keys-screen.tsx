'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { ErrorState } from '@/components/data-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { API_KEY_LABEL_MAX_LENGTH, type CreatedApiKey } from '@/features/api-keys/api';
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

      {isPending && !error ? (
        <Skeleton role="status" aria-label="Loading API Keys" className="h-24 rounded-xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API Keys yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Label</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((key) => (
              <tr key={key.id} className="border-t">
                <td className="py-2">{key.label}</td>
                <td className="font-mono">{key.prefix}…</td>
                <td>{when(key.createdAt)}</td>
                <td>{when(key.lastUsedAt)}</td>
                <td>{key.revokedAt ? `Revoked ${when(key.revokedAt)}` : 'Active'}</td>
                <td className="text-right">
                  {!key.revokedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      aria-label={`Revoke ${key.label}`}
                      onClick={() => revoke.mutate(key.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
