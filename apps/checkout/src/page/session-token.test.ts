import { checkoutSessionToken } from './session-token.js';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe('the checkout session token', () => {
  it('is the same every time the page opens with the same storage', () => {
    const storage = new MemoryStorage() as unknown as Storage;

    const first = checkoutSessionToken(() => storage);
    const second = checkoutSessionToken(() => storage);

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(16);
  });

  it('is new every time when storage is unavailable', () => {
    const blocked = () => {
      throw new DOMException('denied', 'SecurityError');
    };

    expect(checkoutSessionToken(blocked)).not.toBe(checkoutSessionToken(blocked));
  });
});
