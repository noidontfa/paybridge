import { SIGNATURE_HEADER, signatureHeader } from './signature.js';

// Expected values computed independently:
//   printf '%s' '1767225600.{"id":"evt"}' | openssl dgst -sha256 -hmac whsec_pb_test
const BODY = '{"id":"evt"}';
const AT = new Date('2026-01-01T00:00:00.000Z'); // 1767225600

describe('webhook signature header', () => {
  it('carries the timestamp in seconds and an HMAC-SHA256 of "timestamp.body"', () => {
    expect(signatureHeader(['whsec_pb_test'], AT, BODY)).toBe(
      't=1767225600,v1=48bf8a61702363e5ff62f46444ea8d0976d28f516fe6e9aaf2418db03e01b599',
    );
  });

  it('carries one signature per valid secret', () => {
    const header = signatureHeader(
      ['whsec_pb_test', 'whsec_pb_other'],
      AT,
      BODY,
    );
    expect(header).toMatch(
      /^t=1767225600,v1=48bf8a61[0-9a-f]{56},v1=[0-9a-f]{64}$/,
    );
  });

  it('changes when a single byte of the body changes', () => {
    expect(signatureHeader(['whsec_pb_test'], AT, '{"id":"evu"}')).not.toBe(
      signatureHeader(['whsec_pb_test'], AT, BODY),
    );
  });

  it('is sent as the PayBridge-Signature header', () => {
    expect(SIGNATURE_HEADER).toBe('paybridge-signature');
  });
});
