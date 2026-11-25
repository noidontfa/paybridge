import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

/** One request the Stripe SDK sent through the fixture HTTP client. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, unknown>>;
  /** The form-encoded request body, decoded into key/value pairs. */
  readonly body: Readonly<Record<string, string>>;
}

type Reply =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'failure'; error: Error };

export function loadFixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

class FixtureResponse extends Stripe.HttpClientResponse {
  constructor(
    status: number,
    private readonly body: unknown,
  ) {
    super(status, { 'request-id': 'req_fixture' });
  }

  override getRawResponse(): unknown {
    return { statusCode: this._statusCode };
  }

  override toJSON(): any {
    return Promise.resolve(this.body);
  }
}

/**
 * A Stripe SDK HTTP layer that replays recorded responses in order instead of
 * calling Stripe. Each request consumes the next queued reply and is recorded.
 */
export class FixtureHttpClient extends Stripe.HttpClient {
  readonly requests: RecordedRequest[] = [];
  private readonly replies: Reply[] = [];

  /** Queues a response whose JSON body is the named fixture. */
  respond(status: number, fixture: string): this {
    this.replies.push({ kind: 'response', status, body: loadFixture(fixture) });
    return this;
  }

  /** Queues a transport failure (the request never got an answer). */
  failWith(error: Error): this {
    this.replies.push({ kind: 'failure', error });
    return this;
  }

  override getClientName(): string {
    return 'fixture';
  }

  override makeRequest(
    _host: string,
    _port: string,
    path: string,
    method: string,
    headers: Record<string, unknown>,
    requestData: string,
  ): Promise<Stripe.HttpClientResponse> {
    this.requests.push({
      method,
      path,
      headers,
      body: Object.fromEntries(new URLSearchParams(requestData)),
    });
    const reply = this.replies.shift();
    if (!reply) {
      return Promise.reject(
        new Error(`No fixture queued for ${method} ${path}`),
      );
    }
    if (reply.kind === 'failure') return Promise.reject(reply.error);
    return Promise.resolve(new FixtureResponse(reply.status, reply.body));
  }
}
