import { getEnvironment } from '@/lib/environment';
import { handleRefreshRedirect, handleSignIn, handleSignOut } from '@/server/auth-handlers';

// The Console's sign-in endpoints. They call the API from here; the browser
// only ever sees cookies it cannot read (ADR 0004, ADR 0008).
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ action: string }> };

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { action } = await params;
  const options = { baseUrl: getEnvironment().apiBaseUrl };
  if (action === 'sign-in') return handleSignIn(request, options);
  if (action === 'sign-out') return handleSignOut(request, options);
  return new Response(null, { status: 404 });
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { action } = await params;
  if (action === 'refresh') return handleRefreshRedirect(request, { baseUrl: getEnvironment().apiBaseUrl });
  return new Response(null, { status: 404 });
}
