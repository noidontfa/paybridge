'use client';

import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { ErrorState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SECRET_OVERLAPS,
  WEBHOOK_EVENT_KINDS,
  type CreatedWebhookEndpoint,
  type SecretOverlap,
  type WebhookEndpoint,
  type WebhookEndpointInput,
  type WebhookEventKind,
} from '@/lib/api/webhook-endpoints';
import { useCan } from '@/lib/operator';
import { useSendTestWebhook } from '@/lib/queries/webhook-deliveries';
import {
  useCreateWebhookEndpoint,
  useDeleteWebhookEndpoint,
  useRollWebhookEndpointSecret,
  useSetWebhookEndpointEnabled,
  useUpdateWebhookEndpoint,
  useWebhookEndpoints,
} from '@/lib/queries/webhook-endpoints';

const when = (iso: string) => new Date(iso).toLocaleString();

/** Sends a `webhook.test` event to one endpoint and says what the receiver answered. */
function TestSend({ endpoint }: { endpoint: WebhookEndpoint }) {
  const send = useSendTestWebhook();
  const attempt = send.data?.history[0];
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={send.isPending}
        aria-label={`Send a test event to ${endpoint.url}`}
        onClick={() => send.mutate(endpoint.id)}
      >
        {send.isPending ? 'Sending…' : 'Send test'}
      </Button>
      {send.error && (
        <p role="alert" className="text-xs text-destructive">
          {send.error.message}
        </p>
      )}
      {attempt && !send.isPending && (
        <p role="status" aria-label={`Test result for ${endpoint.url}`} className="text-xs">
          {attempt.succeeded
            ? `Test delivered (HTTP ${attempt.httpStatus ?? '?'})`
            : `Test failed: ${attempt.error ?? 'no answer'}`}
        </p>
      )}
    </div>
  );
}

/** A Super Admin's change is shown as made by the platform. */
const writer = (endpoint: WebhookEndpoint) => endpoint.updatedBy.label ?? endpoint.updatedBy.name;

