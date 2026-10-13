import { NextRequest, NextResponse } from "next/server";

const MONACOLISA_URL = "https://monacolisa.fulindo.co.id/api/energy";
const MONACOLISA_API_KEY = process.env.MONACOLISA_API_KEY || "";
const DEVICE_IMEI = "860987054243453";
const ALLOWED_LIMITS = new Set(["10", "25", "50", "100"]);

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("tanggal") ?? "";
  const limit = request.nextUrl.searchParams.get("limit") ?? "25";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ALLOWED_LIMITS.has(limit)) {
    return NextResponse.json(
      { status: "error", message: "Tanggal atau batas data tidak valid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const params = new URLSearchParams({
    device_imei: DEVICE_IMEI,
    tanggal: date,
    limit,
    sort: "DESC",
  });

  try {
    const response = await fetch(`${MONACOLISA_URL}?${params}`, {
      headers: {
        "X-API-KEY": MONACOLISA_API_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const body = await response.text();

    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[TPS ENERGY PROXY ERROR]", error);
    return NextResponse.json(
      { status: "error", message: "API Monacolisa tidak dapat dihubungi." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}