import { APP_CONFIG } from "./config";

async function request<T = any>(
  endpoint: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const {
    timeout = 8000,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${APP_CONFIG.API_BASE_URL}${endpoint}`;

  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  if (externalSignal) {
    externalSignal.addEventListener("abort", () => {
      controller.abort();
    });
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(fetchOptions.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `HTTP Error: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.warn(
      `[ApiService] Request gagal ke ${endpoint}:`,
      error instanceof Error ? error.message : error
    );

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const ApiService = {
  request,

  async getSurabayaWeather() {
    return request(APP_CONFIG.WEATHER_SURABAYA_URL);
  },

  async getAirQuality(
    date = "",
    startTime = "",
    endTime = ""
  ) {
    const params = new URLSearchParams();

    if (date) params.append("date", date);
    if (startTime) params.append("start", startTime);
    if (endTime) params.append("end", endTime);

    const queryString = params.toString();

    const endpoint = queryString
      ? `${APP_CONFIG.ENDPOINTS.AIR_QUALITY}?${queryString}`
      : APP_CONFIG.ENDPOINTS.AIR_QUALITY;

    return request(endpoint);
  },

  async getTrafficData(
    date = "",
    startTime = "",
    endTime = ""
  ) {
    const params = new URLSearchParams();

    if (date) params.append("tanggal", date);
    if (startTime) params.append("start_time", startTime);
    if (endTime) params.append("end_time", endTime);

    const queryString = params.toString();

    const endpoint = queryString
      ? `${APP_CONFIG.ENDPOINTS.TRAFFIC_GRAFIK}?${queryString}`
      : APP_CONFIG.ENDPOINTS.TRAFFIC_GRAFIK;

    return request(endpoint);
  },

  async getDashboardSummary() {
    return request(APP_CONFIG.ENDPOINTS.DASHBOARD);
  },

  async getFloodStatus(location?: string) {
    const url = location ? `${APP_CONFIG.ENDPOINTS.FLOOD}?location=${encodeURIComponent(location)}` : APP_CONFIG.ENDPOINTS.FLOOD;
    return request(url);
  },

  async getFloodLatest(location = "ketintang") {
    return request(`/api/flood/latest?location=${encodeURIComponent(location)}`);
  },

  async getFloodRecentChart(location = "ketintang", limit = 10) {
    return request(`/api/flood/recent?location=${encodeURIComponent(location)}&limit=${limit}`);
  },

  async getFloodHistory(location = "ketintang", limit = 25, interval = "10m") {
    return request(`/api/flood/history?location=${encodeURIComponent(location)}&limit=${limit}&interval=${encodeURIComponent(interval)}`);
  },

  async getTodayFloodHistory() {
    return request("/api/flood/history/today");
  },

  async getDigitalTwin() {
    return request("/api/digital-twin");
  },

  async getExportDates(module = "all") {
    return request(
      `${APP_CONFIG.ENDPOINTS.EXPORT_DATES}?module=${encodeURIComponent(module)}`
    );
  },

  async checkExportHistory(
    date: string,
    module = "all"
  ) {
    return request(
      `${APP_CONFIG.ENDPOINTS.EXPORT_CHECK}?date=${encodeURIComponent(
        date
      )}&module=${encodeURIComponent(module)}`
    );
  },

  getExportDownloadUrl(
    date: string,
    module = "traffic"
  ) {
    return `${APP_CONFIG.API_BASE_URL}${APP_CONFIG.ENDPOINTS.EXPORT_DOWNLOAD}?date=${encodeURIComponent(
      date
    )}&module=${encodeURIComponent(module)}`;
  },

  getFloodExportUrl(
    location: "ketintang" | "lidah",
    period: "today" | "monthly" = "today",
    year?: number,
    month?: number
  ) {
    const params = new URLSearchParams();
    params.append("location", location);
    params.append("period", period);
    if (year) params.append("year", String(year));
    if (month) params.append("month", String(month));
    return `${APP_CONFIG.API_BASE_URL}/api/flood/export?${params.toString()}`;
  },
};
