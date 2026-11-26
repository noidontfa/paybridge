/**
 * Whether mock mode is on. Switched on by the server environment flag
 * `CONSOLE_API_MOCKS=true`, off by default, and refused in a production build.
 */
export function isMockModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.CONSOLE_API_MOCKS !== 'true') return false;
  if (env.NODE_ENV === 'production') {
    throw new Error('CONSOLE_API_MOCKS=true is not allowed in a production build: unset it or run in development.');
  }
  return true;
}
