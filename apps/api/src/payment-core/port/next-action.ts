/**
 * What the customer must do next to complete a PaymentTransaction.
 *
 * A discriminated union on `type`. Consumers must keep a `default` branch when
 * switching on it, so that adding a variant later does not break them.
 * `VOUCHER` is unused in Phase 1 and kept on purpose for that reason.
 */
export type NextAction =
  | RedirectNextAction
  | QrCodeNextAction
  | ClientSdkNextAction
  | VoucherNextAction;

export interface RedirectNextAction {
  readonly type: 'REDIRECT';
  readonly url: string;
}

export interface QrCodeNextAction {
  readonly type: 'QR_CODE';
  readonly payload: string;
}

export interface ClientSdkNextAction {
  readonly type: 'CLIENT_SDK';
  readonly token: string;
  /**
   * Provider-neutral string parameters the client SDK needs (for example a
   * publishable key or a return URL). Core stores and returns them without
   * interpreting them.
   */
  readonly clientParams?: Readonly<Record<string, string>>;
}

export interface VoucherNextAction {
  readonly type: 'VOUCHER';
  readonly details: Readonly<Record<string, unknown>>;
}

export type NextActionType = NextAction['type'];
