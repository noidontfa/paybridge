import { describe, expect, it } from 'vitest';
import { buildSnippet, SNIPPET_OPTIONAL_ATTRIBUTES } from './checkout-snippet';

describe('buildSnippet', () => {
  it('is one script tag loading the v1 SDK with the key and the table', () => {
    expect(
      buildSnippet({
        checkoutUrl: 'https://checkout.example/',
        publishableKey: 'pb_pk_abc',
        pricingTableId: '0190a000-0000-7000-8000-000000000001',
      }),
    ).toBe(
      '<script src="https://checkout.example/v1/paybridge.js"\n' +
        '  data-key="pb_pk_abc"\n' +
        '  data-table="0190a000-0000-7000-8000-000000000001"></script>',
    );
  });

  it('escapes attribute values', () => {
    expect(
      buildSnippet({ checkoutUrl: 'https://c.example', publishableKey: 'a"b<c>&', pricingTableId: 't' }),
    ).toContain('data-key="a&quot;b&lt;c&gt;&amp;"');
  });

  it('documents the optional attributes the SDK reads', () => {
    expect(SNIPPET_OPTIONAL_ATTRIBUTES.map((a) => a.name)).toEqual([
      'data-customer-ref',
      'data-ask-email',
      'data-success-url',
      'data-cancel-url',
    ]);
  });
});
