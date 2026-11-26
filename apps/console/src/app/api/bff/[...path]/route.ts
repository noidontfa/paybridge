import { getEnvironment } from '@/lib/environment';
import { forwardToApi } from '@/server/bff-proxy';

// The BFF: the only way the browser reaches the API (ADR 0004).
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  const { apiBaseUrl, mockMode } = getEnvironment();
  // Mock mode has no API to sign in to: it forwards without a token.
  return forwardToApi(request, path, { baseUrl: apiBaseUrl, authenticate: !mockMode });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
