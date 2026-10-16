import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = (process.env.USSC_API_BACKEND_ORIGIN || "http://127.0.0.1:5000").replace(/\/$/, "");

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;

    const backendPath = `/api/${path.join("/")}`;
    const search = request.nextUrl.search;

    const targetUrl = `${BACKEND_URL}${backendPath}${search}`;

    const headers = new Headers();

    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }

    const authorization = request.headers.get("authorization");
    if (authorization) {
      headers.set("authorization", authorization);
    }
    const requestId = request.headers.get("x-request-id");
    if (requestId) headers.set("x-request-id", requestId);

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    const responseBody = await response.arrayBuffer();

    const responseHeaders = new Headers();

    const responseContentType = response.headers.get("content-type");
    if (responseContentType) {
      responseHeaders.set("content-type", responseContentType);
    }
    for (const name of ["content-disposition", "cache-control", "www-authenticate"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[API PROXY ERROR]", error);

    return NextResponse.json(
      {
        status: "error",
        message: "Backend API tidak dapat dihubungi",
      },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, context);
}
