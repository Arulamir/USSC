const BACKEND_URL = "http://localhost:5003";

async function proxyHls(
  request: Request,
  path: string[]
) {
  const incomingUrl = new URL(request.url);

  const backendUrl =
    `${BACKEND_URL}/hls/` +
    path.map(encodeURIComponent).join("/") +
    incomingUrl.search;

  console.log("[HLS PROXY]", request.method, backendUrl);

  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("content-length");

  const response = await fetch(backendUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" ||
      request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
  });

  const responseHeaders = new Headers(response.headers);

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ path: string[] }>;
  }
) {
  const { path } = await context.params;

  return proxyHls(request, path);
}

export async function HEAD(
  request: Request,
  context: {
    params: Promise<{ path: string[] }>;
  }
) {
  const { path } = await context.params;

  return proxyHls(request, path);
}
