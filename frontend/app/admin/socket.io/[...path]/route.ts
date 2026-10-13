const SOCKET_ORIGIN = (process.env.USSC_SOCKET_ORIGIN || process.env.USSC_BACKEND_ORIGIN || 'http://localhost:3001').replace(/\/$/, '')

export const dynamic = 'force-dynamic'

async function proxySocket(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const suffix = path.map(encodeURIComponent).join('/')
  const target = `${SOCKET_ORIGIN}/socket.io/${suffix}${new URL(request.url).search}`
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    cache: 'no-store',
    redirect: 'manual',
  })
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
}

export const GET = proxySocket
export const HEAD = proxySocket
export const POST = proxySocket
