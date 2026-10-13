
const BACKEND_URL = "http://localhost:5003";

async function proxyRequest(
  request: Request,
  path: string[]
) {
  const backendPath =
    path[0] === "hls"
      ? `/${path.map(encodeURIComponent).join("/")}`
      : `/api/${path.map(encodeURIComponent).join("/")}`;

  const backendUrl = `${BACKEND_URL}${backendPath}`;

  console.log(
    "[CCTV PROXY]",
    request.method,
    backendUrl
  );

  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("content-length");

  // Pastikan cookie sesi browser diteruskan ke Flask.
  const sessionCookie = request.headers.get("cookie");
  if (sessionCookie) {
    headers.set("cookie", sessionCookie);
  }

  const response = await fetch(backendUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" ||
      request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
  });

  const responseHeaders = new Headers(
    response.headers
  );

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  // Pertahankan Set-Cookie dari backend agar browser
  // dapat menyimpan cookie sesi HttpOnly.
  if (typeof response.headers.getSetCookie === "function") {
    const setCookies = response.headers.getSetCookie();
    responseHeaders.delete("set-cookie");

    for (const cookie of setCookies) {
      responseHeaders.append("set-cookie", cookie);
    }
  }

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

  return proxyRequest(request, path);
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ path: string[] }>;
  }
) {
  const { path } = await context.params;

  return proxyRequest(request, path);
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ path: string[] }>;
  }
) {
  const { path } = await context.params;

  return proxyRequest(request, path);
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ path: string[] }>;
  }
) {
  const { path } = await context.params;

  return proxyRequest(request, path);
}

