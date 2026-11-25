import { describe, expect, it } from 'vitest';
import { readDensity, writeDensity } from './preferences';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

const brokenStorage: Storage = new Proxy({} as Storage, {
  get() {
    throw new Error('storage unavailable');
  },
});

describe('table density preference', () => {
  it('defaults to comfortable when nothing is stored', () => {
    expect(readDensity(memoryStorage())).toBe('comfortable');
  });

  it('remembers the chosen density', () => {
    const storage = memoryStorage();
    writeDensity('compact', storage);
    expect(readDensity(storage)).toBe('compact');
  });

  it('ignores a stored value it does not recognise', () => {
    const storage = memoryStorage();
    storage.setItem('paybridge.density', 'huge');
    expect(readDensity(storage)).toBe('comfortable');
  });

  it('works when storage is unavailable', () => {
    expect(readDensity(brokenStorage)).toBe('comfortable');
    expect(() => writeDensity('compact', brokenStorage)).not.toThrow();
  });

  it('works when there is no storage at all', () => {
    expect(readDensity(null)).toBe('comfortable');
  });
});
