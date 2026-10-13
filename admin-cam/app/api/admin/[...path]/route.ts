const BACKEND_ORIGIN = (process.env.USSC_BACKEND_ORIGIN || "http://localhost:3001").replace(/\/$/, "");

async function proxyRequest(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const backendPath = path.map(encodeURIComponent).join("/");
  const target = new URL(`${BACKEND_ORIGIN}/${backendPath}${new URL(request.url).search}`);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: "manual",
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

export const GET = proxyRequest;
export const HEAD = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
