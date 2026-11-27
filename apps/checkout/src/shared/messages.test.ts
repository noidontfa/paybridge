import {
  fromCheckoutPage,
  fromSdk,
  readCheckoutMessage,
  readSdkMessage,
} from './messages.js';

const CHECKOUT = 'https://checkout.paybridge.example';
const SHOP = 'https://shop.example.com';

function event(data: unknown, origin: string, source: unknown) {
  return { data, origin, source } as MessageEvent;
}

describe('messages from the checkout page, read by the SDK', () => {
  const frame = {};
  const expected = { origin: CHECKOUT, source: frame };

  it('accepts a known message from the checkout iframe', () => {
    const message = fromCheckoutPage({ type: 'success', paymentId: 'p-1' });

    expect(readCheckoutMessage(event(message, CHECKOUT, frame), expected)).toEqual({
      type: 'success',
      paymentId: 'p-1',
    });
  });

  it('ignores the same message from another origin', () => {
    const message = fromCheckoutPage({ type: 'success', paymentId: 'p-1' });

    expect(readCheckoutMessage(event(message, SHOP, frame), expected)).toBeNull();
  });

  it('ignores the same message from another window of the checkout origin', () => {
    const message = fromCheckoutPage({ type: 'success', paymentId: 'p-1' });

    expect(readCheckoutMessage(event(message, CHECKOUT, {}), expected)).toBeNull();
  });

  it.each([
    ['not ours', { type: 'success', paymentId: 'p-1' }],
    ['an unknown type', { source: 'paybridge-checkout', type: 'unlock' }],
    ['a success without a Payment', { source: 'paybridge-checkout', type: 'success' }],
    ['a string', 'success'],
  ])('ignores a message that is %s', (_name, data) => {
    expect(readCheckoutMessage(event(data, CHECKOUT, frame), expected)).toBeNull();
  });
});

describe('messages from the SDK, read by the checkout page', () => {
  const parent = {};
  const expected = { origin: SHOP, source: parent };

  it('accepts the init message from the host page it was opened for', () => {
    const message = fromSdk({
      type: 'init',
      tableId: 't-1',
      planId: 'plan-1',
      language: 'vi',
      customerReference: 'user-42',
    });

    expect(readSdkMessage(event(message, SHOP, parent), expected)).toEqual({
      type: 'init',
      tableId: 't-1',
      planId: 'plan-1',
      language: 'vi',
      customerReference: 'user-42',
    });
  });

  it('carries the return targets: snippet URLs and the host page the Customer is on', () => {
    const message = fromSdk({
      type: 'init',
      tableId: 't-1',
      planId: 'plan-1',
      language: 'en',
      successUrl: `${SHOP}/thanks`,
      cancelUrl: `${SHOP}/pricing`,
      hostPageUrl: `${SHOP}/pricing?plan=pro`,
    });

    expect(readSdkMessage(event(message, SHOP, parent), expected)).toMatchObject({
      successUrl: `${SHOP}/thanks`,
      cancelUrl: `${SHOP}/pricing`,
      hostPageUrl: `${SHOP}/pricing?plan=pro`,
    });
  });

  it('carries the ask for an email, and refuses a non-boolean one', () => {
    const message = fromSdk({ type: 'init', tableId: 't', planId: 'p', language: 'en', askEmail: true });

    expect(readSdkMessage(event(message, SHOP, parent), expected)).toEqual({
      type: 'init',
      tableId: 't',
      planId: 'p',
      language: 'en',
      askEmail: true,
    });
    expect(
      readSdkMessage(event({ ...message, askEmail: 'yes' }, SHOP, parent), expected),
    ).toBeNull();
  });

  it('ignores an init message from any other origin', () => {
    const message = fromSdk({ type: 'init', tableId: 't', planId: 'p', language: 'en' });

    expect(
      readSdkMessage(event(message, 'https://evil.example.com', parent), expected),
    ).toBeNull();
  });

  it('ignores an init message with the wrong field types', () => {
    const data = { source: 'paybridge-sdk', type: 'init', tableId: 1, planId: 'p' };

    expect(readSdkMessage(event(data, SHOP, parent), expected)).toBeNull();
  });
});
