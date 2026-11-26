/** Small deterministic helpers for the seed: the same seed always gives the same world. */
export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A v4-shaped UUID. */
  uuid(): string;
  /** Lowercase alphanumerics. */
  token(length: number): string;
}

/** mulberry32: tiny, fast, good enough for fixtures. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const hex = (n: number) => Array.from({ length: n }, () => int(0, 15).toString(16)).join('');
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)]!,
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${int(8, 11).toString(16)}${hex(3)}-${hex(12)}`,
    token: (length) => Array.from({ length }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[int(0, 35)]).join(''),
  };
}
