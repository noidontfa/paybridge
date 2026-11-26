/** Something an operator must look at. */
export interface Alert {
  /** Stable kind, e.g. `webhook-inbox.exhausted`. */
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Where Core raises alerts. The default (`LoggerAlertSink`) writes an error log
 * line; deployments bind a pager or chat integration to this token without
 * touching Core.
 */
export abstract class AlertSink {
  abstract raise(alert: Alert): void | Promise<void>;
}

/**
 * Lets an alert fire at most once per window for a key, so a row that stays
 * broken does not alert on every sweep run. The shared store is infrastructure.
 */
export abstract class AlertThrottle {
  /** True when the caller is the first to claim `key` in this window. */
  abstract claim(key: string, windowSeconds: number): Promise<boolean>;
}
