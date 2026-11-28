import { SDK_PATH, SNIPPET_ATTRIBUTES as ATTR } from '@paybridge/checkout-snippet';

/**
 * The embed snippet for a Pricing Table: one script tag that loads the shared,
 * versioned PayBridge SDK from the checkout app (`apps/checkout`). The
 * attribute names come from `@paybridge/checkout-snippet`, which the SDK reads
 * them by too.
 */

/**
 * Where the checkout app serves the SDK. Public by nature (it ends up in every
 * host page), so it may reach the browser bundle.
 */
export const CHECKOUT_URL = process.env.NEXT_PUBLIC_PAYBRIDGE_CHECKOUT_URL || 'http://localhost:3200';

export { SDK_PATH };

/** Attributes the developer may add to the script tag. */
export const SNIPPET_OPTIONAL_ATTRIBUTES: readonly { name: string; description: string }[] = [
  {
    name: ATTR.customerReference,
    description: 'Your id for the Customer (or their email). It applies to whichever Pricing Plan they pick.',
  },
  { name: ATTR.askEmail, description: 'Set to "true" to ask the Customer for their email in the checkout.' },
  { name: ATTR.successUrl, description: 'Where to send the Customer after paying. Overrides the Pricing Plan’s success URL.' },
  { name: ATTR.cancelUrl, description: 'Where to send the Customer if they cancel. Overrides the Pricing Plan’s cancel URL.' },
];

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSnippet({
  checkoutUrl = CHECKOUT_URL,
  publishableKey,
  pricingTableId,
}: {
  checkoutUrl?: string;
  publishableKey: string;
  pricingTableId: string;
}): string {
  const src = `${checkoutUrl.replace(/\/+$/, '')}${SDK_PATH}`;
  return (
    `<script src="${attribute(src)}"\n` +
    `  ${ATTR.key}="${attribute(publishableKey)}"\n` +
    `  ${ATTR.table}="${attribute(pricingTableId)}"></script>`
  );
}
