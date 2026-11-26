import { createServer, type Server, type ServerResponse } from 'node:http';
import { checkoutApi } from '../shared/api.js';
import { checkoutPageHtml } from './html.js';

export interface CheckoutServerConfig {
  /** Where this app is reached by browsers, e.g. `https://checkout.paybridge.vn`. */
  readonly publicUrl: string;
  /** The API's base URL as browsers reach it. */
  readonly apiUrl: string;
  /** The API's base URL as this server reaches it (defaults to `apiUrl`). */
  readonly internalApiUrl?: string;
  /** The SDK's exact version, served at `/v<version>/paybridge.js`. */
  readonly version: string;
  /** The built browser bundles. */
  readonly assets: { readonly sdk: string; readonly page: string };
}

/** The free identifier the SDK bundle reads its configuration from. */
export const SDK_CONFIG_PLACEHOLDER = '__PAYBRIDGE_CONFIG__';

/** What the SDK and the checkout page are told about their deployment. */
export interface PublicConfig {
  readonly checkoutUrl: string;
  readonly apiUrl: string;
  readonly version: string;
}

const SHORT_CACHE = 'public, max-age=300';
const LONG_CACHE = 'public, max-age=31536000, immutable';

/**
 * The checkout app: the SDK script under `/v<major>/` (and the exact version
 * for pinning) and the checkout page that the SDK opens in an iframe. It
 * holds no state; it reads the API's public checkout endpoints only.
 */
export function createCheckoutServer(config: CheckoutServerConfig): Server {
  const publicUrl = new URL(config.publicUrl).origin;
  const apiUrl = new URL(config.apiUrl).origin;
  const publicConfig: PublicConfig = {
    checkoutUrl: publicUrl,
    apiUrl,
    version: config.version,
  };
  // The bundle reads its deployment from a free `__PAYBRIDGE_CONFIG__`.
  const sdk = `(function (${SDK_CONFIG_PLACEHOLDER}) {\n${config.assets.sdk}\n})(${JSON.stringify(publicConfig)});\n`;
  const major = config.version.split('.')[0];
  const sdkPaths = new Map([
    [`/v${major}/paybridge.js`, SHORT_CACHE],
    [`/v${config.version}/paybridge.js`, LONG_CACHE],
  ]);

  // Asks the API, as the checkout app, which websites may frame the page.
  async function frameAncestors(key: string, hostOrigin: string): Promise<string[]> {
    const api = checkoutApi({
      apiUrl: config.internalApiUrl ?? config.apiUrl,
      publishableKey: key,
      hostOrigin,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), Origin: publicUrl },
        }),
    });
    try {
      return [...(await api.frameAncestors())].filter(isOrigin);
    } catch {
      return [];
    }
  }

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', publicUrl);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain', 'Method not allowed');
    }
    const sdkCache = sdkPaths.get(url.pathname);
    if (sdkCache) {
      return send(res, 200, 'text/javascript; charset=utf-8', sdk, {
        'Cache-Control': sdkCache,
        'Access-Control-Allow-Origin': '*',
      });
    }
    if (url.pathname === '/assets/checkout.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', config.assets.page, {
        'Cache-Control': SHORT_CACHE,
      });
    }
    if (url.pathname === '/checkout') {
      const key = url.searchParams.get('key');
      const hostOrigin = url.searchParams.get('hostOrigin');
      const allowed =
        key && hostOrigin && isOrigin(hostOrigin)
          ? frameAncestors(key, hostOrigin)
          : Promise.resolve([]);
      void allowed.then((origins) =>
        send(res, 200, 'text/html; charset=utf-8', checkoutPageHtml(publicConfig), {
          'Content-Security-Policy': checkoutPagePolicy(origins, apiUrl),
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        }),
      );
      return;
    }
    if (url.pathname === '/healthz') {
      return send(res, 200, 'application/json', '{"status":"ok"}');
    }
    send(res, 404, 'text/plain', 'Not found');
  });
}

/**
 * The checkout page's Content-Security-Policy: framed only by the key's
 * allowed origins (none when the key or host page is refused), scripts only
 * from this app, and requests only to the API.
 */
export function checkoutPagePolicy(frameAncestors: readonly string[], apiUrl: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `connect-src ${apiUrl}`,
    `frame-ancestors ${frameAncestors.length > 0 ? frameAncestors.join(' ') : "'none'"}`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
}

function isOrigin(value: string): boolean {
  return URL.canParse(value) && new URL(value).origin === value;
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'Content-Type': contentType, ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
