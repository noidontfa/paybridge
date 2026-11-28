'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/shared/copy-button';
import type { ReactNode } from 'react';
import { createDataTableColumnHelper, DataTable, type DataTableColumns } from '@/components/shared/data-table/data-table';
import { EmptyListState } from '@/components/shared/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PUBLISHABLE_KEY_LABEL_MAX_LENGTH, type PublishableKey } from '@/lib/api/publishable-keys';
import {
  useCreatePublishableKey,
  usePublishableKeys,
  useRevokePublishableKey,
  useSetPublishableKeyOrigins,
} from '@/lib/queries/publishable-keys';
import { useCan } from '@/features/auth/hooks/use-operator';

const when = (iso: string) => new Date(iso).toLocaleString();

/** One origin per line (commas also separate), blanks dropped. */
const parseOrigins = (text: string) =>
  text
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean);

const textareaClass =
  'min-h-16 w-96 max-w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

function OriginsEditor({ publishableKey, onDone }: { publishableKey: PublishableKey; onDone: () => void }) {
  const save = useSetPublishableKeyOrigins();
  const [text, setText] = useState(publishableKey.allowedOrigins.join('\n'));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync({ id: publishableKey.id, allowedOrigins: parseOrigins(text) });
      onDone();
    } catch {
      // The error is shown from `save.error`.
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <textarea
        aria-label={`Allowed origins of ${publishableKey.label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={textareaClass}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save origins
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

/**
 * Publishable Keys of the current Organization (ADR 0009): public keys for the
 * Embedded Checkout, each limited to its allowed websites. Create, list (the
 * full key, it is not secret), edit allowed origins, revoke.
 */
export function PublishableKeysScreen() {
  const canManage = useCan('publishable-keys:manage');
  const { data, error, isPending, refetch } = usePublishableKeys();
  const create = useCreatePublishableKey();
  const revoke = useRevokePublishableKey();
  const [label, setLabel] = useState('');
  const [origins, setOrigins] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  if (!canManage) {
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        You do not have permission to manage Publishable Keys. Ask an Organization Admin.
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    try {
      await create.mutateAsync({ label: label.trim(), allowedOrigins: parseOrigins(origins) });
      setLabel('');
      setOrigins('');
    } catch {
      // The error is shown from `create.error`.
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <form
        aria-label="Create Publishable Key"
        onSubmit={(e) => void submit(e)}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-sm">
          Label
          <Input
            value={label}
            maxLength={PUBLISHABLE_KEY_LABEL_MAX_LENGTH}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Landing page"
            className="w-64"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Allowed origins
          <textarea
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder={'https://shop.example.com\nhttps://www.example.com'}
            className={textareaClass}
          />
        </label>
        <Button type="submit" disabled={create.isPending || !label.trim() || !origins.trim()}>
          Create Publishable Key
        </Button>
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </form>
      <p className="text-sm text-muted-foreground">
        One origin per line: scheme, host and port, such as https://shop.example.com. The key works only from these
        websites, and only for the Embedded Checkout. It is public, so it can be copied again at any time.
      </p>

      <DataTable
        label="Publishable Keys"
        columns={publishableKeyColumns({
          origins: (key) =>
            editing === key.id ? (
              <OriginsEditor publishableKey={key} onDone={() => setEditing(null)} />
            ) : (
              <ul className="font-mono text-xs">
                {key.allowedOrigins.map((origin) => (
                  <li key={origin}>{origin}</li>
                ))}
              </ul>
            ),
          actions: (key) =>
            key.revokedAt ? null : (
              <span className="flex justify-end gap-2">
                {editing !== key.id && (
                  <Button variant="outline" size="sm" aria-label={`Edit origins of ${key.label}`} onClick={() => setEditing(key.id)}>
                    Edit origins
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  aria-label={`Revoke ${key.label}`}
                  onClick={() => revoke.mutate(key.id)}
                >
                  Revoke
                </Button>
              </span>
            ),
        })}
        rows={data?.items ?? []}
        getRowId={(key) => key.id}
        isLoading={isPending && !error}
        error={error}
        onRetry={() => void refetch()}
        emptyState={
          <EmptyListState title="No Publishable Keys yet." description="Create one above to put a Pricing Table on your website." />
        }
      />
    </div>
  );
}

const column = createDataTableColumnHelper<PublishableKey>();

function publishableKeyColumns({
  origins,
  actions,
}: {
  origins: (key: PublishableKey) => ReactNode;
  actions: (key: PublishableKey) => ReactNode;
}): DataTableColumns<PublishableKey> {
  return column.columns([
    column.accessor('label', {
      id: 'label',
      header: 'Label',
      cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
    }),
    column.display({
      id: 'key',
      header: 'Key',
      cell: ({ row }) => (
        <span className="flex items-center gap-1">
          <code className="font-mono text-xs break-all">{row.original.key}</code>
          <CopyButton value={row.original.key} label="Publishable Key" />
        </span>
      ),
    }),
    column.display({ id: 'origins', header: 'Allowed origins', cell: ({ row }) => origins(row.original) }),
    column.display({
      id: 'createdAt',
      header: 'Created',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {when(row.original.createdAt)}
          {row.original.createdBy.label && <span className="block text-muted-foreground">by {row.original.createdBy.label}</span>}
        </span>
      ),
    }),
    column.display({
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.revokedAt ? (
          <Badge variant="outline">Revoked {when(row.original.revokedAt)}</Badge>
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
