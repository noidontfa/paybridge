/**
 * Seeds the Callbacks (webhook inbox). Runs after the Payments, with its own
 * `Random`, so adding it did not change any Payment. Covers every inbox
 * status, JSON and non-JSON bodies, FAILED rows with a last error, and
 * Attempt Keys that match no PaymentTransaction. Only `stripe` and `fake`.
 */
import type { CallbackStatus } from '@/features/callbacks/api';
import type { Random } from './random';
import type { MockAttempt, MockCallback, MockStore } from './store';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const STRIPE_HEADERS = { 'content-type': 'application/json', 'stripe-signature': 't=1764039600,v1=redacted' };
const FAKE_HEADERS = { 'content-type': 'application/x-www-form-urlencoded', 'x-fake-signature': 'redacted' };

const LAST_ERRORS = [
  'Signature verification failed',
  'Timed out waiting for the PaymentTransaction lock',
  'Provider status query returned 503',
];

function bodyFor(gatewayId: string, random: Random, attemptKey: string | null, eventId: string | null): Pick<MockCallback, 'rawBody' | 'headers' | 'query'> {
  if (gatewayId === 'stripe') {
    const body = {
      ...(eventId && { id: eventId }),
      type: 'payment_intent.succeeded',
      data: { object: { id: `pi_${random.token(24)}`, metadata: attemptKey ? { attemptKey } : {} } },
    };
    // Minified, like a real delivery: the Console pretty-prints it.
    return { rawBody: JSON.stringify(body), headers: STRIPE_HEADERS, query: {} };
  }
  const params = new URLSearchParams({ ref: `FAKE-${random.token(10).toUpperCase()}`, result: random.pick(['PAID', 'FAILED']) });
  if (attemptKey) params.set('attempt', attemptKey);
  return { rawBody: params.toString(), headers: FAKE_HEADERS, query: { gateway: 'fake' } };
}

export function seedCallbacks(store: MockStore, random: Random): void {
  const nowMs = store.now.getTime();
  const iso = (ms: number) => new Date(Math.min(ms, nowMs)).toISOString();
  let counter = 0;

  const add = (
    gatewayId: string,
    attemptKey: string | null,
    status: CallbackStatus,
    receivedMs: number,
    options: { noEventId?: boolean; body?: string; attempts?: number } = {},
  ) => {
    counter += 1;
    const eventId = options.noEventId ? null : gatewayId === 'stripe' ? `evt_${random.token(24)}` : `FAKE-EVT-${counter}`;
    const base = bodyFor(gatewayId, random, attemptKey, eventId);
    const processed = status === 'PROCESSED';
    store.callbacks.push({
      id: random.uuid(),
      gatewayId,
      providerEventId: eventId,
      attemptKey,
      status,
      attempts: options.attempts ?? (status === 'RECEIVED' ? 0 : status === 'FAILED' ? random.int(2, 5) : 1),
      receivedAt: iso(receivedMs),
      processedAt: processed ? iso(receivedMs + random.int(1, 4) * SECOND) : null,
      ...base,
      ...(options.body !== undefined && { rawBody: options.body }),
      lastError: status === 'FAILED' ? random.pick(LAST_ERRORS) : null,
    });
  };

  // One Callback for roughly every other PaymentTransaction that reached the gateway.
  const reached = store.attempts.filter((a: MockAttempt) => a.providerRef !== null);
  reached.forEach((attempt, index) => {
    if (index % 2 === 0) add(attempt.gatewayId, attempt.id, 'PROCESSED', Date.parse(attempt.updatedAt) - 2 * SECOND);
  });

  // The other statuses, on known attempts (recent, so RECEIVED and PROCESSING look live).
  const known = reached.slice(-8);
  add(known[0]!.gatewayId, known[0]!.id, 'RECEIVED', nowMs - 20 * SECOND);
  add(known[1]!.gatewayId, known[1]!.id, 'PROCESSING', nowMs - 2 * MINUTE, { attempts: 1 });
  add(known[2]!.gatewayId, known[2]!.id, 'FAILED', nowMs - 40 * MINUTE);
  add(known[3]!.gatewayId, known[3]!.id, 'FAILED', nowMs - 5 * 60 * MINUTE);

  // Unknown Attempt Keys, and a Callback that names none.
  add('stripe', random.uuid(), 'PROCESSED', nowMs - 3 * 60 * MINUTE);
  add('fake', random.uuid(), 'FAILED', nowMs - 90 * MINUTE);
  add('stripe', null, 'PROCESSED', nowMs - 7 * 60 * MINUTE, { noEventId: true });
  add('stripe', random.uuid(), 'RECEIVED', nowMs - 45 * SECOND);

  // A body that is not JSON and looks like markup: the Console must show it as text.
  add('fake', known[4]!.id, 'PROCESSED', nowMs - 11 * 60 * MINUTE, { body: '<script>alert("not executed")</script><b>plain text</b>' });
}
