import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCheckoutServer } from './server.js';

// The checkout app's HTTP surface: the versioned SDK and the checkout page
// with its frame-ancestors policy, against a stand-in for the API.

const SHOP = 'https://shop.example.com';
const OTHER_SHOP = 'https://www.example.com';
const KEY = 'pb_pk_test_key';

let api: Server;
let apiUrl: string;
let apiRequests: IncomingMessage[] = [];
/** What the stand-in API answers to `GET /api/checkout/frame`. */
let frameAnswer: { status: number; body: unknown } = {
  status: 200,
  body: { allowedOrigins: [SHOP, OTHER_SHOP] },
};

let checkout: Server;
let base: string;
const PUBLIC_URL = 'https://checkout.paybridge.example';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  api = createServer((req, res) => {
    apiRequests.push(req);
    res.writeHead(frameAnswer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(frameAnswer.body));
  });
  apiUrl = await listen(api);
  checkout = createCheckoutServer({
    publicUrl: PUBLIC_URL,
    apiUrl: 'https://api.paybridge.example',
    internalApiUrl: apiUrl,
    version: '1.2.3',
    assets: { sdk: 'console.log("sdk", __PAYBRIDGE_CONFIG__);', page: 'console.log("page");' },
  });
  base = await listen(checkout);
});
afterAll(() => {
  api.close();
  checkout.close();
});
beforeEach(() => {
  apiRequests = [];
  frameAnswer = { status: 200, body: { allowedOrigins: [SHOP, OTHER_SHOP] } };
});

describe('the SDK script', () => {
  it('is served under its major version, with its configuration, briefly cached', async () => {
    const res = await fetch(`${base}/v1/paybridge.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const body = await res.text();
    expect(body).toContain('"checkoutUrl":"https://checkout.paybridge.example"');
    expect(body).toContain('"apiUrl":"https://api.paybridge.example"');
    expect(body).toContain('"version":"1.2.3"');
  });

  it('is served under its exact version for pinning, cached for good', async () => {
    const res = await fetch(`${base}/v1.2.3/paybridge.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it.each(['/v2/paybridge.js', '/v1.2.4/paybridge.js', '/paybridge.js'])(
    'is not served under %s',
    async (path) => {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    },
  );
});

describe('the checkout page', () => {
  const page = (query: string) => fetch(`${base}/checkout?${query}`);
  const frameAncestors = (res: Response) =>
    /frame-ancestors ([^;]+)/.exec(res.headers.get('content-security-policy') ?? '')?.[1];

  it("may be framed only by the key's allowed origins", async () => {
    const res = await page(`key=${KEY}&hostOrigin=${encodeURIComponent(SHOP)}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(frameAncestors(res)).toBe(`${SHOP} ${OTHER_SHOP}`);
  });

  it('asks the API as the checkout app, for the host page it was opened for', async () => {
    await page(`key=${KEY}&hostOrigin=${encodeURIComponent(SHOP)}`);

    expect(apiRequests).toHaveLength(1);
    const [request] = apiRequests;
    expect(request!.url).toBe('/api/checkout/frame');
    expect(request!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request!.headers.origin).toBe(PUBLIC_URL);
    expect(request!.headers['x-paybridge-host-origin']).toBe(SHOP);
  });

  it('may not be framed at all when the API refuses the key or the host page', async () => {
    frameAnswer = {
      status: 422,
      body: { code: 'CHECKOUT_UNAVAILABLE', details: { reason: 'ORIGIN_NOT_ALLOWED' } },
    };

    const res = await page(`key=${KEY}&hostOrigin=${encodeURIComponent('https://evil.example')}`);

    expect(frameAncestors(res)).toBe("'none'");
  });

  it('may not be framed at all without a key', async () => {
    const res = await page(`hostOrigin=${encodeURIComponent(SHOP)}`);

    expect(frameAncestors(res)).toBe("'none'");
    expect(apiRequests).toHaveLength(0);
  });

  it('gives the page the API it may call', async () => {
    const res = await page(`key=${KEY}&hostOrigin=${encodeURIComponent(SHOP)}`);

    expect(res.headers.get('content-security-policy')).toContain(
      'connect-src https://api.paybridge.example',
    );
    expect(await res.text()).toContain('/assets/checkout.js');
  });

  it("lets Stripe.js load, draw its Payment Element and reach Stripe's API, and nothing else", async () => {
    const res = await page(`key=${KEY}&hostOrigin=${encodeURIComponent(SHOP)}`);
    const policy = res.headers.get('content-security-policy') ?? '';
    const directive = (name: string) =>
      new RegExp(`(?:^|; )${name} ([^;]+)`).exec(policy)?.[1]?.split(' ');

    expect(directive('script-src')).toEqual(["'self'", 'https://js.stripe.com']);
    expect(directive('frame-src')).toEqual(['https://js.stripe.com', 'https://hooks.stripe.com']);
    expect(directive('connect-src')).toEqual(['https://api.paybridge.example', 'https://api.stripe.com']);
  });
});
