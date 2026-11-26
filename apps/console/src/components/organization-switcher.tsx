'use client';

import { useCan } from '@/lib/operator';
import { useOrganizationList } from '@/lib/queries/organizations';

/** Must match the BFF's `ORGANIZATION_COOKIE`: it forwards the choice to the API. */
const COOKIE = 'pb_org';
const ALL = 'all';

function readChoice(): string {
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : ALL;
}

/**
 * A Super Admin works in one Organization at a time, or reads across all of
 * them. Writes need one chosen Organization; the API refuses them otherwise.
 * Shown only with the Permission to manage Organizations.
 */
export function OrganizationSwitcher() {
  // Only whoever may manage Organizations works across them.
  const canSwitch = useCan('organizations:manage');
  const { data } = useOrganizationList(canSwitch);
  if (!canSwitch) return null;
  const choice = typeof document === 'undefined' ? ALL : readChoice();
  return (
    <label className="flex flex-col gap-1 px-2 text-xs text-sidebar-foreground/70">
      Organization
      <select
        aria-label="Organization"
        className="rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 text-sm text-sidebar-foreground"
        value={choice}
        onChange={(event) => {
          document.cookie = `${COOKIE}=${encodeURIComponent(event.target.value)}; path=/; max-age=31536000; samesite=lax`;
          // Every screen reads through the chosen Organization: start afresh.
          window.location.reload();
        }}
      >
        <option value={ALL}>All Organizations</option>
        {(data?.items ?? []).map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}
