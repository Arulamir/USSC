import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const NINE_ROUTER_URL = process.env.NINE_ROUTER_URL || "http://127.0.0.1:20128/v1/chat/completions";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CACHE_FILE = path.join(process.cwd(), "data", "tps-ai-summary-cache.json");

type WasteRecord = {
  tanggal: string;
  jamMasuk: string;
  sumberSampah: string;
  berat: string;
};

type EnergyRecord = {
  timestamp: string;
  measurement?: {
    voltage_v?: Record<string, number>;
    current_a?: Record<string, number>;
    active_power_w?: Record<string, number>;
    power_factor?: { total?: number };
    frequency_hz?: number;
    thd_voltage_pct?: Record<string, number>;
    thd_current_pct?: Record<string, number>;
  };
};

type HourlyStat = {
  hour: string;
  count: number;
  avgActivePowerW: number;
  maxActivePowerW: number;
  avgVoltageV: number;
  avgCurrentA: number;
  avgPowerFactor: number;
  avgFrequencyHz: number;
};

type SummaryCache = {
  inputHash: string;
  summary: string;
  generatedAt: string;
};

function formatIsoHour(ts: string): string {
  if (/^\d{14}$/.test(ts)) {
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:00`;
  }
  const date = new Date(ts);
  if (!Number.isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:00`;
  }
  return ts.slice(0, 13);
}

function aggregateHourly(energyRows: EnergyRecord[]): HourlyStat[] {
  const groups = new Map<string, {
    count: number;
    powerSum: number;
    powerMax: number;
    voltageSum: number;
    currentSum: number;
    pfSum: number;
    freqSum: number;
  }>();

  for (const row of energyRows) {
    if (!row.timestamp) continue;
    const hourKey = formatIsoHour(row.timestamp);
    const m = row.measurement ?? {};
    const pTotal = Number(m.active_power_w?.total ?? 0);
    const vAvg = (Number(m.voltage_v?.a ?? 0) + Number(m.voltage_v?.b ?? 0) + Number(m.voltage_v?.c ?? 0)) / 3;
    const cAvg = (Number(m.current_a?.a ?? 0) + Number(m.current_a?.b ?? 0) + Number(m.current_a?.c ?? 0)) / 3;
    const pf = Number(m.power_factor?.total ?? 0);
    const freq = Number(m.frequency_hz ?? 0);

    const existing = groups.get(hourKey);
    if (!existing) {
      groups.set(hourKey, {
        count: 1,
        powerSum: pTotal,
        powerMax: pTotal,
        voltageSum: vAvg,
        currentSum: cAvg,
        pfSum: pf,
        freqSum: freq,
      });
    } else {
      existing.count += 1;
      existing.powerSum += pTotal;
      if (pTotal > existing.powerMax) existing.powerMax = pTotal;
      existing.voltageSum += vAvg;
      existing.currentSum += cAvg;
      existing.pfSum += pf;
      existing.freqSum += freq;
    }
  }

  const result: HourlyStat[] = [];
  const sortedKeys = Array.from(groups.keys()).sort();
  for (const hour of sortedKeys) {
    const g = groups.get(hour)!;
    result.push({
      hour,
      count: g.count,
      avgActivePowerW: Math.round((g.powerSum / g.count) * 10) / 10,
      maxActivePowerW: Math.round(g.powerMax * 10) / 10,
      avgVoltageV: Math.round((g.voltageSum / g.count) * 10) / 10,
      avgCurrentA: Math.round((g.currentSum / g.count) * 100) / 100,
      avgPowerFactor: Math.round((g.pfSum / g.count) * 1000) / 1000,
      avgFrequencyHz: Math.round((g.freqSum / g.count) * 100) / 100,
    });
  }
  return result;
}

async function readCache(): Promise<SummaryCache | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as SummaryCache;
  } catch {
    return null;
  }
}

// Single-flight global: jika ada 2 proses mengakses API bersamaan,
// proses kedua menunggu dan memakai hasil proses pertama.
let inFlight: Promise<SummaryCache> | null = null;

