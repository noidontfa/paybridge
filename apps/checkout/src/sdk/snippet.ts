import { SNIPPET_ATTRIBUTES as ATTR } from '@paybridge/checkout-snippet';

// What the host page's script tag asks for (the attribute names are shared
// with the Console through `@paybridge/checkout-snippet`):
//
//   <script src="https://checkout.paybridge.vn/v1/paybridge.js"
//           data-key="pb_pk_…" data-table="<Pricing Table id>"
//           data-customer-ref="user-42"            (optional)
//           data-ask-email="true"                  (optional: ask the Customer for an email)
//           data-success-url="https://…/thanks"    (optional, overrides the Pricing Plan's)
//           data-cancel-url="https://…/pricing"    (optional, overrides the Pricing Plan's)
//           data-on-success="onPaid"               (optional global function names)
//           data-on-cancel="onCancelled"
//           data-on-error="onCheckoutError"></script>

export interface Snippet {
  readonly key: string;
  readonly tableId: string;
  readonly customerReference?: string;
  readonly successUrl?: string;
  readonly cancelUrl?: string;
  /** `data-ask-email`: the checkout page asks for an email before starting the Payment. */
  readonly askEmail: boolean;
  readonly callbacks: {
    readonly onSuccess?: string;
    readonly onCancel?: string;
    readonly onError?: string;
  };
}

export type SnippetResult =
  | { readonly ok: true; readonly snippet: Snippet }
  | { readonly ok: false; readonly reason: string };

function optional(script: HTMLElement, name: string): string | undefined {
  const value = script.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function optionalUrl(script: HTMLElement, name: string): string | undefined {
  const value = optional(script, name);
  if (value === undefined) return undefined;
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol)
    ? value
    : undefined;
}

export function readSnippet(script: HTMLElement): SnippetResult {
  const key = optional(script, ATTR.key);
  const tableId = optional(script, ATTR.table);
  if (!key) return { ok: false, reason: 'MISSING_DATA_KEY' };
  if (!tableId) return { ok: false, reason: 'MISSING_DATA_TABLE' };
  const askEmail = script.getAttribute(ATTR.askEmail);
  return {
    ok: true,
    snippet: {
      key,
      tableId,
      customerReference: optional(script, ATTR.customerReference),
      successUrl: optionalUrl(script, ATTR.successUrl),
      cancelUrl: optionalUrl(script, ATTR.cancelUrl),
      askEmail: askEmail !== null && askEmail !== 'false',
      callbacks: {
        onSuccess: optional(script, ATTR.onSuccess),
        onCancel: optional(script, ATTR.onCancel),
        onError: optional(script, ATTR.onError),
      },
    },
  };
}
