import type { PublicConfig } from './server.js';

const STYLES = `
:root { --pb-main: #4f46e5; --pb-bg: #ffffff; --pb-fg: #111827; --pb-muted: #6b7280; --pb-border: #e5e7eb; }
:root[data-theme="dark"] { --pb-bg: #111827; --pb-fg: #f9fafb; --pb-muted: #9ca3af; --pb-border: #374151; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--pb-bg); color: var(--pb-fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { padding: 24px; max-width: 440px; margin: 0 auto; }
h1 { font-size: 18px; margin: 0 0 4px; }
.amount { font-size: 24px; font-weight: 700; margin: 0 0 20px; }
.muted { color: var(--pb-muted); }
.methods { display: grid; gap: 8px; margin: 12px 0; }
button, .button { display: block; width: 100%; padding: 12px 16px; border-radius: 8px; font: inherit;
  border: 1px solid var(--pb-border); background: transparent; color: inherit; cursor: pointer; text-align: center;
  text-decoration: none; }
button.primary, .button.primary { background: var(--pb-main); border-color: var(--pb-main); color: #fff; font-weight: 600; }
button:disabled { opacity: .6; cursor: progress; }
.qr { display: flex; justify-content: center; margin: 16px 0; }
.qr svg { width: 220px; height: 220px; background: #fff; padding: 8px; border-radius: 8px; }
.result { text-align: center; padding: 24px 0; }
.notice { padding: 12px; border-radius: 8px; border: 1px solid var(--pb-border); margin: 12px 0; }
`;

/** The checkout page's shell; `/assets/checkout.js` renders everything in it. */
export function checkoutPageHtml(config: PublicConfig): string {
  return pageShell(config, 'checkout.js');
}

/** The return page's shell; `/assets/return.js` renders everything in it. */
export function returnPageHtml(config: PublicConfig): string {
  return pageShell(config, 'return.js');
}

function pageShell(config: PublicConfig, script: string): string {
  const json = JSON.stringify(config).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>PayBridge Checkout</title>
<style>${STYLES}</style>
<script id="paybridge-config" type="application/json">${json}</script>
<script src="/assets/${script}?v=${encodeURIComponent(config.version)}" defer></script>
</head>
<body><main id="app" aria-live="polite"></main></body>
</html>`;
}
