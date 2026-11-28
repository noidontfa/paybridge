'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CopyButton } from '@/components/shared/copy-button';
import { ErrorState } from '@/components/shared/data-states';
import { Skeleton } from '@/components/ui/skeleton';
import { buildSnippet, SNIPPET_OPTIONAL_ATTRIBUTES } from '@/lib/checkout-snippet';
import { useCan } from '@/features/auth/hooks/use-operator';
import { usePublishableKeys } from '@/lib/queries/publishable-keys';

export const PUBLISHABLE_KEYS_MANAGE = 'publishable-keys:manage';

function KeyPicker({ pricingTableId }: { pricingTableId: string }) {
  const { data, error, isPending, refetch } = usePublishableKeys();
  const [chosen, setChosen] = useState<string | null>(null);

  if (isPending && !error) return <Skeleton role="status" aria-label="Loading Publishable Keys" className="h-16 rounded-lg" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const keys = data.items.filter((k) => !k.revokedAt);
  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Publishable Key yet.{' '}
        <Link href="/settings/publishable-keys" className="underline underline-offset-4">
          Create one
        </Link>{' '}
        for the websites that will show this Pricing Table.
      </p>
    );
  }
  const key = keys.find((k) => k.id === chosen) ?? keys[0]!;
  const snippet = buildSnippet({ publishableKey: key.key, pricingTableId });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Publishable Key
        <select
          className="h-8 w-fit rounded-lg border border-input bg-transparent px-2 text-sm"
          value={key.id}
          onChange={(e) => setChosen(e.target.value)}
        >
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label} ({k.allowedOrigins.join(', ')})
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Works only on {key.allowedOrigins.join(', ')}. Add a website to the key&apos;s allowed origins to use it elsewhere.
      </p>
      <div className="flex items-start gap-2">
        <pre aria-label="Snippet" className="flex-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          <code>{snippet}</code>
        </pre>
        <CopyButton value={snippet} label="snippet" />
      </div>
    </div>
  );
}

/**
 * The script tag that embeds this Pricing Table, for a chosen Publishable Key,
 * with the optional attributes explained next to it. Listing keys needs
 * `publishable-keys:manage`.
 */
export function PricingTableSnippet({ pricingTableId }: { pricingTableId: string }) {
  const canListKeys = useCan(PUBLISHABLE_KEYS_MANAGE);
  return (
    <section aria-label="Embed" className="flex max-w-3xl flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">Embed on your website</h2>
      <p className="text-sm text-muted-foreground">
        Paste this where the price cards should appear. Changes to this Pricing Table and its Pricing Plans show on every page
        that embeds it.
      </p>
      {canListKeys ? (
        <KeyPicker pricingTableId={pricingTableId} />
      ) : (
        <p className="text-sm text-muted-foreground">An Organization Admin can copy the snippet with a Publishable Key.</p>
      )}
      <dl aria-label="Optional attributes" className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {SNIPPET_OPTIONAL_ATTRIBUTES.map((a) => (
          <div key={a.name} className="contents">
            <dt>
              <code className="text-xs">{a.name}</code>
            </dt>
            <dd className="text-muted-foreground">{a.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
