import { createServer } from 'node:http';
import {
  ALLOWED_HOST_PORT,
  CHECKOUT_URL,
  DISALLOWED_HOST_PORT,
  SEED,
} from './env.js';

// Plain HTML host pages, like an Organization's landing page, served on two
// origins: one the seed's Publishable Key allows and one it does not.
//
//   /             the snippet; ?table=, ?key=, ?customerRef=, ?lang= override it
//   /raw-iframe   frames the checkout page directly, without the SDK

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function snippetPage(params: URLSearchParams): string {
  const attrs: Record<string, string | undefined> = {
    src: `${CHECKOUT_URL}/v1/paybridge.js`,
    'data-key': params.get('key') ?? SEED.publishableKey,
    'data-table': params.get('table') ?? SEED.pricingTableId,
    'data-customer-ref': params.get('customerRef') ?? undefined,
    'data-on-success': 'onPaid',
    'data-on-cancel': 'onCancelled',
    'data-on-error': 'onCheckoutError',
  };
  const tag = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${escape(v!)}"`)
    .join(' ');
  return `<!doctype html>
<html lang="${escape(params.get('lang') ?? 'en')}">
<head>
<meta charset="utf-8">
<title>Shop</title>
<style>
  /* A host page whose styles would wreck anything they reached. */
  * { color: rgb(255, 0, 0) !important; font-family: "Comic Sans MS", cursive !important; }
  h3, p, li, button { font-size: 40px !important; display: inline !important; }
  body { color: rgb(255, 0, 0); font-size: 40px; }
</style>
<script>
  window.__outcomes = [];
  window.onPaid = (d) => window.__outcomes.push({ via: 'callback', outcome: 'success', detail: d });
  window.onCancelled = (d) => window.__outcomes.push({ via: 'callback', outcome: 'cancel', detail: d });
  window.onCheckoutError = (d) => window.__outcomes.push({ via: 'callback', outcome: 'error', detail: d });
  for (const outcome of ['success', 'cancel', 'error']) {
    document.addEventListener('paybridge:' + outcome, (e) =>
      window.__outcomes.push({ via: 'event', outcome, detail: e.detail }));
  }
</script>
</head>
<body>
<h1>Pricing</h1>
<script ${tag}></script>
</body>
</html>`;
}

function rawIframePage(origin: string, params: URLSearchParams): string {
  const src = new URL('/checkout', CHECKOUT_URL);
  src.searchParams.set('key', params.get('key') ?? SEED.publishableKey);
  src.searchParams.set('hostOrigin', params.get('hostOrigin') ?? origin);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Framing</title></head>
<body><iframe id="checkout" title="checkout" src="${escape(src.toString())}" width="480" height="600"></iframe></body>
</html>`;
}

for (const port of [ALLOWED_HOST_PORT, DISALLOWED_HOST_PORT]) {
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const origin = url.origin;
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(snippetPage(url.searchParams));
    } else if (url.pathname === '/raw-iframe') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(rawIframePage(origin, url.searchParams));
    } else {
      res.writeHead(404).end();
    }
  }).listen(port, () => console.log(`host page on port ${port}`));
}
