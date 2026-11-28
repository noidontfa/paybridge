// The Embedded Checkout snippet contract. The Console writes the snippet a
// developer pastes into a host page; the checkout app's SDK reads the same
// script tag. Both import the names from here, so they cannot drift apart.
//
//   <script src="<checkout app>/v1/paybridge.js"
//           data-key="pb_pk_…" data-table="<Pricing Table id>"
//           data-customer-ref="user-42" data-ask-email="true"
//           data-success-url="https://…" data-cancel-url="https://…"
//           data-on-success="onPaid" data-on-cancel="…" data-on-error="…"></script>

/** The script tag's attributes, by what they carry. */
export const SNIPPET_ATTRIBUTES = {
  /** Required: the Publishable Key. */
  key: 'data-key',
  /** Required: the Pricing Table id. */
  table: 'data-table',
  /** The Organization's id for the Customer. */
  customerReference: 'data-customer-ref',
  /** "true" asks the Customer for an email in the checkout. */
  askEmail: 'data-ask-email',
  /** Overrides the Pricing Plan's success URL. */
  successUrl: 'data-success-url',
  /** Overrides the Pricing Plan's cancel URL. */
  cancelUrl: 'data-cancel-url',
  /** Names of global functions the SDK calls back. */
  onSuccess: 'data-on-success',
  onCancel: 'data-on-cancel',
  onError: 'data-on-error',
} as const;

export type SnippetAttribute =
  (typeof SNIPPET_ATTRIBUTES)[keyof typeof SNIPPET_ATTRIBUTES];

/** The major version the snippet pins: fixes arrive without a new snippet. */
export const SDK_MAJOR = 1;
export const SDK_PATH = `/v${SDK_MAJOR}/paybridge.js`;
