import { NextRequest, NextResponse } from 'next/server'

const BACKEND_ORIGIN = (process.env.USSC_BACKEND_ORIGIN || 'http://localhost:3001').replace(/\/$/, '')

async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  try {
    const { path = [] } = await params
    const pathname = path.map(encodeURIComponent).join('/')
    const backendPath = `/${pathname}`
    const targetUrl = `${BACKEND_ORIGIN}${backendPath}${request.nextUrl.search}`
    const headers = new Headers()
    for (const name of ['content-type', 'authorization', 'cookie', 'range', 'if-none-match']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
    const response = await fetch(targetUrl, { method: request.method, headers, body, cache: 'no-store', redirect: 'manual' })

    const responseHeaders = new Headers()
    for (const name of ['content-type', 'cache-control', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }

    const isHtml = response.headers.get('content-type')?.includes('text/html')
    if (isHtml && request.method !== 'HEAD') {
      const html = await response.text()
      const proxiedHtml = html.replace(/<head([^>]*)>/i, '<head$1><base href="/admin/">')
      responseHeaders.delete('content-length')
      responseHeaders.delete('content-encoding')
      return new NextResponse(proxiedHtml, { status: response.status, headers: responseHeaders })
    }

    const responseBody = request.method === 'HEAD' || response.status === 204 || response.status === 304
      ? null
      : await response.arrayBuffer()
    return new NextResponse(responseBody, { status: response.status, headers: responseHeaders })
  } catch (error) {
    console.error('[ADMIN API PROXY ERROR]', error)
    return NextResponse.json({ error: 'Admin backend unavailable' }, { status: 502 })
  }
}

export const GET = proxyRequest
export const HEAD = proxyRequest
export const POST = proxyRequest
export const PUT = proxyRequest
export const PATCH = proxyRequest
export const DELETE = proxyRequest
export const OPTIONS = proxyRequest
