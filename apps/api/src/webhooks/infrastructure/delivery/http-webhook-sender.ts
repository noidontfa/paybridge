import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import {
  checkWebhookUrl,
  hostOf,
  refusedAddressReason,
} from '../../domain/services/outbound-policy.js';
import {
  WebhookSender,
  WebhookUrlGuard,
  type OutboundRequest,
  type OutboundResult,
} from '../../domain/services/ports.js';
import {
  WEBHOOK_DELIVERY_OPTIONS,
  type WebhookDeliveryOptions,
} from '../config/delivery-options.js';

interface CheckedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

class RefusedDestinationError extends Error {
  override readonly name = 'RefusedDestinationError';
}

/**
 * Resolves a URL's host and applies the outbound policy. With protection on,
 * every resolved address must be public; the one returned is the address a
 * delivery then connects to, so a second DNS answer cannot swap it
 * (DNS rebinding).
 */
async function checkedAddress(
  url: string,
  options: WebhookDeliveryOptions,
): Promise<CheckedAddress | null> {
  const reason = checkWebhookUrl(url, options);
  if (reason) throw new RefusedDestinationError(reason);
  if (!options.protection) return null;
  const host = hostOf(new URL(url));
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) as 4 | 6 }]
    : await dnsLookup(host, { all: true, verbatim: true }).catch(
        (error: unknown) => {
          throw new RefusedDestinationError(
            `The host ${host} could not be resolved: ${String(error)}`,
          );
        },
      );
  if (addresses.length === 0) {
    throw new RefusedDestinationError(`The host ${host} has no address`);
  }
  for (const { address } of addresses) {
    const refused = refusedAddressReason(address);
    if (refused) {
      throw new RefusedDestinationError(`Refused ${host}: ${refused}`);
    }
  }
  const [first] = addresses;
  return { address: first!.address, family: first!.family as 4 | 6 };
}

/** Connects to exactly the checked address, whatever DNS says now. */
function pinnedLookup(checked: CheckedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: CheckedAddress[]) => void)(null, [
        checked,
      ]);
    } else {
      callback(null, checked.address, checked.family);
    }
  };
}

/** The save-time check of a Webhook Endpoint URL, DNS included. */
@Injectable()
export class PolicyWebhookUrlGuard extends WebhookUrlGuard {
  constructor(
    @Inject(WEBHOOK_DELIVERY_OPTIONS)
    private readonly options: WebhookDeliveryOptions,
  ) {
    super();
  }

  async check(url: string): Promise<string | null> {
    try {
      await checkedAddress(url, this.options);
      return null;
    } catch (error) {
      if (error instanceof RefusedDestinationError) return error.message;
      throw error;
    }
  }
}

/**
 * POSTs a Webhook with `node:http(s)`: no redirects, no connection reuse, a
 * timeout over the whole exchange, and only the start of the response body
 * kept.
 */
@Injectable()
export class HttpWebhookSender extends WebhookSender {
  constructor(
    @Inject(WEBHOOK_DELIVERY_OPTIONS)
    private readonly options: WebhookDeliveryOptions,
  ) {
    super();
  }

  async post(request: OutboundRequest): Promise<OutboundResult> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let checked: CheckedAddress | null;
    try {
      checked = await checkedAddress(request.url, this.options);
    } catch (error) {
      return {
        httpStatus: null,
        durationMs: elapsed(),
        responseBody: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      const { status, body } = await this.exchange(request, checked);
      const ok = status >= 200 && status < 300;
      return {
        httpStatus: status,
        durationMs: elapsed(),
        responseBody: body,
        error: ok
          ? null
          : status >= 300 && status < 400
            ? `HTTP ${status}: redirects are not followed`
            : `HTTP ${status}`,
      };
    } catch (error) {
      return {
        httpStatus: null,
        durationMs: elapsed(),
        responseBody: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private exchange(
    request: OutboundRequest,
    checked: CheckedAddress | null,
  ): Promise<{ status: number; body: string }> {
    const url = new URL(request.url);
    const client = url.protocol === 'https:' ? https : http;
    const limit = this.options.responseBodyLimit;
    const timeoutMs = this.options.timeoutMs;
    return new Promise((resolve, reject) => {
      const req = client.request(
        url,
        {
          method: 'POST',
          agent: false,
          headers: {
            ...request.headers,
            'content-length': Buffer.byteLength(request.body).toString(),
          },
          ...(checked ? { lookup: pinnedLookup(checked) } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let kept = 0;
          const finish = () => {
            clearTimeout(timer);
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8').slice(0, limit),
            });
          };
          res.on('data', (chunk: Buffer) => {
            if (kept >= limit) return;
            chunks.push(chunk);
            kept += chunk.length;
            // Enough kept: stop reading a large or endless body.
            if (kept >= limit) {
              res.destroy();
              finish();
            }
          });
          res.on('end', finish);
          res.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        },
      );
      const timer = setTimeout(() => {
        req.destroy(new Error(`Timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      req.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.end(request.body);
    });
  }
}
