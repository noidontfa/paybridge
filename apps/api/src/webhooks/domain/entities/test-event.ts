import { PAYMENT_EVENT_KINDS } from './event-kinds.js';

/** The kind of a test send: no Payment, no subscription needed. */
export const TEST_EVENT_KIND = 'webhook.test';

/** Every kind a delivery can carry: the Payment Event kinds and test sends. */
export const DELIVERY_KINDS = [...PAYMENT_EVENT_KINDS, TEST_EVENT_KIND] as const;

/** The `data` of a test event's envelope. */
export function testEventData(endpointId: string) {
  return {
    endpointId,
    message:
      'A test event from PayBridge. Real deliveries carry a Payment here.',
  };
}