async function generateSummary(
  inputHash: string,
  wasteRows: WasteRecord[],
  hourlyStats: HourlyStat[],
  apiKey: string,
): Promise<SummaryCache> {
  if (inFlight) return inFlight;

  const task = (async (): Promise<SummaryCache> => {
    const response = await fetch(NINE_ROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "ringkasan",
        stream: false,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: "Anda adalah analis smart campus untuk Depo Sampah/TPS Unesa Lidah Wetan. Analisis data sampah (masuk/keluar) DAN data telemetri energi listrik per jam selama 7 hari terakhir (daya aktif W/kW, tegangan, arus, power factor, frekuensi). Buat kesimpulan dan insight operasional terstruktur menggunakan Markdown (gunakan heading ##, paragraf, dan bold untuk angka penting). Bahas korelasi beban daya dengan aktivitas pemilahan/pengolahan sampah jika terlihat.",
          },
          {
            role: "user",
            content: `Berikut data operasional TPS:\n\n### DATA SAMPAH MASUK & KELUAR (${wasteRows.length} baris):\n${JSON.stringify(wasteRows, null, 2)}\n\n### DATA DAYA & ENERGI LISTRIK PER JAM (7 hari terakhir, ${hourlyStats.length} slot jam):\n${JSON.stringify(hourlyStats, null, 2)}\n\nBuat ringkasan dan analisis komprehensif dalam Bahasa Indonesia.`,
          },
        ],
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[TPS AI SUMMARY] 9router returned", response.status, await response.text());
      throw new Error("9router gagal membuat kesimpulan.");
    }

    const result = await response.json() as { choices?: { message?: { content?: string } }[] };
    const summary = result.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error("Respons 9router kosong.");

    const generatedAt = new Date().toISOString();
    const nextCache: SummaryCache = { inputHash, summary, generatedAt };
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(nextCache, null, 2), "utf8");
    return nextCache;
  })();

  inFlight = task;
  try {
    return await task;
  } finally {
    if (inFlight === task) inFlight = null;
  }
}

export async function POST(request: NextRequest) {
  let wasteRows: WasteRecord[] = [];
  let energyRows: EnergyRecord[] = [];
  try {
    const body = await request.json() as { wasteData?: unknown; energyData?: unknown; data?: unknown };
    const rawWaste = Array.isArray(body.wasteData) ? body.wasteData : Array.isArray(body.data) ? body.data : [];
    const rawEnergy = Array.isArray(body.energyData) ? body.energyData : [];

    if (rawWaste.length > 5000 || rawEnergy.length > 5000) {
      return NextResponse.json({ error: "Ukuran data TPS melebihi batas." }, { status: 400 });
    }

    wasteRows = rawWaste.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error("Invalid waste row");
      const record = row as Record<string, unknown>;
      return {
        tanggal: String(record.tanggal ?? ""),
        jamMasuk: String(record.jamMasuk ?? ""),
        sumberSampah: String(record.sumberSampah ?? ""),
        berat: String(record.berat ?? ""),
      };
    });

    energyRows = rawEnergy.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error("Invalid energy row");
      const record = row as Record<string, unknown>;
      return {
        timestamp: String(record.timestamp ?? ""),
        measurement: record.measurement as EnergyRecord["measurement"],
      };
    });
  } catch {
    return NextResponse.json({ error: "Format data TPS tidak valid." }, { status: 400 });
  }

  const hourlyStats = aggregateHourly(energyRows);
  const combinedPayload = { wasteRows, hourlyStats };
  const inputHash = createHash("sha256").update(JSON.stringify(combinedPayload)).digest("hex");
  const cache = await readCache();
  if (cache && Date.now() - Date.parse(cache.generatedAt) < CACHE_TTL_MS) {
    return NextResponse.json({ summary: cache.summary, generatedAt: cache.generatedAt, cached: true });
  }

  const apiKey = process.env.NINE_ROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "NINE_ROUTER_API_KEY belum dikonfigurasi di server." }, { status: 503 });
  }

  try {
    const result = await generateSummary(inputHash, wasteRows, hourlyStats, apiKey);
    return NextResponse.json({ summary: result.summary, generatedAt: result.generatedAt, cached: false });
  } catch (error) {
    console.error("[TPS AI SUMMARY ERROR]", error);
    const message = error instanceof Error ? error.message : "Tidak dapat menghubungi 9router lokal.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