/** The endpoint form, for adding one or editing one. */
function EndpointForm({
  label,
  submitLabel,
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial: { url: string; eventKinds: readonly string[] };
  pending: boolean;
  error: Error | null;
  onSubmit: (input: WebhookEndpointInput) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState(initial.url);
  const [kinds, setKinds] = useState<ReadonlySet<string>>(new Set(initial.eventKinds));
  const chosen = WEBHOOK_EVENT_KINDS.filter((k) => kinds.has(k));

  function toggle(kind: WebhookEventKind) {
    const next = new Set(kinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setKinds(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || chosen.length === 0) return;
    try {
      await onSubmit({ url: url.trim(), eventKinds: chosen });
    } catch {
      // Shown from the mutation's error below.
    }
  }

  return (
    <form aria-label={label} onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl border p-4">
      <label className="flex flex-col gap-1 text-sm">
        URL
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://erp.example.com/paybridge/webhooks"
          className="max-w-xl"
        />
      </label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <legend className="mb-1">Payment Events to receive</legend>
        {WEBHOOK_EVENT_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-1 font-mono">
            <input type="checkbox" checked={kinds.has(kind)} onChange={() => toggle(kind)} />
            {kind}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !url.trim() || chosen.length === 0}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Rolls an endpoint's signing secret. The old secret keeps signing for the
 * chosen time, so the Organization's system can switch without rejecting one.
 */
function RollSecretForm({
  endpoint,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  endpoint: WebhookEndpoint;
  pending: boolean;
  error: Error | null;
  onSubmit: (overlap: SecretOverlap) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [overlap, setOverlap] = useState<SecretOverlap>('24h');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await onSubmit(overlap);
    } catch {
      // Shown from the mutation's error below.
    }
  }

  return (
    <form
      aria-label="Roll signing secret"
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded-xl border p-4"
    >
      <p className="text-sm">
        Roll the signing secret of <span className="font-mono break-all">{endpoint.url}</span>. Until the old secret
        expires, every Webhook carries a signature for each secret.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Keep the old secret valid for
        <select
          value={overlap}
          onChange={(e) => setOverlap(e.target.value as SecretOverlap)}
          className="h-9 max-w-xs rounded-md border bg-transparent px-2"
        >
          {SECRET_OVERLAPS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          Roll secret
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Webhook Endpoints of the current Organization: add one (its signing secret
 * is shown once), edit, roll its secret, disable or enable, delete.
 */
export function WebhookEndpointsScreen() {
  const canManage = useCan('webhook-endpoints:manage');
  const { data, error, isPending, refetch } = useWebhookEndpoints();
  const create = useCreateWebhookEndpoint();
  const update = useUpdateWebhookEndpoint();
  const setEnabled = useSetWebhookEndpointEnabled();
  const remove = useDeleteWebhookEndpoint();
  const roll = useRollWebhookEndpointSecret();
  const [created, setCreated] = useState<CreatedWebhookEndpoint | null>(null);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [rolling, setRolling] = useState<WebhookEndpoint | null>(null);
  // Remounts the add form after a success, so it starts empty again.
  const [formKey, setFormKey] = useState(0);

  if (!canManage) {
    return (
      <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">
        You do not have permission to manage Webhook Endpoints. Ask an Organization Admin.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      {rolling ? (
        <RollSecretForm
          key={`roll-${rolling.id}`}
          endpoint={rolling}
          pending={roll.isPending}
          error={roll.error}
          onCancel={() => setRolling(null)}
          onSubmit={async (overlap) => {
            setCreated(await roll.mutateAsync({ id: rolling.id, overlap }));
            setRolling(null);
          }}
        />
      ) : editing ? (
        <EndpointForm
          key={`edit-${editing.id}`}
          label="Edit Webhook Endpoint"
          submitLabel="Save"
          initial={editing}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            await update.mutateAsync({ id: editing.id, ...input });
            setEditing(null);
          }}
        />
      ) : (
        <EndpointForm
          key={`add-${formKey}`}
          label="Add Webhook Endpoint"
          submitLabel="Add endpoint"
          initial={{ url: '', eventKinds: ['payment.succeeded'] }}
          pending={create.isPending}
          error={create.error}
          onSubmit={async (input) => {
            setCreated(await create.mutateAsync(input));
            setFormKey((k) => k + 1);
          }}
        />
      )}

      {created && (
        <div role="status" aria-label="New signing secret" className="rounded-xl border border-primary p-4">
          <p className="mb-2 text-sm font-medium">
            Copy this signing secret now. It will not be shown again. Your system uses it to check the
            PayBridge-Signature header of every Webhook.
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm break-all">{created.secret}</code>
            <CopyButton value={created.secret} label="Signing secret" />
            <Button variant="outline" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {isPending && !error ? (
        <Skeleton role="status" aria-label="Loading Webhook Endpoints" className="h-24 rounded-xl" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Webhook Endpoints yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">URL</th>
              <th>Payment Events</th>
              <th>Secret</th>
              <th>Status</th>
              <th>Last change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((endpoint) => (
              <tr key={endpoint.id} className="border-t align-top">
                <td className="py-2 font-mono break-all">{endpoint.url}</td>
                <td className="font-mono">{endpoint.eventKinds.join(', ')}</td>
                <td>
                  <span className="font-mono">{endpoint.secretPrefix}…</span>
                  {endpoint.previousSecretExpiresAt && (
                    <p className="text-xs text-muted-foreground">
                      Previous secret valid until {when(endpoint.previousSecretExpiresAt)}
                    </p>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={endpoint.status === 'ENABLED' ? 'default' : 'secondary'}>
                      {endpoint.status === 'ENABLED' ? 'Enabled' : 'Disabled'}
                    </Badge>
                    {endpoint.failing && (
                      <Badge variant="destructive" title="Its latest deliveries all failed. Check the receiver.">
                        Failing
                      </Badge>
                    )}
                  </div>
                </td>
                <td>
                  {when(endpoint.updatedAt)} by {writer(endpoint)}
                </td>
                <td className="flex justify-end gap-1 py-2">
                  <TestSend endpoint={endpoint} />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${endpoint.url}`}
                    onClick={() => setEditing(endpoint)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Roll secret ${endpoint.url}`}
                    onClick={() => {
                      setEditing(null);
                      setRolling(endpoint);
                    }}
                  >
                    Roll secret
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={setEnabled.isPending}
                    aria-label={`${endpoint.status === 'ENABLED' ? 'Disable' : 'Enable'} ${endpoint.url}`}
                    onClick={() => setEnabled.mutate({ id: endpoint.id, enabled: endpoint.status !== 'ENABLED' })}
                  >
                    {endpoint.status === 'ENABLED' ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    aria-label={`Delete ${endpoint.url}`}
                    onClick={() => remove.mutate(endpoint.id)}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
