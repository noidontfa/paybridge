/**
 * The path-preserving proxy behind the BFF Route Handler (ADR 0004). A request
 * to the BFF prefix plus an API path goes to the API base URL plus the same
 * path, with method, query and body unchanged. The browser never sees the API
 * base URL and the API needs no CORS.
 *
 * Extension point: ticket 06 adds the operator identity to review-resolution
 * bodies here (from the auth seam); keep that logic in this module.
 */
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

export interface ForwardOptions {
  /** The API base URL (server-side configuration). */
  baseUrl: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
}

export async function forwardToApi(request: Request, path: string[], options: ForwardOptions): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${options.baseUrl.replace(/\/$/, '')}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await (options.fetch ?? fetch)(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        statusCode: 502,
        error: 'Bad Gateway',
        code: 'API_UNREACHABLE',
        message: 'The Console server could not reach the API.',
        path: incoming.pathname,
        method: request.method,
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}
