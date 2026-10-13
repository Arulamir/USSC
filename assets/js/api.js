/**
 * =========================================================
 * API & IOT SERVICE LAYER - SMART SUSTAINABILITY CAMPUS
 * Bertanggung jawab menangani request fetch ke Backend Server
 * dan koneksi MQTT Realtime untuk Pemantauan Banjir (ESP32/EMQX)
 * =========================================================
 */

const ApiService = {
    /**
     * Helper universal fetch dengan timeout dan error handling aman
     */
    async request(endpoint, options = {}) {
        const baseUrl = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.API_BASE_URL) 
            ? APP_CONFIG.API_BASE_URL 
            : "";
        
        const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout || 8000);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    "Accept": "application/json",
                    ...(options.headers || {})
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            console.warn(`[ApiService] Request gagal ke ${endpoint}:`, error.message);
            throw error;
        }
    },

    /**
     * Mengambil data cuaca Kota Surabaya (Open-Meteo API)
     */
    async getSurabayaWeather() {
        const weatherUrl = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.WEATHER_SURABAYA_URL)
            ? APP_CONFIG.WEATHER_SURABAYA_URL
            : "https://api.open-meteo.com/v1/forecast?latitude=-7.31&longitude=112.73&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FJakarta";
        return await this.request(weatherUrl);
    },

    /**
     * Mengambil data kualitas udara (AirGradient)
     */
    async getAirQuality() {
        const endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS)
            ? APP_CONFIG.ENDPOINTS.AIR_QUALITY
            : "/airquality";
        return await this.request(endpoint);
    },

    /**
     * Mengambil data pemantauan kendaraan & emisi
     */
    async getTrafficData(date = "", startTime = "", endTime = "") {
        let endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS)
            ? APP_CONFIG.ENDPOINTS.TRAFFIC_GRAFIK
            : "/traffic-grafik";
        
        const params = new URLSearchParams();
        if (date) params.append("tanggal", date);
        if (startTime) params.append("start_time", startTime);
        if (endTime) params.append("end_time", endTime);

        const queryString = params.toString();
        if (queryString) {
            endpoint += `?${queryString}`;
        }

        return await this.request(endpoint);
    },

    /**
     * Mengambil ringkasan data dashboard
     */
    async getDashboardSummary() {
        const endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS)
            ? APP_CONFIG.ENDPOINTS.DASHBOARD
            : "/api/dashboard";
        return await this.request(endpoint);
    },

    /**
     * Mengambil status sensor banjir realtime dari Backend Flask
     */
    async getFloodStatus() {
        const endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS && APP_CONFIG.ENDPOINTS.FLOOD)
            ? APP_CONFIG.ENDPOINTS.FLOOD
            : "/api/flood";
        return await this.request(endpoint);
    },

    /**
     * Mengambil riwayat data banjir per jam hari ini (maks 24 data) dari MariaDB
     */
    async getTodayFloodHistory() {
        return await this.request("/api/flood/history/today");
    },

    /**
     * Inisialisasi Monitoring Banjir Realtime (SSE + Fallback Polling 2 Detik)
     * Menggunakan Server-Sent Events (SSE) agar data sensor ter-push seketika tanpa delay.
     * Jika SSE terputus atau tidak didukung browser, otomatis beralih ke HTTP Polling setiap 2 detik.
     */
    initFloodMonitoring(onDataReceived, onStatusChange) {
        const intervalTime = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.POLLING_INTERVALS && APP_CONFIG.POLLING_INTERVALS.FLOOD)
            ? APP_CONFIG.POLLING_INTERVALS.FLOOD
            : 2000;

        let pollingTimerId = null;
        let isPolling = false;
        let eventSource = null;
        let isUsingFallback = false;

        const dispatchData = (data) => {
            if (!data || typeof onDataReceived !== "function") return;
            if (data.lidah) {
                onDataReceived("lidah", data.lidah);
            }
            if (data.ketintang) {
                onDataReceived("ketintang", data.ketintang);
            }
        };

        const pollFloodData = async () => {
            if (isPolling) return;
            isPolling = true;

            try {
                const res = await this.getFloodStatus();
                if (res && res.status === "success" && res.data) {
                    if (typeof onStatusChange === "function") {
                        onStatusChange("connected (Polling)");
                    }
                    dispatchData(res.data);
                }
            } catch (err) {
                console.warn("[Flood Monitor] Gagal mengambil data banjir dari backend:", err.message);
                if (typeof onStatusChange === "function") {
                    onStatusChange("offline");
                }
            } finally {
                isPolling = false;
            }
        };

        const startFallbackPolling = () => {
            if (pollingTimerId) return;
            isUsingFallback = true;
            console.log(`[Flood Monitor] Mengaktifkan fallback HTTP Polling (${intervalTime}ms)...`);
            pollFloodData();
            pollingTimerId = setInterval(pollFloodData, intervalTime);
        };

        // Siapkan URL endpoint streaming SSE
        const streamEndpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS && APP_CONFIG.ENDPOINTS.FLOOD_STREAM)
            ? APP_CONFIG.ENDPOINTS.FLOOD_STREAM
            : "/api/flood/stream";

        const baseUrl = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.API_BASE_URL)
            ? APP_CONFIG.API_BASE_URL
            : "";
        const fullStreamUrl = streamEndpoint.startsWith("http")
            ? streamEndpoint
            : `${baseUrl}${streamEndpoint}`;

        // Jalankan EventSource jika didukung
        if (typeof window !== "undefined" && "EventSource" in window) {
            try {
                eventSource = new EventSource(fullStreamUrl);

                eventSource.onopen = () => {
                    console.log("[Flood Monitor] Terhubung ke SSE stream realtime (sub-detik).");
                    if (typeof onStatusChange === "function") {
                        onStatusChange("connected (SSE)");
                    }
                    // Jika sebelumnya sempat fallback ke polling, hentikan polling
                    if (pollingTimerId) {
                        clearInterval(pollingTimerId);
                        pollingTimerId = null;
                        isUsingFallback = false;
                    }
                };

                eventSource.onmessage = (event) => {
                    if (!event.data) return;
                    try {
                        const data = JSON.parse(event.data);
                        if (typeof onStatusChange === "function") {
                            onStatusChange("connected (SSE)");
                        }
                        dispatchData(data);
                    } catch (e) {
                        console.warn("[Flood Monitor] Gagal parse payload SSE:", e);
                    }
                };

                eventSource.onerror = (err) => {
                    console.warn("[Flood Monitor] SSE terputus, mengaktifkan fallback HTTP polling...", err);
                    if (typeof onStatusChange === "function" && !isUsingFallback) {
                        onStatusChange("connecting (Fallback Polling)");
                    }
                    startFallbackPolling();
                };
            } catch (err) {
                console.warn("[Flood Monitor] Gagal membuat EventSource:", err);
                startFallbackPolling();
            }
        } else {
            // Browser klien tidak mendukung SSE
            startFallbackPolling();
        }

        return {
            stop: () => {
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                if (pollingTimerId) {
                    clearInterval(pollingTimerId);
                    pollingTimerId = null;
                }
            }
        };
    },

    /**
     * Alias backward-compatible agar kode UI lama tetap berjalan normal
     */
    initFloodMQTT(onDataReceived, onStatusChange) {
        return this.initFloodMonitoring(onDataReceived, onStatusChange);
    },

    /**
     * Mengambil daftar tanggal yang memiliki data di database
     * @param {string} module - 'all' | 'traffic' | 'airquality' | 'flood'
     */
    async getExportDates(module = "all") {
        const endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS && APP_CONFIG.ENDPOINTS.EXPORT_DATES)
            ? APP_CONFIG.ENDPOINTS.EXPORT_DATES
            : "/api/export/dates";
        return await this.request(`${endpoint}?module=${encodeURIComponent(module)}`);
    },

    /**
     * Memeriksa ringkasan statistik data pada tanggal tertentu
     * @param {string} date - Format YYYY-MM-DD
     * @param {string} module - 'all' | 'traffic' | 'airquality' | 'flood'
     */
    async checkExportHistory(date, module = "all") {
        const endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS && APP_CONFIG.ENDPOINTS.EXPORT_CHECK)
            ? APP_CONFIG.ENDPOINTS.EXPORT_CHECK
            : "/api/export/check";
        return await this.request(`${endpoint}?date=${encodeURIComponent(date)}&module=${encodeURIComponent(module)}`);
    },

    /**
     * Menghasilkan URL langsung untuk mengunduh data (CSV / ZIP)
     * @param {string} date - Format YYYY-MM-DD
     * @param {string} module - 'traffic' | 'airquality' | 'flood' | 'all'
     */
    getExportDownloadUrl(date, module = "traffic") {
        const baseUrl = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.API_BASE_URL)
            ? APP_CONFIG.API_BASE_URL
            : "";
        const endpoint = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.ENDPOINTS && APP_CONFIG.ENDPOINTS.EXPORT_DOWNLOAD)
            ? APP_CONFIG.ENDPOINTS.EXPORT_DOWNLOAD
            : "/api/export/download";
        return `${baseUrl}${endpoint}?date=${encodeURIComponent(date)}&module=${encodeURIComponent(module)}`;
    }
};
