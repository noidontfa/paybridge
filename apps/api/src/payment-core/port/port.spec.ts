import * as port from './index.js';
import {
  GatewayNotFoundError,
  GatewayRejectedError,
  GatewayUnavailableError,
  InvalidCallbackError,
  OutcomeUnknownError,
  isGatewayError,
} from './index.js';
import type {
  NextAction,
  NormalizedOutcome,
  NormalizedStatus,
  PaymentGateway,
} from './index.js';

describe('PaymentGateway port', () => {
  describe('error categories', () => {
    it.each([
      [new GatewayRejectedError('declined'), 'GatewayRejected', false],
      [new GatewayUnavailableError('503'), 'GatewayUnavailable', true],
      [new OutcomeUnknownError('timeout after send'), 'OutcomeUnknown', false],
      [
        new InvalidCallbackError('bad signature', {
          httpStatus: 400,
          body: { RspCode: '97' },
        }),
        'InvalidCallback',
        false,
      ],
      [new GatewayNotFoundError('no such txn'), 'NotFound', false],
    ] as const)('%s is %s with retryable=%s', (error, category, retryable) => {
      expect(error.category).toBe(category);
      expect(error.retryable).toBe(retryable);
      expect(error).toBeInstanceOf(Error);
      expect(isGatewayError(error)).toBe(true);
    });

    it('an invalid callback carries the error acknowledgement', () => {
      const error = new InvalidCallbackError('bad signature', {
        httpStatus: 200,
        body: { RspCode: '97', Message: 'Invalid signature' },
      });
      expect(error.ack.body).toEqual({
        RspCode: '97',
        Message: 'Invalid signature',
      });
    });

    it('a plain Error is not a gateway error', () => {
      expect(isGatewayError(new Error('boom'))).toBe(false);
    });
  });

  describe('normalised outcome', () => {
    it('allows only the four plugin-reported states', () => {
      expect([...port.NORMALIZED_STATUSES]).toEqual([
        'PENDING',
        'SUCCEEDED',
        'FAILED',
        'REQUIRES_REVIEW',
      ]);
      expectTypeOf<NormalizedStatus>().toEqualTypeOf<
        'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REQUIRES_REVIEW'
      >();
    });

    it('cannot represent EXPIRED or CANCELLED', () => {
      const expired: NormalizedOutcome = {
        // @ts-expect-error Core decides EXPIRED, plugins cannot report it
        status: 'EXPIRED',
        amount: null,
      };
      const cancelled: NormalizedOutcome = {
        // @ts-expect-error Core decides CANCELLED, plugins cannot report it
        status: 'CANCELLED',
        amount: null,
      };
      expect([expired, cancelled]).toHaveLength(2);
    });
  });

  describe('next action', () => {
    it('has four variants', () => {
      expectTypeOf<NextAction['type']>().toEqualTypeOf<
        'REDIRECT' | 'QR_CODE' | 'CLIENT_SDK' | 'VOUCHER'
      >();
    });

    it('adding a variant does not break existing narrowing', () => {
      // An existing consumer, written against the four Phase 1 variants. It is
      // generic over any union that contains them, as long as it keeps a
      // default branch.
      function describeAction<A extends { readonly type: string }>(
        action: A | NextAction,
      ): string {
        const known = action as NextAction;
        switch (known.type) {
          case 'REDIRECT':
            expectTypeOf(known.url).toBeString();
            return `redirect:${known.url}`;
          case 'QR_CODE':
            return `qr:${known.payload}`;
          case 'CLIENT_SDK':
            return `sdk:${known.token}`;
          case 'VOUCHER':
            return 'voucher';
          default:
            return `unknown:${action.type}`;
        }
      }

      // A future variant added to the union.
      type BankTransfer = { readonly type: 'BANK_TRANSFER'; iban: string };
      type ExtendedNextAction = NextAction | BankTransfer;

      // Narrowing an existing variant out of the extended union still yields
      // exactly the same type as before.
      expectTypeOf<
        Extract<ExtendedNextAction, { type: 'REDIRECT' }>
      >().toEqualTypeOf<Extract<NextAction, { type: 'REDIRECT' }>>();
      expectTypeOf<
        Extract<ExtendedNextAction, { type: 'QR_CODE' }>
      >().toEqualTypeOf<Extract<NextAction, { type: 'QR_CODE' }>>();

      const actions: ExtendedNextAction[] = [
        { type: 'REDIRECT', url: 'https://pay.example/1' },
        { type: 'BANK_TRANSFER', iban: 'VN00' },
      ];
      expect(actions.map((a) => describeAction<BankTransfer>(a))).toEqual([
        'redirect:https://pay.example/1',
        'unknown:BANK_TRANSFER',
      ]);
    });
  });

  describe('operations', () => {
    it('declares initiate, query, cancel and parseCallback, and no refund operations', () => {
      expectTypeOf<PaymentGateway>().toHaveProperty('initiate');
      expectTypeOf<PaymentGateway>().toHaveProperty('query');
      expectTypeOf<PaymentGateway>().toHaveProperty('cancel');
      expectTypeOf<PaymentGateway>().toHaveProperty('parseCallback');
      expectTypeOf<PaymentGateway>().toHaveProperty('gatewayId');
      expectTypeOf<PaymentGateway['capabilities']>().toHaveProperty(
        'supportsCancel',
      );
      expectTypeOf<
        Exclude<keyof PaymentGateway, 'gatewayId' | 'capabilities'>
      >().toEqualTypeOf<'initiate' | 'query' | 'cancel' | 'parseCallback'>();
    });
  });

  it('exports only port contract values, no plugin', () => {
    expect(Object.keys(port).sort()).toEqual([
      'GatewayError',
      'GatewayNotFoundError',
      'GatewayRejectedError',
      'GatewayUnavailableError',
      'InvalidCallbackError',
      'NORMALIZED_STATUSES',
      'OutcomeUnknownError',
      'isGatewayError',
    ]);
  });
});
