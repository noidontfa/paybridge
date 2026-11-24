/**
 * The only attempt states a Gateway Plugin may report. `EXPIRED` and
 * `CANCELLED` are decided by Core and are deliberately not representable here.
 */
export const NORMALIZED_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REQUIRES_REVIEW',
] as const;

export type NormalizedStatus = (typeof NORMALIZED_STATUSES)[number];

/** A provider-reported outcome, as returned by `query` and `parseCallback`. */
export interface NormalizedOutcome {
  readonly status: NormalizedStatus;
  /**
   * The amount the provider reports, as a decimal string in the currency's
   * major unit (VND: whole dong), already scaled back from provider units by
   * the plugin. `null` when the provider does not report one.
   */
  readonly amount: string | null;
  /** The provider's own status code, for logs and review. Never interpreted by Core. */
  readonly rawCode?: string;
}
