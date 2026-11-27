// @vitest-environment jsdom
import { SDK_MAJOR, SNIPPET_ATTRIBUTES } from '@paybridge/checkout-snippet';
import pkg from '../../package.json' with { type: 'json' };
import { readSnippet } from './snippet.js';

// The snippet contract the Console writes against (`@paybridge/checkout-snippet`).

function script(attributes: Record<string, string>): HTMLScriptElement {
  const element = document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

describe('the snippet contract', () => {
  it('reads every attribute the shared contract names', () => {
    const read = readSnippet(
      script({
        [SNIPPET_ATTRIBUTES.key]: 'pb_pk_test',
        [SNIPPET_ATTRIBUTES.table]: 'table-1',
        [SNIPPET_ATTRIBUTES.customerReference]: 'user-42',
        [SNIPPET_ATTRIBUTES.askEmail]: 'true',
        [SNIPPET_ATTRIBUTES.successUrl]: 'https://shop.example/thanks',
        [SNIPPET_ATTRIBUTES.cancelUrl]: 'https://shop.example/sorry',
        [SNIPPET_ATTRIBUTES.onSuccess]: 'onPaid',
        [SNIPPET_ATTRIBUTES.onCancel]: 'onCancelled',
        [SNIPPET_ATTRIBUTES.onError]: 'onFailed',
      }),
    );

    expect(read).toEqual({
      ok: true,
      snippet: {
        key: 'pb_pk_test',
        tableId: 'table-1',
        customerReference: 'user-42',
        askEmail: true,
        successUrl: 'https://shop.example/thanks',
        cancelUrl: 'https://shop.example/sorry',
        callbacks: { onSuccess: 'onPaid', onCancel: 'onCancelled', onError: 'onFailed' },
      },
    });
  });

  it('names the data-* attributes documented to developers', () => {
    expect(Object.values(SNIPPET_ATTRIBUTES).sort()).toEqual([
      'data-ask-email',
      'data-cancel-url',
      'data-customer-ref',
      'data-key',
      'data-on-cancel',
      'data-on-error',
      'data-on-success',
      'data-success-url',
      'data-table',
    ]);
  });

  it('pins the SDK major version the checkout app serves', () => {
    expect(String(SDK_MAJOR)).toBe(pkg.version.split('.')[0]);
  });
});
