import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  InvalidCallbackError,
  NORMALIZED_STATUSES,
  type CallbackInput,
  type CallbackResult,
  type CancelInput,
  type CancelResult,
  type GatewayCapabilities,
  type InitiateInput,
  type InitiateResult,
  type NormalizedStatus,
  type PaymentGateway,
  type QueryInput,
  type QueryResult,
} from '../../payment-core/port/index.js';

export const FAKE_GATEWAY_ID = 'fake';

const SIGNATURE_HEADER = 'x-fake-signature';
const SUCCESS_ACK = { httpStatus: 200, body: { ok: true } } as const;
const ERROR_ACK = { httpStatus: 400, body: { ok: false } } as const;

/**
 * One scripted response: a result, an error to throw, or a function of the
 * input (which may await, e.g. to block until a test releases it).
 */
export type FakeStep<I, O> = O | Error | ((input: I) => O | Promise<O>);

/** The JSON body of a fake provider callback. */
export interface FakeCallbackPayload {
  attemptKey: string;
  status: NormalizedStatus;
  amount: string | null;
  providerRef?: string;
  eventId?: string;
}

export interface FakeGatewayOptions {
  gatewayId?: string;
  supportsCancel?: boolean;
  /** HMAC secret used to sign and verify callbacks. */
  secret?: string;
}

interface Calls {
  initiate: InitiateInput[];
  query: QueryInput[];
  cancel: CancelInput[];
  parseCallback: CallbackInput[];
}

/**
 * A Gateway Plugin for tests. Each operation returns the next scripted step,
 * or a sensible default once the script is empty. Every call is recorded.
 */
export class FakeGatewayPlugin implements PaymentGateway {
  readonly gatewayId: string;
  readonly capabilities: GatewayCapabilities;
  readonly callbackHeaders = ['content-type', SIGNATURE_HEADER] as const;
  readonly cancel?: (input: CancelInput) => Promise<CancelResult>;
  readonly calls: Calls = emptyCalls();

  private readonly secret: string;
  private readonly amounts = new Map<string, string>();
  private scripts = emptyScripts();

  constructor(options: FakeGatewayOptions = {}) {
    this.gatewayId = options.gatewayId ?? FAKE_GATEWAY_ID;
    this.capabilities = { supportsCancel: options.supportsCancel ?? true };
    this.secret = options.secret ?? 'fake-secret';
    if (this.capabilities.supportsCancel) {
      this.cancel = (input) => this.doCancel(input);
    }
  }

  scriptInitiate(...steps: FakeStep<InitiateInput, InitiateResult>[]): this {
    this.scripts.initiate.push(...steps);
    return this;
  }

  scriptQuery(...steps: FakeStep<QueryInput, QueryResult>[]): this {
    this.scripts.query.push(...steps);
    return this;
  }

  scriptCancel(...steps: FakeStep<CancelInput, CancelResult>[]): this {
    this.scripts.cancel.push(...steps);
    return this;
  }

  scriptParseCallback(
    ...steps: FakeStep<CallbackInput, CallbackResult>[]
  ): this {
    this.scripts.parseCallback.push(...steps);
    return this;
  }

  /** Clears scripts, recorded calls and remembered amounts. */
  reset(): void {
    this.scripts = emptyScripts();
    this.amounts.clear();
    for (const list of Object.values(this.calls)) list.length = 0;
  }

  /** Builds a callback request this plugin will accept as authentic. */
  signedCallback(payload: FakeCallbackPayload): CallbackInput {
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));
    return {
      rawBody,
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: this.sign(rawBody),
      },
      query: {},
    };
  }

  initiate(input: InitiateInput): Promise<InitiateResult> {
    this.calls.initiate.push(input);
    this.amounts.set(input.attemptKey, input.amount);
    return run(this.scripts.initiate, input, () => ({
      nextAction: {
        type: 'REDIRECT',
        url: `https://fake-gateway.test/pay/${input.attemptKey}`,
      },
      providerMetadata: { attemptKey: input.attemptKey },
      rawPayload: { fake: 'initiate', attemptKey: input.attemptKey },
    }));
  }

  query(input: QueryInput): Promise<QueryResult> {
    this.calls.query.push(input);
    return run(this.scripts.query, input, () => ({
      status: 'PENDING',
      amount: this.amounts.get(input.attemptKey) ?? null,
      rawPayload: { fake: 'query', attemptKey: input.attemptKey },
    }));
  }

  parseCallback(input: CallbackInput): Promise<CallbackResult> {
    this.calls.parseCallback.push(input);
    return run(this.scripts.parseCallback, input, () =>
      this.verifyAndParse(input),
    );
  }

  private doCancel(input: CancelInput): Promise<CancelResult> {
    this.calls.cancel.push(input);
    return run(this.scripts.cancel, input, () => ({
      rawPayload: { fake: 'cancel', attemptKey: input.attemptKey },
    }));
  }

  private verifyAndParse(input: CallbackInput): CallbackResult {
    const signature = input.headers[SIGNATURE_HEADER];
    if (
      typeof signature !== 'string' ||
      !this.verify(input.rawBody, signature)
    ) {
      throw new InvalidCallbackError(
        'Invalid fake callback signature',
        ERROR_ACK,
      );
    }
    let payload: Partial<FakeCallbackPayload>;
    try {
      payload = JSON.parse(new TextDecoder().decode(input.rawBody));
    } catch {
      throw new InvalidCallbackError(
        'Fake callback body is not JSON',
        ERROR_ACK,
      );
    }
    if (
      typeof payload.attemptKey !== 'string' ||
      !NORMALIZED_STATUSES.includes(payload.status as NormalizedStatus)
    ) {
      throw new InvalidCallbackError(
        'Fake callback payload is invalid',
        ERROR_ACK,
      );
    }
    return {
      attemptKey: payload.attemptKey,
      status: payload.status as NormalizedStatus,
      amount: payload.amount ?? null,
      ...(payload.providerRef !== undefined && {
        providerRef: payload.providerRef,
      }),
      ...(payload.eventId !== undefined && {
        providerEventId: payload.eventId,
      }),
      ack: SUCCESS_ACK,
    };
  }

  private sign(rawBody: Uint8Array): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  private verify(rawBody: Uint8Array, signature: string): boolean {
    const expected = Buffer.from(this.sign(rawBody));
    const actual = Buffer.from(signature);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}

function emptyCalls(): Calls {
  return { initiate: [], query: [], cancel: [], parseCallback: [] };
}

function emptyScripts() {
  return {
    initiate: [] as FakeStep<InitiateInput, InitiateResult>[],
    query: [] as FakeStep<QueryInput, QueryResult>[],
    cancel: [] as FakeStep<CancelInput, CancelResult>[],
    parseCallback: [] as FakeStep<CallbackInput, CallbackResult>[],
  };
}

async function run<I, O>(
  script: FakeStep<I, O>[],
  input: I,
  fallback: () => O,
): Promise<O> {
  const step = script.shift();
  if (step === undefined) return fallback();
  if (step instanceof Error) throw step;
  if (typeof step === 'function') {
    return (step as (input: I) => O | Promise<O>)(input);
  }
  return step;
}
