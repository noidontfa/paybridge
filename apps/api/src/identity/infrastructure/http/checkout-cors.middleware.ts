import { Injectable, type NestMiddleware } from '@nestjs/common';
import { isCheckoutPath } from './checkout-endpoint.js';

interface CorsRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

interface CorsResponse {
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | number | string[] | undefined;
  status(code: number): CorsResponse;
  end(): void;
}

const ALLOWED_METHODS = 'GET, POST';
const ALLOWED_HEADERS =
  'Authorization, Content-Type, Idempotency-Key, X-PayBridge-Host-Origin';

function pathOf(request: CorsRequest): string {
  const url = request.originalUrl ?? request.url ?? '';
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/**
 * CORS for the checkout endpoints only, which Customers' browsers call from
 * the Organization's pages. Any origin is reflected and no cookies are
 * allowed: the browser cannot tell the key's allowed origins before it sends
 * the key, so the origin check is done by identity on the real request (and
 * its refusal stays readable, so a developer sees the reason). Every other
 * route gets no CORS headers.
 */
@Injectable()
export class CheckoutCorsMiddleware implements NestMiddleware {
  use(request: CorsRequest, response: CorsResponse, next: () => void): void {
    const origin = request.headers.origin;
    if (!isCheckoutPath(pathOf(request)) || typeof origin !== 'string') {
      next();
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    const vary = response.getHeader('Vary');
    const varied = Array.isArray(vary) ? vary.join(', ') : vary?.toString();
    response.setHeader('Vary', varied ? `${varied}, Origin` : 'Origin');
    if (
      request.method === 'OPTIONS' &&
      request.headers['access-control-request-method']
    ) {
      response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      response.setHeader('Access-Control-Max-Age', '600');
      response.status(204).end();
      return;
    }
    next();
  }
}
