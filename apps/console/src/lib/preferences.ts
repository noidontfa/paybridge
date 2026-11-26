export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const DEFAULT_DENSITY: Density = 'comfortable';
export const DENSITY_KEY = 'paybridge.density';

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDensity(value: unknown): value is Density {
  return DENSITIES.some((d) => d === value);
}

/** Reads defensively: storage may be missing, blocked or hold junk. */
export function readDensity(
  storage: Storage | null = browserStorage(),
): Density {
  try {
    const value = storage?.getItem(DENSITY_KEY);
    return isDensity(value) ? value : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

export function writeDensity(
  density: Density,
  storage: Storage | null = browserStorage(),
): void {
  try {
    storage?.setItem(DENSITY_KEY, density);
  } catch {
    // Preference simply is not remembered.
  }
}
