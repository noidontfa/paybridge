import { checkWebhookUrl, refusedAddressReason } from './outbound-policy.js';

describe('addresses a Webhook may reach (SSRF protection)', () => {
  it.each([
    ['93.184.216.34'],
    ['8.8.8.8'],
    ['2606:4700:4700::1111'],
    ['2a00:1450:4001:82f::200e'],
  ])('allows the public address %s', (ip) => {
    expect(refusedAddressReason(ip)).toBeNull();
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['169.254.169.254', 'link-local'],
    ['0.0.0.0', 'reserved'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['192.0.2.10', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['::1', 'loopback'],
    ['::', 'reserved'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'reserved'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'link-local'],
    ['::ffff:a9fe:a9fe', 'link-local'],
  ])('refuses %s as %s', (ip, kind) => {
    expect(refusedAddressReason(ip)).toContain(kind);
  });

  it('does not treat a public address next to a private range as private', () => {
    expect(refusedAddressReason('172.32.0.1')).toBeNull();
    expect(refusedAddressReason('11.0.0.1')).toBeNull();
  });

  it('refuses something that is not an IP address', () => {
    expect(refusedAddressReason('example.com')).not.toBeNull();
  });
});

describe('a Webhook Endpoint URL', () => {
  const strict = { protection: true };
  const relaxed = { protection: false };

  it('must be HTTPS when protection is on', () => {
    expect(checkWebhookUrl('http://example.com/hook', strict)).toMatch(/HTTPS/);
    expect(checkWebhookUrl('https://example.com/hook', strict)).toBeNull();
  });

  it('may be plain HTTP to localhost in development and tests', () => {
    expect(checkWebhookUrl('http://localhost:9998/hook', relaxed)).toBeNull();
    expect(checkWebhookUrl('http://127.0.0.1:9998/hook', relaxed)).toBeNull();
  });

  it('refuses an address literal outside the allowed ranges when protection is on', () => {
    expect(checkWebhookUrl('https://127.0.0.1/hook', strict)).toMatch(
      /loopback/,
    );
    expect(checkWebhookUrl('https://[::1]/hook', strict)).toMatch(/loopback/);
    expect(checkWebhookUrl('https://169.254.169.254/latest', strict)).toMatch(
      /link-local/,
    );
  });

  it('refuses a name that can only be local when protection is on', () => {
    expect(checkWebhookUrl('https://localhost/hook', strict)).toMatch(/local/);
  });

  it('refuses something that is not an http(s) URL, or carries credentials', () => {
    expect(checkWebhookUrl('not a url', relaxed)).not.toBeNull();
    expect(checkWebhookUrl('ftp://example.com/x', relaxed)).not.toBeNull();
    expect(
      checkWebhookUrl('https://user:pass@example.com/x', relaxed),
    ).not.toBeNull();
  });
});
