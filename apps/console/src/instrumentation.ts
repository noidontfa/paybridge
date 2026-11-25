/** Runs once when the Next.js server starts: switches on the mocked API in mock mode. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startMockApiIfEnabled } = await import('./mocks/server');
  startMockApiIfEnabled();
}
