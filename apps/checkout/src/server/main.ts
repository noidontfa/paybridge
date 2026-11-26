import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckoutServer } from './server.js';

// Starts the checkout app from the built bundles next to this file
// (`dist/server.js`, `dist/public/*.js`). Configuration:
//   PORT                       default 3200
//   CHECKOUT_PUBLIC_URL        how browsers reach this app (default http://localhost:PORT)
//   PAYBRIDGE_API_URL          how browsers reach the API (default http://localhost:9999)
//   PAYBRIDGE_INTERNAL_API_URL how this server reaches the API (default PAYBRIDGE_API_URL)
// The API must list CHECKOUT_PUBLIC_URL in its CHECKOUT_APP_ORIGINS.

declare const __PAYBRIDGE_VERSION__: string;

const port = Number(process.env.PORT ?? 3200);
const host = process.env.HOST ?? '0.0.0.0';
const here = dirname(fileURLToPath(import.meta.url));
const asset = (name: string) => readFileSync(join(here, 'public', name), 'utf8');

const server = createCheckoutServer({
  publicUrl: process.env.CHECKOUT_PUBLIC_URL || `http://localhost:${port}`,
  apiUrl: process.env.PAYBRIDGE_API_URL || 'http://localhost:9999',
  internalApiUrl: process.env.PAYBRIDGE_INTERNAL_API_URL || undefined,
  version: __PAYBRIDGE_VERSION__,
  assets: { sdk: asset('paybridge.js'), page: asset('checkout.js') },
});

server.listen(port, host, () => {
  console.log(`PayBridge checkout app listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
