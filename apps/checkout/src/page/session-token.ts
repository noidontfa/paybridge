// The checkout session token: it is how "close and reopen, same Payment"
// works. It lives in the iframe's own storage (the checkout app's origin), so
// the host page cannot read it. Without storage a new token, and so a new
// Payment, is made each time the page opens, which is acceptable.

const STORAGE_KEY = 'paybridge.checkout-session-token';

function newToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
}

export function checkoutSessionToken(storage: () => Storage | null): string {
  let store: Storage | null = null;
  try {
    store = storage();
    const existing = store?.getItem(STORAGE_KEY);
    if (existing && existing.length >= 16) return existing;
  } catch {
    return newToken();
  }
  const token = newToken();
  try {
    store?.setItem(STORAGE_KEY, token);
  } catch {
    // Storage refused (quota, privacy mode): this token lasts one page load.
  }
  return token;
}
