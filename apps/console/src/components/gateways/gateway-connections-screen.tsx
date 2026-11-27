'use client';

import { useState } from 'react';
import { ErrorState } from '@/components/data-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/services/errors';
import { CREDENTIAL_FIELDS, type GatewayConnection } from '@/lib/api/gateway-connections';
import {
  useConnectGateway,
  useDeleteConnection,
  useGatewayConnections,
  useReplaceCredentials,
  useSetConnectionEnabled,
} from '@/lib/queries/gateway-connections';
import { useCan } from '@/lib/operator';

const MANAGE = 'gateway-connections:manage';

/** Credentials are typed here and sent once; nothing the API returns ever fills them. */
function CredentialsForm({
  gatewayId,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  gatewayId: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (credentials: Record<string, string>) => void;
}) {
  const fields = CREDENTIAL_FIELDS[gatewayId] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      aria-label={`${submitLabel} ${gatewayId}`}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(fields.length > 0 ? values : {});
      }}
    >
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1 text-sm">
          {field.label}
          <Input
            type="password"
            autoComplete="off"
            required
            placeholder={field.placeholder}
            value={values[field.name] ?? ''}
            onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
          />
        </label>
      ))}
      {fields.length === 0 && <p className="text-sm text-muted-foreground">This gateway takes no credentials.</p>}
      {error instanceof ApiError && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function ConnectionCard({ connection }: { connection: GatewayConnection }) {
  const can = useCan(MANAGE);
  const [replacing, setReplacing] = useState(false);
  const toggle = useSetConnectionEnabled();
  const replace = useReplaceCredentials();
  const remove = useDeleteConnection();
  const takesCredentials = connection.gatewayId in CREDENTIAL_FIELDS;
  return (
    <article aria-label={connection.gatewayId} className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{connection.gatewayId}</h2>
        <Badge variant={connection.enabled ? 'default' : 'secondary'}>{connection.enabled ? 'Enabled' : 'Disabled'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {connection.credentialFields.length > 0
          ? `Credentials set: ${connection.credentialFields.join(', ')}. Values are never shown.`
          : 'No credentials.'}
      </p>
      {can && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate({ id: connection.id, enabled: !connection.enabled })}
          >
            {connection.enabled ? 'Disable' : 'Enable'}
          </Button>
          {takesCredentials && (
            <Button variant="outline" onClick={() => setReplacing(!replacing)}>
              Replace credentials
            </Button>
          )}
          <Button variant="outline" disabled={remove.isPending} onClick={() => remove.mutate(connection.id)}>
            Delete
          </Button>
        </div>
      )}
      {toggle.error instanceof ApiError && <p role="alert" className="text-sm text-destructive">{toggle.error.message}</p>}
      {remove.error instanceof ApiError && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}
      {replacing && (
        <CredentialsForm
          gatewayId={connection.gatewayId}
          submitLabel="Save credentials for"
          pending={replace.isPending}
          error={replace.error}
          onSubmit={(credentials) =>
            replace.mutate({ id: connection.id, credentials }, { onSuccess: () => setReplacing(false) })
          }
        />
      )}
    </article>
  );
}

function ConnectForm({ connected }: { connected: Set<string> }) {
  const connect = useConnectGateway();
  const available = Object.keys(CREDENTIAL_FIELDS).filter((id) => !connected.has(id));
  const [gatewayId, setGatewayId] = useState<string>('');
  const chosen = gatewayId || available[0];
  if (!chosen) return null;
  return (
    <section aria-label="Connect a gateway" className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-lg font-semibold tracking-tight">Connect a gateway</h2>
      <label className="flex flex-col gap-1 text-sm">
        PaymentGateway
        <select
          className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
          value={chosen}
          onChange={(event) => setGatewayId(event.target.value)}
        >
          {available.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <CredentialsForm
        key={chosen}
        gatewayId={chosen}
        submitLabel="Connect"
        pending={connect.isPending}
        error={connect.error}
        onSubmit={(credentials) => connect.mutate({ gatewayId: chosen, credentials })}
      />
    </section>
  );
}

export function GatewayConnectionsScreen() {
  const can = useCan(MANAGE);
  const { data, error, isPending, refetch } = useGatewayConnections();

  if (!can) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">You do not have permission to manage Gateway Connections.</p>;
  }
  if (isPending && !error) {
    return (
      <div role="status" aria-label="Loading Gateway Connections" className="grid gap-4 px-4 pb-6 md:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 pb-4">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  return (
    <div className="grid gap-4 px-4 pb-6 md:grid-cols-2">
      {data.items.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} />
      ))}
      <ConnectForm connected={new Set(data.items.map((c) => c.gatewayId))} />
    </div>
  );
}
