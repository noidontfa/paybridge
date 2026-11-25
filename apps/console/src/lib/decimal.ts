/**
 * Compares two decimal strings (the wire format for money) without turning
 * them into floating-point numbers. Returns a negative number, zero or a
 * positive number, like `Array.prototype.sort` expects.
 */
export function compareDecimal(a: string, b: string): number {
  const [aInt, aFrac] = split(a);
  const [bInt, bFrac] = split(b);
  const width = Math.max(aFrac.length, bFrac.length);
  const left = BigInt(aInt + aFrac.padEnd(width, '0'));
  const right = BigInt(bInt + bFrac.padEnd(width, '0'));
  return left < right ? -1 : left > right ? 1 : 0;
}

function split(value: string): [string, string] {
  const negative = value.startsWith('-');
  const [integer = '0', fraction = ''] = value.replace('-', '').split('.');
  return [negative ? `-${integer}` : integer, fraction];
}
