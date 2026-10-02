import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = new URL(
    '/api/' + path.map(encodeURIComponent).join('/') + req.nextUrl.search,
    process.env.API_URL || 'http://127.0.0.1:3001',
  );
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('connection');
  // The browser's address reaches the API only behind the trusted HTTPS proxy (Caddy sets X-Forwarded-For itself and
  // discards the client's); on a local installation the header is dropped so nobody can forge an address.
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');
  if (process.env.TRUST_PROXY) {
    const client = req.headers.get('x-forwarded-for')?.split(',')[0].trim();
    if (client) headers.set('x-forwarded-for', client);
  }
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
    cache: 'no-store',
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
