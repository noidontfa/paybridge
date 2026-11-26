import { BlockList, isIP } from 'node:net';

// What PayBridge's servers may connect to when delivering a Webhook (SSRF
// protection). With protection on (production), a delivery goes over HTTPS
// only, to a host whose every resolved address is public; the connection is
// then made to exactly the address checked here. Development and tests turn
// protection off so a receiver on localhost works.

export interface OutboundPolicy {
  /** On in production: HTTPS only, public addresses only. */
  readonly protection: boolean;
}

type Range = readonly [network: string, prefix: number, kind: string];

const IPV4_RANGES: readonly Range[] = [
  ['0.0.0.0', 8, 'reserved ("this network")'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'private (carrier-grade NAT)'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local (cloud metadata)'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved (IETF protocol assignments)'],
  ['192.0.2.0', 24, 'reserved (documentation)'],
  ['192.88.99.0', 24, 'reserved (6to4 relay)'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'reserved (benchmarking)'],
  ['198.51.100.0', 24, 'reserved (documentation)'],
  ['203.0.113.0', 24, 'reserved (documentation)'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

const IPV6_RANGES: readonly Range[] = [
  ['::', 128, 'reserved (unspecified)'],
  ['::1', 128, 'loopback'],
  ['64:ff9b::', 96, 'reserved (NAT64)'],
  ['64:ff9b:1::', 48, 'reserved (NAT64)'],
  ['100::', 64, 'reserved (discard)'],
  ['2001::', 23, 'reserved (IETF protocol assignments)'],
  ['2001:db8::', 32, 'reserved (documentation)'],
  ['2002::', 16, 'reserved (6to4)'],
  ['fc00::', 7, 'private (unique local)'],
  ['fe80::', 10, 'link-local'],
  ['fec0::', 10, 'reserved (site-local)'],
  ['ff00::', 8, 'multicast'],
];

function rangeLists(): {
  family: 'ipv4' | 'ipv6';
  kind: string;
  list: BlockList;
}[] {
  const make = (family: 'ipv4' | 'ipv6', [network, prefix, kind]: Range) => {
    const list = new BlockList();
    list.addSubnet(network, prefix, family);
    return { family, kind, list };
  };
  return [
    ...IPV4_RANGES.map((r) => make('ipv4', r)),
    ...IPV6_RANGES.map((r) => make('ipv6', r)),
  ];
}

const RANGES = rangeLists();

/** The eight 16-bit groups of an IPv6 address. */
function ipv6Groups(ip: string): number[] {
  let text = ip;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const parse = (part: string | undefined) =>
    part ? part.split(':').map((g) => parseInt(g, 16)) : [];
  const left = parse(head);
  const right = parse(tail);
  const zeros =
    tail === undefined ? [] : Array(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

/** The IPv4 address an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) carries. */
function mappedIpv4(ip: string): string | null {
  const groups = ipv6Groups(ip);
  const mapped =
    groups.length === 8 &&
    groups.slice(0, 5).every((g) => g === 0) &&
    groups[5] === 0xffff;
  if (!mapped) return null;
  const [hi, lo] = [groups[6]!, groups[7]!];
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

/**
 * Why a delivery must not connect to `ip`, or null when it is a public
 * address. Private, loopback, link-local (including the cloud metadata
 * service), multicast and other reserved IPv4 and IPv6 ranges are refused.
 */
export function refusedAddressReason(ip: string): string | null {
  const family = isIP(ip);
  if (family === 0) return `"${ip}" is not an IP address`;
  if (family === 6) {
    const v4 = mappedIpv4(ip);
    if (v4) return refusedAddressReason(v4);
  }
  const type = family === 4 ? 'ipv4' : 'ipv6';
  const hit = RANGES.find((r) => r.family === type && r.list.check(ip, type));
  return hit ? `address ${ip} is ${hit.kind}` : null;
}

/** Host names that only ever mean this machine or its network. */
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|localdomain)$/i;

/**
 * Why `url` cannot be a Webhook Endpoint URL, or null when it can. This is
 * the check without DNS; with protection on, the resolved addresses are
 * checked again when the URL is saved and at every delivery.
 */
export function checkWebhookUrl(
  url: string,
  policy: OutboundPolicy,
): string | null {
  if (!URL.canParse(url)) return 'The URL is not valid';
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'The URL must use HTTPS';
  }
  if (parsed.username || parsed.password) {
    return 'The URL must not contain credentials';
  }
  if (!policy.protection) return null;
  if (parsed.protocol !== 'https:') return 'The URL must use HTTPS';
  const host = hostOf(parsed);
  if (isIP(host)) {
    const reason = refusedAddressReason(host);
    return reason ? `The URL points to a refused ${reason}` : null;
  }
  if (LOCAL_NAMES.test(host)) return `The host ${host} is local`;
  return null;
}

/** The host of a URL, without the brackets of an IPv6 literal. */
export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}
