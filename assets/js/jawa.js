/* =========================================================
   SMART SUSTAINABILITY CAMPUS
   JAWA.JS - VERSI PERBAIKAN
   ========================================================= */

"use strict";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const MAX_CHART_DATA = 10;
const MAX_HISTORY_DATA = 24;


/* =========================================================
   HELPER
   ========================================================= */

function random(min, max, decimal = 1) {
    const value = Math.random() * (max - min) + min;
    return Number(value.toFixed(decimal));
}


function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}


function pad(value) {
    return String(value).padStart(2, "0");
}


function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


function getTimeLabel(date = new Date()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}


function getHourLabel(date = new Date()) {
    return `${pad(date.getHours())}:00`;
}


function getDateKey(date = new Date()) {
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("-");
}


/* =========================================================
   DATE FORMAT
   ========================================================= */

function formatDate(date = new Date()) {

    const days = [
        "Minggu",
        "Senin",
        "Selasa",
        "Rabu",
        "Kamis",
        "Jumat",
        "Sabtu"
    ];

    const months = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember"
    ];

    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}


/* =========================================================
   CLOCK
   ========================================================= */

function updateClock() {

    const element = document.getElementById("currentTime");

    if (!element) return;

    element.textContent = getTimeLabel();
}


/* =========================================================
   DATA MODEL
   ========================================================= */

const locations = {

    lidah: {
        water: null,
        temp: null,
        soil: null,
        rain: null,
        panelTemp: null,
        panelHumidity: null,
        cityTemp: null,
        cityHumidity: null,
        status: "--"
    },

    ketintang: {
        water: null,
        temp: null,
        soil: null,
        rain: null,
        panelTemp: null,
        panelHumidity: null,
        cityTemp: null,
        cityHumidity: null,
        status: "--"
    }

};


const airData = {

    pm1: 0,
    pm25: 0,
    pm10: 0,

    co2: 0,

    temp: 0,
    humidity: 0,

    tvoc: 0,
    nox: 0
};


const vehicleData = {

    motor: 0,
    car: 0,
    bus: 0,
    truck: 0,

    emissionMotor: 0,
    emissionCar: 0,
    emissionBus: 0,
    emissionTruck: 0
};


/* =========================================================
   STATUS BANJIR
   ========================================================= */

function determineFloodStatus(water) {

    if (water === null || water === undefined || isNaN(water)) {
        return "--";
    }

    if (water >= 65) {
        return "BAHAYA";
    }

    if (water >= 40) {
        return "WASPADA";
    }

    return "AMAN";
}


function getStatusClass(status) {

    if (status === "BAHAYA") {
        return "danger";
    }

    if (status === "WASPADA") {
        return "warning";
    }

    if (status === "AMAN") {
        return "safe";
    }

    return "offline";
}


function getStatusDescription(status) {

    if (status === "BAHAYA") {
        return "Kondisi lingkungan berada pada tingkat bahaya.";
    }

    if (status === "WASPADA") {
        return "Terdapat indikasi kondisi lingkungan perlu diwaspadai.";
    }

    if (status === "AMAN") {
        return "Kondisi lingkungan dalam keadaan aman.";
    }

    return "Menunggu transmisi data dari sensor...";
}


/* =========================================================
   UPDATE STATUS UI
   ========================================================= */

function updateStatusUI(prefix, status) {

    const light = document.getElementById(
        `${prefix}StatusLight`
    );

    const text = document.getElementById(
        `${prefix}Status`
    );

    const description = document.getElementById(
        `${prefix}StatusDescription`
    );


    if (light) {

        light.className =
            `status-light large ${getStatusClass(status)}`;

    }


    if (text) {

        text.textContent = status || "--";

        if (status === "BAHAYA") {
            text.style.color = "var(--red)";
        }

        else if (status === "WASPADA") {
            text.style.color = "var(--yellow)";
        }

        else if (status === "AMAN") {
            text.style.color = "var(--green)";
        }

        else {
            text.style.color = "var(--gray-500)";
        }

    }


    if (description) {

        description.textContent =
            getStatusDescription(status);

    }

}


function updateLight(id, status) {

    const element =
        document.getElementById(id);

    if (!element) return;

    element.className =
        `status-light ${getStatusClass(status)}`;
}


/* =========================================================
   HELPER FORMAT NILAI SENSOR
   ========================================================= */

function formatSensorValue(val, unit, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) {
        return `-- ${unit}`;
    }
    return `${Number(val).toFixed(decimals)} ${unit}`;
}


/* =========================================================
   RENDER DOM DATA LOKASI BANJIR
   ========================================================= */

function renderLocationDOM(locationName) {

    const data = locations[locationName];

    if (!data) return;

    const prefix =
        locationName === "lidah"
            ? "lidah"
            : "ketintang";

    /* DOM TEXT */
    setText(
        `${prefix}Water`,
        formatSensorValue(data.water, "cm")
    );

    setText(
        `${prefix}Temp`,
        formatSensorValue(data.temp, "°C")
    );

    setText(
        `${prefix}Soil`,
        formatSensorValue(data.soil, "%")
    );

    setText(
        `${prefix}Rain`,
        formatSensorValue(data.rain, "mm/jam")
    );

    setText(
        `${prefix}PanelTemp`,
        formatSensorValue(data.panelTemp, "°C")
    );

    setText(
        `${prefix}PanelHumidity`,
        formatSensorValue(data.panelHumidity, "%")
    );

    setText(
        `${prefix}CityTemp`,
        formatSensorValue(data.cityTemp, "°C")
    );

    setText(
        `${prefix}CityHumidity`,
        formatSensorValue(data.cityHumidity, "%")
    );

    updateStatusUI(
        prefix,
        data.status
    );

    /* DASHBOARD CARDS */
    if (locationName === "lidah") {
        setText(
            "dashLidahWater",
            formatSensorValue(data.water, "cm")
        );

        setText(
            "dashLidahTemp",
            formatSensorValue(data.temp, "°C")
        );

        setText(
            "dashLidahSoil",
            formatSensorValue(data.soil, "%")
        );

        updateLight(
            "dashboardLightLidah",
            data.status
        );
    }

    if (locationName === "ketintang") {
        setText(
            "dashKetintangWater",
            formatSensorValue(data.water, "cm")
        );

        setText(
            "dashKetintangTemp",
            formatSensorValue(data.temp, "°C")
        );

        setText(
            "dashKetintangSoil",
            formatSensorValue(data.soil, "%")
        );

        updateLight(
            "dashboardLightKetintang",
            data.status
        );
    }

    updateDashboardFloodAggregate();
}


/* =========================================================
   HANDLE DATA MQTT REALTIME DARI BROKER (BACKEND LAMA)
   ========================================================= */

function handleFloodMQTTData(locationKey, incomingData) {
    const loc = locations[locationKey];
    if (!loc || !incomingData) return;

    if (incomingData.jarak !== undefined && incomingData.jarak !== null) {
        loc.water = Number(incomingData.jarak);
    }

    if (incomingData.suhu_udara !== undefined && incomingData.suhu_udara !== null) {
        loc.temp = Number(incomingData.suhu_udara);
    }

    if (incomingData.soil !== undefined && incomingData.soil !== null) {
        loc.soil = Number(incomingData.soil);
    }

    if (incomingData.rain !== undefined && incomingData.rain !== null) {
        loc.rain = Number(incomingData.rain);
    }

    if (incomingData.temp_panel !== undefined && incomingData.temp_panel !== null) {
        loc.panelTemp = Number(incomingData.temp_panel);
    }

    if (incomingData.hum_panel !== undefined && incomingData.hum_panel !== null) {
        loc.panelHumidity = Number(incomingData.hum_panel);
    }

    if (incomingData.status) {
        loc.status = String(incomingData.status).trim().toUpperCase();
    } else {
        loc.status = determineFloodStatus(loc.water);
    }

    // Tandai timestamp penerimaan data real dari sensor
    loc.lastMqttUpdate = Date.now();

    // Render ke UI
    renderLocationDOM(locationKey);
}


/* =========================================================
   FETCH CUACA KOTA SURABAYA (OPEN-METEO)
   ========================================================= */

async function updateSurabayaWeather() {
    if (typeof ApiService === "undefined" || !ApiService.getSurabayaWeather) return;

    try {
        const weather = await ApiService.getSurabayaWeather();
        if (weather && weather.current) {
            const temp = Number(weather.current.temperature_2m);
            const hum = Number(weather.current.relative_humidity_2m);

            locations.lidah.cityTemp = temp;
            locations.lidah.cityHumidity = hum;
            locations.ketintang.cityTemp = temp;
            locations.ketintang.cityHumidity = hum;

            setText("lidahCityTemp", `${temp.toFixed(1)} °C`);
            setText("lidahCityHumidity", `${hum.toFixed(1)} %`);
            setText("ketintangCityTemp", `${temp.toFixed(1)} °C`);
            setText("ketintangCityHumidity", `${hum.toFixed(1)} %`);

            // Update Weather Widget di Topbar Kanan
            setText("topbarWeatherTemp", `${temp.toFixed(1)} °C`);

            const weatherIconEl = document.getElementById("topbarWeatherIcon");
            const weatherWidgetEl = document.getElementById("topbarWeather");
            const weatherCode = Number(weather.current.weather_code ?? 0);

            if (weatherIconEl) {
                let iconClass = "bi bi-cloud-sun-fill";
                let weatherText = "Cerah Berawan";
                let iconColor = "#eab308";

                if (weatherCode === 0) {
                    iconClass = "bi bi-sun-fill";
                    weatherText = "Cerah";
                    iconColor = "#f59e0b";
                } else if ([1, 2, 3].includes(weatherCode)) {
                    iconClass = "bi bi-cloud-sun-fill";
                    weatherText = "Sebagian Berawan";
                    iconColor = "#eab308";
                } else if ([45, 48].includes(weatherCode)) {
                    iconClass = "bi bi-cloud-fog2-fill";
                    weatherText = "Berkabut";
                    iconColor = "#94a3b8";
                } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) {
                    iconClass = "bi bi-cloud-rain-fill";
                    weatherText = "Hujan";
                    iconColor = "#0284c7";
                } else if ([95, 96, 99].includes(weatherCode)) {
                    iconClass = "bi bi-cloud-lightning-rain-fill";
                    weatherText = "Badai Petir";
                    iconColor = "#7c3aed";
                }

                weatherIconEl.className = iconClass;
                weatherIconEl.style.color = iconColor;
                if (weatherWidgetEl) {
                    weatherWidgetEl.title = `Surabaya: ${weatherText} (${temp.toFixed(1)} °C, Kelembaban ${hum}%)`;
                }
            }
        }
    } catch (error) {
        console.warn("[Weather] Error mengambil cuaca Surabaya:", error.message);
    }
}


/* =========================================================
   UPDATE DATA LOKASI (HANYA RENDER DATA REAL - TANPA SIMULASI)
   ========================================================= */

function updateLocationData(locationName) {
    // Tanpa dual mode/simulasi: hanya render data real yang ada dari MQTT
    renderLocationDOM(locationName);
}

/* =========================================================
   UPDATE STATUS BANJIR DASHBOARD AGREGAT
   ========================================================= */
function updateDashboardFloodAggregate() {
    const statusLidah = locations.lidah.status;
    const statusKetintang = locations.ketintang.status;

    let finalStatus = "--";
    let finalDesc = "Menunggu data sensor...";
    let textColor = "var(--gray-500)";

    // Jika keduanya belum ada data sensor
    if ((!statusLidah || statusLidah === "--") && (!statusKetintang || statusKetintang === "--")) {
        finalStatus = "--";
        finalDesc = "Sensor belum terhubung / offline";
        textColor = "var(--gray-500)";
    }
    // 1. Evaluasi Tingkat Risiko Tertinggi (BAHAYA)
    else if (statusLidah === "BAHAYA" && statusKetintang === "BAHAYA") {
        finalStatus = "BAHAYA";
        finalDesc = "2 Lokasi Kondisi BAHAYA";
        textColor = "var(--red)";
    } else if (statusLidah === "BAHAYA" || statusKetintang === "BAHAYA") {
        finalStatus = "BAHAYA";
        finalDesc = statusLidah === "BAHAYA" ? "Lidah Wetan kondisi BAHAYA" : "Ketintang kondisi BAHAYA";
        textColor = "var(--red)";
    }
    // 2. Evaluasi Tingkat Risiko Menengah (WASPADA)
    else if (statusLidah === "WASPADA" && statusKetintang === "WASPADA") {
        finalStatus = "WASPADA";
        finalDesc = "2 Lokasi Kondisi Waspada";
        textColor = "var(--yellow)";
    } else if (statusLidah === "WASPADA" || statusKetintang === "WASPADA") {
        finalStatus = "WASPADA";
        finalDesc = statusLidah === "WASPADA" ? "Lidah Wetan kondisi Waspada" : "Ketintang kondisi Waspada";
        textColor = "var(--yellow)";
    }
    // 3. Jika Keduanya atau salah satunya AMAN
    else if (statusLidah === "AMAN" && statusKetintang === "AMAN") {
        finalStatus = "AMAN";
        finalDesc = "2 Lokasi Kondisi AMAN";
        textColor = "var(--green)";
    } else if (statusLidah === "AMAN" || statusKetintang === "AMAN") {
        finalStatus = "AMAN";
        finalDesc = statusLidah === "AMAN" ? "Lidah Wetan AMAN (Ketintang menunggu data)" : "Ketintang AMAN (Lidah Wetan menunggu data)";
        textColor = "var(--green)";
    }

    // Update DOM
    const elStatus = document.getElementById("dashboardFloodStatus");
    const elDesc = document.getElementById("dashboardFloodDesc");

    if (elStatus) {
        elStatus.textContent = finalStatus;
        elStatus.style.color = textColor;
    }

    if (elDesc) {
        elDesc.textContent = finalDesc;
    }
}

/* =========================================================
   CHART DATA
   ========================================================= */

const chartData = {

    lidah: {
        labels: [],
        water: [],
        temp: [],
        soil: []
    },

    ketintang: {
        labels: [],
        water: [],
        temp: [],
        soil: []
    },

    air: {
        labels: [],
        pm1: [],
        pm25: [],
        pm10: [],
        co2: []
    },

    vehicle: {
        labels: [],
        total: [],
        emission: []
    }

};


/* =========================================================
   CHART OBJECT
   ========================================================= */

const charts = {};


/* =========================================================
   CREATE LINE CHART
   ========================================================= */

function createLineChart(
    canvasId,
    label,
    data,
    labels,
    unit
) {

    const canvas =
        document.getElementById(canvasId);

    if (!canvas) {
        console.warn(
            `Canvas ${canvasId} tidak ditemukan.`
        );

        return null;
    }


    if (typeof Chart === "undefined") {

        console.error(
            "Chart.js belum dimuat."
        );

        return null;
    }


    return new Chart(
        canvas,
        {

            type: "line",

            data: {

                labels: labels,

                datasets: [

                    {

                        label: label,

                        data: data,

                        borderColor: "#059669",

                        backgroundColor:
                            "rgba(16, 185, 129, 0.10)",

                        borderWidth: 2,

                        pointRadius: 3,

                        pointHoverRadius: 5,

                        tension: 0.35,

                        fill: true

                    }

                ]

            },


            options: {

                responsive: true,

                maintainAspectRatio: false,


                interaction: {

                    intersect: false,

                    mode: "index"

                },


                plugins: {

                    legend: {
                        display: false
                    },


                    tooltip: {

                        callbacks: {

                            label: function (context) {

                                return `${context.parsed.y} ${unit}`;

                            }

                        }

                    }

                },


                scales: {

                    x: {

                        grid: {
                            display: false
                        },

                        ticks: {

                            font: {
                                size: 9
                            },

                            color: "#94a3b8"

                        }

                    },


                    y: {

                        beginAtZero: false,

                        grid: {

                            color: "#edf1f5"

                        },

                        ticks: {

                            font: {
                                size: 9
                            },

                            color: "#94a3b8"

                        }

                    }

                }

            }

        }
    );
}


/* =========================================================
   INITIALIZE CHART
   ========================================================= */

function initializeCharts() {

    charts.lidahWater =
        createLineChart(
            "lidahWaterChart",
            "Ketinggian Air",
            chartData.lidah.water,
            chartData.lidah.labels,
            "cm"
        );


    charts.lidahTemp =
        createLineChart(
            "lidahTempChart",
            "Suhu",
            chartData.lidah.temp,
            chartData.lidah.labels,
            "°C"
        );


    charts.lidahSoil =
        createLineChart(
            "lidahSoilChart",
            "Kelembaban Tanah",
            chartData.lidah.soil,
            chartData.lidah.labels,
            "%"
        );


    charts.ketintangWater =
        createLineChart(
            "ketintangWaterChart",
            "Ketinggian Air",
            chartData.ketintang.water,
            chartData.ketintang.labels,
            "cm"
        );


    charts.ketintangTemp =
        createLineChart(
            "ketintangTempChart",
            "Suhu",
            chartData.ketintang.temp,
            chartData.ketintang.labels,
            "°C"
        );


    charts.ketintangSoil =
        createLineChart(
            "ketintangSoilChart",
            "Kelembaban Tanah",
            chartData.ketintang.soil,
            chartData.ketintang.labels,
            "%"
        );


    charts.airPM1 =
        createLineChart(
            "airPM1Chart",
            "PM1.0",
            chartData.air.pm1,
            chartData.air.labels,
            "µg/m³"
        );


    charts.airPM25 =
        createLineChart(
            "airPM25Chart",
            "PM2.5",
            chartData.air.pm25,
            chartData.air.labels,
            "µg/m³"
        );


    charts.airPM10 =
        createLineChart(
            "airPM10Chart",
            "PM10",
            chartData.air.pm10,
            chartData.air.labels,
            "µg/m³"
        );


    charts.airCO2 =
        createLineChart(
            "airCO2Chart",
            "CO₂",
            chartData.air.co2,
            chartData.air.labels,
            "ppm"
        );


    charts.vehicle =
        createLineChart(
            "vehicleChart",
            "Total Kendaraan",
            chartData.vehicle.total,
            chartData.vehicle.labels,
            "kendaraan"
        );


    charts.emission =
        createLineChart(
            "emissionChart",
            "Total Emisi",
            chartData.vehicle.emission,
            chartData.vehicle.labels,
            "kg"
        );

}


/* =========================================================
   UPDATE LOCATION CHART
   ========================================================= */

function updateLocationCharts(locationName) {

    if (locationName === "lidah") {

        if (charts.lidahWater) {
            charts.lidahWater.update("none");
        }

        if (charts.lidahTemp) {
            charts.lidahTemp.update("none");
        }

        if (charts.lidahSoil) {
            charts.lidahSoil.update("none");
        }

    }


    if (locationName === "ketintang") {

        if (charts.ketintangWater) {
            charts.ketintangWater.update("none");
        }

        if (charts.ketintangTemp) {
            charts.ketintangTemp.update("none");
        }

        if (charts.ketintangSoil) {
            charts.ketintangSoil.update("none");
        }

    }

}


/* =========================================================
   PUSH FLOOD CHART DATA
   ========================================================= */

function pushChartData(locationName) {

    const data =
        locations[locationName];

    const chart =
        chartData[locationName];

    if (!data || !chart) return;

    // Hanya push ke grafik jika data sensor riil sudah ada (tidak null)
    if (data.water === null || isNaN(data.water)) return;

    const now = new Date();

    chart.labels.push(
        getTimeLabel(now)
    );

    chart.water.push(
        Number(data.water.toFixed(1))
    );

    chart.temp.push(
        data.temp !== null ? Number(data.temp.toFixed(1)) : 0
    );

    chart.soil.push(
        data.soil !== null ? Number(data.soil.toFixed(1)) : 0
    );

    while (
        chart.labels.length >
        MAX_CHART_DATA
    ) {
        chart.labels.shift();
        chart.water.shift();
        chart.temp.shift();
        chart.soil.shift();
    }

    updateLocationCharts(
        locationName
    );

}


/* =========================================================
   AIR QUALITY
   ========================================================= */

async function updateAirData() {

    if (typeof ApiService !== "undefined" && ApiService.getAirQuality) {
        try {
            const res = await ApiService.getAirQuality();
            if (res && res.status === "success" && res.latest) {
                const data = res.latest;
                airData.pm1 = data.pm01 || 0;
                airData.pm25 = data.pm02 || 0;
                airData.pm10 = data.pm10 || 0;
                airData.co2 = data.co2 || 0;
                airData.temp = data.temperature || 0;
                airData.humidity = data.humidity || 0;
                airData.tvoc = data.tvoc || 0;
                airData.nox = data.nox_index || 0;
            }
        } catch (e) {
            console.error("Gagal update air data:", e);
        }
    }

    /* DOM */

    setText(
        "airPM1",
        airData.pm1.toFixed(1)
    );


    setText(
        "airPM25",
        airData.pm25.toFixed(1)
    );


    setText(
        "airPM10",
        airData.pm10.toFixed(1)
    );


    setText(
        "airCO2",
        Math.round(airData.co2)
    );


    setText(
        "airTemp",
        airData.temp.toFixed(1)
    );


    setText(
        "airHumidity",
        airData.humidity.toFixed(1)
    );


    setText(
        "airTVOC",
        Math.round(airData.tvoc)
    );


    setText(
        "airNOX",
        airData.nox.toFixed(1)
    );


    /* DASHBOARD */

    setText(
        "dashboardPM1",
        `${airData.pm1.toFixed(1)} µg/m³`
    );

    setText(
        "dashboardPM25",
        `${airData.pm25.toFixed(1)} µg/m³`
    );

    setText(
        "dashboardPM10",
        `${airData.pm10.toFixed(1)} µg/m³`
    );

    setText(
        "dashboardCO2",
        `${Math.round(airData.co2)} ppm`
    );


    /* PROGRESS */

    setProgress(
        "pm1Progress",
        airData.pm1,
        50
    );


    setProgress(
        "pm25Progress",
        airData.pm25,
        50
    );


    setProgress(
        "pm10Progress",
        airData.pm10,
        100
    );


    setProgress(
        "co2Progress",
        airData.co2 - 400,
        1100
    );


    /* CHART */

    chartData.air.labels.push(
        getTimeLabel()
    );


    chartData.air.pm1.push(
        Number(
            airData.pm1.toFixed(1)
        )
    );


    chartData.air.pm25.push(
        Number(
            airData.pm25.toFixed(1)
        )
    );


    chartData.air.pm10.push(
        Number(
            airData.pm10.toFixed(1)
        )
    );


    chartData.air.co2.push(
        Math.round(airData.co2)
    );


    while (
        chartData.air.labels.length >
        MAX_CHART_DATA
    ) {

        chartData.air.labels.shift();
        chartData.air.pm1.shift();
        chartData.air.pm25.shift();
        chartData.air.pm10.shift();
        chartData.air.co2.shift();

    }


    if (charts.airPM1) {
        charts.airPM1.update("none");
    }

    if (charts.airPM25) {
        charts.airPM25.update("none");
    }

    if (charts.airPM10) {
        charts.airPM10.update("none");
    }

    if (charts.airCO2) {
        charts.airCO2.update("none");
    }


    updateAirStatus();

}


/* =========================================================
   AIR PROGRESS
   ========================================================= */

function setProgress(id, value, max) {

    const element =
        document.getElementById(id);

    if (!element) return;


    const percentage =
        clamp(
            (value / max) * 100,
            3,
            100
        );


    element.style.width =
        `${percentage}%`;

}


/* =========================================================
   AIR STATUS
   ========================================================= */

function updateAirStatus() {

    let status = "BAIK";


    if (
        airData.pm25 >= 35 ||
        airData.co2 >= 1000
    ) {

        status = "WASPADA";

    }


    if (
        airData.pm25 >= 55 ||
        airData.co2 >= 1500
    ) {

        status = "BURUK";

    }


    const element =
        document.getElementById(
            "dashboardAirStatus"
        );


    if (!element) return;


    element.textContent =
        status;


    if (status === "BURUK") {

        element.style.color =
            "var(--red)";

    }

    else if (status === "WASPADA") {

        element.style.color =
            "var(--yellow)";

    }

    else {

        element.style.color =
            "var(--green)";

    }

}


/* =========================================================
   VEHICLE
   ========================================================= */

function calculateVehicleTotals() {

    const totalVehicles =
        vehicleData.motor +
        vehicleData.car +
        vehicleData.bus +
        vehicleData.truck;


    const totalEmission =
        vehicleData.emissionMotor +
        vehicleData.emissionCar +
        vehicleData.emissionBus +
        vehicleData.emissionTruck;


    return {
        totalVehicles,
        totalEmission
    };

}


async function updateVehicleData(
    addChartPoint = true
) {

    if (typeof ApiService !== "undefined" && ApiService.getTrafficData) {
        try {
            const res = await ApiService.getTrafficData();
            if (res && res.status === "success" && res.vehicle && res.vehicle.summary) {
                const vData = res.vehicle.summary;
                const eData = res.emission.summary;

                vehicleData.motor = vData.motor || 0;
                vehicleData.car = vData.mobil || 0;
                vehicleData.bus = vData.bus || 0;
                vehicleData.truck = vData.truck || 0;

                vehicleData.emissionMotor = eData.motor || 0;
                vehicleData.emissionCar = eData.mobil || 0;
                vehicleData.emissionBus = eData.bus || 0;
                vehicleData.emissionTruck = eData.truck || 0;
            }
        } catch (e) {
            console.error("Gagal update vehicle data:", e);
        }
    }

    const totals =
        calculateVehicleTotals();


    /* DOM */

    setText(
        "vehicleMotor",
        vehicleData.motor
    );


    setText(
        "vehicleCar",
        vehicleData.car
    );


    setText(
        "vehicleBus",
        vehicleData.bus
    );


    setText(
        "vehicleTruck",
        vehicleData.truck
    );


    setText(
        "vehicleTotal",
        totals.totalVehicles
    );


    setText(
        "emissionMotor",
        `${vehicleData.emissionMotor.toFixed(1)} kg`
    );


    setText(
        "emissionCar",
        `${vehicleData.emissionCar.toFixed(1)} kg`
    );


    setText(
        "emissionTruck",
        `${vehicleData.emissionTruck.toFixed(1)} kg`
    );


    setText(
        "emissionTotal",
        `${totals.totalEmission.toFixed(1)} kg`
    );


    /* DASHBOARD */

    setText(
        "dashboardVehicleTotal",
        totals.totalVehicles
    );


    setText(
        "dashboardEmission",
        `${totals.totalEmission.toFixed(1)} kg`
    );


    /* CHART */

    if (addChartPoint) {

        const now = new Date();


        chartData.vehicle.labels.push(
            getHourLabel(now)
        );


        chartData.vehicle.total.push(
            totals.totalVehicles
        );


        chartData.vehicle.emission.push(
            Number(
                totals.totalEmission.toFixed(1)
            )
        );


        while (
            chartData.vehicle.labels.length >
            MAX_CHART_DATA
        ) {

            chartData.vehicle.labels.shift();
            chartData.vehicle.total.shift();
            chartData.vehicle.emission.shift();

        }


        if (charts.vehicle) {
            charts.vehicle.update("none");
        }


        if (charts.emission) {
            charts.emission.update("none");
        }

    }

}


/* =========================================================
   HISTORY
   ========================================================= */

const history = {

    lidah: [],

    ketintang: []

};


let historyDate =
    getDateKey();


let lastRecordedHour =
    null;


/* =========================================================
   ADD HISTORY (Maks 24 Jam Harian)
   ========================================================= */

function addHistory(locationName) {
    const data = locations[locationName];
    if (!data || data.water === null || isNaN(data.water)) return;

    const now = new Date();
    const hourTime = `${pad(now.getHours())}:00`;

    // Cek apakah jam ini sudah ada di riwayat agar tidak duplikat
    const existingIndex = history[locationName].findIndex(item => item.time === hourTime);
    const newEntry = {
        date: formatDate(now),
        time: hourTime,
        water: data.water.toFixed(1),
        temp: data.temp !== null ? data.temp.toFixed(1) : "--",
        soil: data.soil !== null ? data.soil.toFixed(1) : "--",
        status: data.status
    };

    if (existingIndex >= 0) {
        history[locationName][existingIndex] = newEntry;
    } else {
        history[locationName].push(newEntry);
    }

    while (history[locationName].length > MAX_HISTORY_DATA) {
        history[locationName].shift();
    }

    renderHistory(locationName);
}

/**
 * Memuat riwayat data banjir per jam hari ini dari MariaDB
 * sehingga saat browser dibuka/di-refresh, data jam yang lewat tidak hilang.
 */
async function loadInitialHistoryFromDB() {
    if (typeof ApiService === "undefined" || !ApiService.getTodayFloodHistory) return;
    try {
        const res = await ApiService.getTodayFloodHistory();
        if (res && res.status === "success" && res.data) {
            if (Array.isArray(res.data.lidah) && res.data.lidah.length > 0) {
                history.lidah = res.data.lidah.slice(-MAX_HISTORY_DATA);
                renderHistory("lidah");
            }
            if (Array.isArray(res.data.ketintang) && res.data.ketintang.length > 0) {
                history.ketintang = res.data.ketintang.slice(-MAX_HISTORY_DATA);
                renderHistory("ketintang");
            }
        }
    } catch (err) {
        console.warn("[History] Gagal memuat riwayat harian dari DB:", err);
    }
}


/* =========================================================
   RENDER HISTORY
   ========================================================= */

function renderHistory(locationName) {

    const tbody =
        document.getElementById(
            `${locationName}HistoryBody`
        );


    if (!tbody) return;


    tbody.innerHTML = "";


    const data =
        history[locationName];


    if (!data || data.length === 0) {

        tbody.innerHTML = `

            <tr>

                <td
                    colspan="7"
                    style="
                        text-align:center;
                        padding:25px;
                        color:#94a3b8;
                    "
                >
                    Belum ada data histori.
                </td>

            </tr>

        `;

        return;

    }


    data
        .slice()
        .reverse()
        .forEach(
            (item, index) => {

                const row =
                    document.createElement(
                        "tr"
                    );


                row.innerHTML = `

                    <td>
                        ${index + 1}
                    </td>

                    <td>
                        ${item.date}
                    </td>

                    <td>
                        ${item.time}
                    </td>

                    <td>
                        ${item.water} cm
                    </td>

                    <td>
                        ${item.temp} °C
                    </td>

                    <td>
                        ${item.soil} %
                    </td>

                    <td>

                        <span
                            class="
                                status-badge
                                ${getStatusClass(item.status)}
                            "
                        >
                            ${item.status}
                        </span>

                    </td>

                `;


                tbody.appendChild(row);

            }
        );


    setText(
        `${locationName}HistoryDate`,
        formatDate()
    );

}


/* =========================================================
   DAILY HISTORY RESET
   ========================================================= */

function checkDayChange() {

    const currentDate =
        getDateKey();


    if (
        currentDate !==
        historyDate
    ) {

        historyDate =
            currentDate;


        history.lidah = [];
        history.ketintang = [];


        lastRecordedHour =
            null;


        renderHistory(
            "lidah"
        );


        renderHistory(
            "ketintang"
        );


        setText(
            "lidahHistoryDate",
            formatDate()
        );


        setText(
            "ketintangHistoryDate",
            formatDate()
        );

    }

}


/* =========================================================
   EXACT HOURLY UPDATE
   ========================================================= */

function checkExactHour() {

    const now =
        new Date();


    const currentDate =
        getDateKey(now);


    const currentHour =
        now.getHours();


    const currentMinute =
        now.getMinutes();


    const currentSecond =
        now.getSeconds();


    /*
       Data histori hanya dibuat ketika
       jam tepat:

       00:00
       01:00
       02:00
       03:00
       ...
       23:00

       Toleransi 2 detik digunakan
       untuk menghindari browser melewatkan
       detik ke-00.
    */

    /*
       === KODE LAMA (Pencatatan per jam) ===
       if (
           currentMinute === 0 &&
           currentSecond <= 2
       ) {
           const hourKey =
               `${currentDate}-${currentHour}`;

           if (
               hourKey !==
               lastRecordedHour
           ) {
               lastRecordedHour =
                   hourKey;
       }
    */

    /* Pencatatan per jam tepat (00:00, 01:00, ... 23:00) */
    if (
        currentMinute === 0 &&
        currentSecond <= 2
    ) {
        const hourKey =
            `${currentDate}-${currentHour}`;

        if (
            hourKey !==
            lastRecordedHour
        ) {
            lastRecordedHour =
                hourKey;

            /*
               Cek pergantian hari
               sebelum menambahkan histori.
            */
            checkDayChange();

            addHistory(
                "lidah"
            );

            addHistory(
                "ketintang"
            );

            /*
               Kendaraan juga update
               setiap jam tepat.
            */
            updateVehicleData(
                true
            );
        }
    }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function initializeNavigation() {

    const pages =
        document.querySelectorAll(
            ".page"
        );


    const menuItems =
        document.querySelectorAll(
            ".menu-item, .submenu-item, .detail-btn"
        );


    const floodMenu =
        document.getElementById(
            "floodMenu"
        );


    const floodSubmenu =
        document.getElementById(
            "floodSubmenu"
        );


    const sidebar =
        document.getElementById(
            "sidebar"
        );


    const overlay =
        document.getElementById(
            "sidebarOverlay"
        );


    const mobileMenuBtn =
        document.getElementById(
            "mobileMenuBtn"
        );


    /* ===============================
       SHOW PAGE
       =============================== */

    function showPage(pageName) {

        pages.forEach(
            page => {

                page.classList.remove(
                    "active"
                );

            }
        );


        const target =
            document.getElementById(
                `page-${pageName}`
            );


        if (target) {

            target.classList.add(
                "active"
            );

        }


        document
            .querySelectorAll(
                ".menu-item, .submenu-item"
            )
            .forEach(
                item => {

                    item.classList.remove(
                        "active"
                    );

                }
            );


        const activeItem =
            document.querySelector(
                `[data-page="${pageName}"]`
            );


        if (activeItem) {

            activeItem.classList.add(
                "active"
            );

        }


        /*
           Jika membuka halaman
           Lidah Wetan atau Ketintang,
           otomatis buka submenu banjir.
        */

        if (
            (
                pageName === "lidah-wetan" ||
                pageName === "ketintang"
            ) &&
            floodMenu &&
            floodSubmenu
        ) {

            floodMenu.classList.add(
                "open"
            );

            floodSubmenu.classList.add(
                "open"
            );

        }


        closeMobileSidebar();


        /*
           Resize Chart
        */

        setTimeout(
            () => {

                Object
                    .values(charts)
                    .forEach(
                        chart => {

                            if (
                                chart &&
                                typeof chart.resize === "function"
                            ) {

                                chart.resize();

                            }

                        }
                    );

            },
            150
        );

    }


    /* ===============================
       MENU CLICK
       =============================== */

    menuItems.forEach(
        item => {

            item.addEventListener(
                "click",
                function (event) {

                    const page =
                        this.dataset.page;


                    if (page) {

                        event.preventDefault();

                        showPage(page);

                    }

                }
            );

        }
    );


    /* ===============================
       FLOOD MENU
       =============================== */

    if (
        floodMenu &&
        floodSubmenu
    ) {

        floodMenu.addEventListener(
            "click",
            function (event) {

                /*
                   Jangan toggle ketika
                   user menekan submenu.
                */

                if (
                    event.target.closest(
                        ".submenu-item"
                    )
                ) {

                    return;

                }


                floodMenu.classList.toggle(
                    "open"
                );


                floodSubmenu.classList.toggle(
                    "open"
                );

            }
        );

    }


    /* ===============================
       MOBILE SIDEBAR
       =============================== */

    function openMobileSidebar() {

        if (sidebar) {

            sidebar.classList.add(
                "mobile-open"
            );

        }


        if (overlay) {

            overlay.classList.add(
                "active"
            );

        }

    }


    function closeMobileSidebar() {

        if (sidebar) {

            sidebar.classList.remove(
                "mobile-open"
            );

        }


        if (overlay) {

            overlay.classList.remove(
                "active"
            );

        }

    }


    if (mobileMenuBtn) {

        mobileMenuBtn.addEventListener(
            "click",
            openMobileSidebar
        );

    }


    if (overlay) {

        overlay.addEventListener(
            "click",
            closeMobileSidebar
        );

    }


    /*
       Escape untuk menutup sidebar
    */

    document.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key === "Escape"
            ) {

                closeMobileSidebar();

            }

        }
    );


    /*
       Simpan fungsi agar bisa
       digunakan oleh fungsi lain.
    */

    window.showPage =
        showPage;


    window.closeMobileSidebar =
        closeMobileSidebar;

}


/* =========================================================
   INITIAL DATA
   ========================================================= */

function initializeData() {

    const now =
        new Date();

    // Render kondisi awal kosong/placeholder untuk banjir
    renderLocationDOM("lidah");
    renderLocationDOM("ketintang");

    for (
        let i = MAX_CHART_DATA - 1;
        i >= 0;
        i--
    ) {

        const timestamp =
            new Date(
                now.getTime() -
                (
                    i * 10000
                )
            );

        /*
           AIR QUALITY
        */

        chartData.air.labels.push(
            getTimeLabel(timestamp)
        );


        chartData.air.pm1.push(
            Number(
                airData.pm1.toFixed(1)
            )
        );


        chartData.air.pm25.push(
            Number(
                airData.pm25.toFixed(1)
            )
        );


        chartData.air.pm10.push(
            Number(
                airData.pm10.toFixed(1)
            )
        );


        chartData.air.co2.push(
            Math.round(
                airData.co2
            )
        );

    }


    /*
       Update data tampilan
    */

    updateLocationData(
        "lidah"
    );


    updateLocationData(
        "ketintang"
    );


    updateAirData();


    /*
       Kendaraan awal tanpa
       menambahkan titik histori
       kedua kali.
    */

    updateVehicleData(
        false
    );


    /*
       Tambahkan satu titik kendaraan
       untuk chart awal.
    */

    const totals =
        calculateVehicleTotals();


    chartData.vehicle.labels.push(
        getHourLabel()
    );


    chartData.vehicle.total.push(
        totals.totalVehicles
    );


    chartData.vehicle.emission.push(
        Number(
            totals.totalEmission.toFixed(1)
        )
    );

}


/* =========================================================
   MAIN INITIALIZATION
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        console.log(
            "Smart Sustainability Campus berhasil dimuat."
        );


        /*
           Clock
        */

        updateClock();


        setInterval(
            updateClock,
            1000
        );


        /*
           Navigation
        */

        initializeNavigation();


        /*
           Data awal
        */

        initializeData();


        /*
           Chart
        */

        initializeCharts();


        /*
           History
        */

        renderHistory(
            "lidah"
        );


        renderHistory(
            "ketintang"
        );

        // Muat riwayat per jam hari ini dari MariaDB agar tabel tidak kosong saat refresh
        loadInitialHistoryFromDB();


        /*
           Check day
        */

        checkDayChange();


        /*
           Check exact hour
        */

        checkExactHour();


        /*
           ==========================================
           UPDATE SENSOR & GRAFIK SETIAP 2 DETIK
           ==========================================
        */

        setInterval(
            function () {

                updateLocationData(
                    "lidah"
                );


                updateLocationData(
                    "ketintang"
                );


                pushChartData(
                    "lidah"
                );


                pushChartData(
                    "ketintang"
                );


                updateAirData();


                checkDayChange();

            },
            2000
        );


        /*
           ==========================================
           PEMERIKSAAN JAM SETIAP DETIK
           ==========================================
        */

        setInterval(
            function () {

                checkExactHour();

            },
            1000
        );


        /*
           ==========================================
           PEMERIKSAAN HARI SETIAP DETIK
           ==========================================
        */

        setInterval(
            function () {

                checkDayChange();

            },
            1000
        );


        /*
           ==========================================
           INISIALISASI BACKEND BANJIR LAMA (MQTT & OPEN-METEO)
           ==========================================
        */

        updateSurabayaWeather();
        setInterval(updateSurabayaWeather, 300000); // Update cuaca per 5 menit

        if (typeof ApiService !== "undefined" && ApiService.initFloodMQTT) {
            ApiService.initFloodMQTT(
                handleFloodMQTTData,
                function (status) {
                    console.log("[Pemantauan Banjir] Status Koneksi MQTT:", status);
                }
            );
        }

        /*
           ==========================================
           MODUL RIWAYAT & EKSPOR DATA (USSC_DB)
           ==========================================
        */
        function initReportsModule() {
            const moduleSelect = document.getElementById("exportModuleSelect");
            const dateInput = document.getElementById("exportDateInput");
            const btnToday = document.getElementById("btnExportToday");
            const btnCheck = document.getElementById("btnCheckHistory");
            const btnDownload = document.getElementById("btnDownloadData");
            const banner = document.getElementById("availableDatesBanner");
            const previewArea = document.getElementById("previewContentArea");
            const previewDateLabel = document.getElementById("previewDateLabel");

            if (!dateInput || !btnCheck || !btnDownload) return;

            // Set default date ke hari ini
            const todayStr = new Date().toISOString().split("T")[0];
            dateInput.value = todayStr;

            if (btnToday) {
                btnToday.addEventListener("click", () => {
                    dateInput.value = todayStr;
                    fetchAvailableDates();
                });
            }

            // Muat tanggal yang tersedia dari DB
            async function fetchAvailableDates() {
                if (typeof ApiService === "undefined" || !ApiService.getExportDates) return;
                const mod = moduleSelect ? moduleSelect.value : "all";
                try {
                    const res = await ApiService.getExportDates(mod);
                    if (res && res.status === "success" && banner) {
                        if (res.dates && res.dates.length > 0) {
                            let chipsHtml = res.dates.slice(0, 7).map(d => `<button type="button" class="date-chip" data-date="${d}">${d}</button>`).join("");
                            banner.innerHTML = `
                                <i class="bi bi-calendar-check"></i>
                                <span>Tanggal data tersimpan di DB:</span>
                                <div class="date-chips-list">${chipsHtml}</div>
                            `;
                            banner.querySelectorAll(".date-chip").forEach(chip => {
                                chip.addEventListener("click", function() {
                                    dateInput.value = this.dataset.date;
                                    handleCheck();
                                });
                            });
                        } else {
                            banner.innerHTML = `
                                <i class="bi bi-info-circle"></i>
                                <span>Belum ada data rekaman tanggal sebelumnya di database. Data realtime tetap aktif.</span>
                            `;
                        }
                    }
                } catch (e) {
                    if (banner) {
                        banner.innerHTML = `
                            <i class="bi bi-database-check"></i>
                            <span>Koneksi ke database aktif. Silakan pilih tanggal untuk mengecek atau mengunduh.</span>
                        `;
                    }
                }
            }

            if (moduleSelect) {
                moduleSelect.addEventListener("change", fetchAvailableDates);
            }
            fetchAvailableDates();

            // Handler Cek Riwayat
            async function handleCheck() {
                const date = dateInput.value;
                const mod = moduleSelect ? moduleSelect.value : "all";
                if (!date) {
                    alert("Silakan pilih tanggal terlebih dahulu.");
                    return;
                }

                if (previewDateLabel) {
                    previewDateLabel.textContent = `Tanggal: ${date} (${mod.toUpperCase()})`;
                }

                if (previewArea) {
                    previewArea.innerHTML = `
                        <div class="empty-preview-card" style="border-style: solid;">
                            <i class="bi bi-hourglass-split" style="font-size: 32px; color: var(--primary-600); display: block; margin-bottom: 8px;"></i>
                            <h4>Memeriksa Database...</h4>
                            <p>Mengambil ringkasan data tanggal ${date}</p>
                        </div>
                    `;
                }

                try {
                    const res = await ApiService.checkExportHistory(date, mod);
                    if (res && res.status === "success" && res.summary) {
                        renderSummary(res.summary, mod, date);
                    } else {
                        throw new Error((res && res.message) || "Gagal memproses data");
                    }
                } catch (err) {
                    if (previewArea) {
                        previewArea.innerHTML = `
                            <div class="empty-preview-card" style="border-color: var(--yellow);">
                                <i class="bi bi-exclamation-triangle" style="color: var(--yellow);"></i>
                                <h4>Data Belum Tersedia atau Database Sedang Offline</h4>
                                <p>${err.message || "Tidak ditemukan catatan data untuk tanggal ini di database."}</p>
                            </div>
                        `;
                    }
                }
            }

            function renderSummary(summary, mod, date) {
                if (!previewArea) return;
                const modules = summary.modules || {};
                let html = "";

                // A. Lalu Lintas
                if (modules.traffic) {
                    const tr = modules.traffic;
                    const hasData = tr.record_count > 0;
                    html += `
                        <div class="preview-module-card">
                            <div class="preview-module-header">
                                <div class="module-title">
                                    <i class="bi bi-car-front-fill"></i>
                                    <h4>Lalu Lintas & Emisi Kendaraan</h4>
                                </div>
                                <span class="badge-data-status ${hasData ? 'badge-has-data' : 'badge-no-data'}">
                                    ${hasData ? tr.record_count + ' Catatan' : 'Tidak Ada Data'}
                                </span>
                            </div>
                            <div class="preview-metrics-grid">
                                <div class="preview-metric-box">
                                    <span>Total Kendaraan</span>
                                    <strong>${tr.total_vehicles.toLocaleString('id-ID')}</strong><small>unit</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Sepeda Motor</span>
                                    <strong>${tr.motor.toLocaleString('id-ID')}</strong><small>unit</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Mobil & Bus</span>
                                    <strong>${(tr.car + tr.bus).toLocaleString('id-ID')}</strong><small>unit</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Truk</span>
                                    <strong>${tr.truck.toLocaleString('id-ID')}</strong><small>unit</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Estimasi Emisi Karbon</span>
                                    <strong>${tr.total_emission_kg.toFixed(2)}</strong><small>kg CO₂</small>
                                </div>
                            </div>
                            <div class="preview-module-footer">
                                <a href="${ApiService.getExportDownloadUrl(date, 'traffic')}" class="btn-mini-download">
                                    <i class="bi bi-download"></i> Unduh CSV Lalu Lintas
                                </a>
                            </div>
                        </div>
                    `;
                }

                // B. Kualitas Udara
                if (modules.airquality) {
                    const aq = modules.airquality;
                    const hasData = aq.record_count > 0;
                    html += `
                        <div class="preview-module-card">
                            <div class="preview-module-header">
                                <div class="module-title">
                                    <i class="bi bi-wind"></i>
                                    <h4>Kualitas Udara (AirGradient)</h4>
                                </div>
                                <span class="badge-data-status ${hasData ? 'badge-has-data' : 'badge-no-data'}">
                                    ${hasData ? aq.record_count + ' Sampel' : 'Tidak Ada Data'}
                                </span>
                            </div>
                            <div class="preview-metrics-grid">
                                <div class="preview-metric-box">
                                    <span>Rata-rata PM2.5</span>
                                    <strong>${aq.avg_pm25 !== null ? aq.avg_pm25 : '--'}</strong><small>µg/m³</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Rata-rata CO₂</span>
                                    <strong>${aq.avg_co2 !== null ? aq.avg_co2 : '--'}</strong><small>ppm</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Suhu Rata-rata</span>
                                    <strong>${aq.avg_temp !== null ? aq.avg_temp : '--'}</strong><small>°C</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Kelembaban Rata-rata</span>
                                    <strong>${aq.avg_humidity !== null ? aq.avg_humidity : '--'}</strong><small>%</small>
                                </div>
                            </div>
                            <div class="preview-module-footer">
                                <a href="${ApiService.getExportDownloadUrl(date, 'airquality')}" class="btn-mini-download">
                                    <i class="bi bi-download"></i> Unduh CSV Kualitas Udara
                                </a>
                            </div>
                        </div>
                    `;
                }

                // C. Monitoring Banjir
                if (modules.flood) {
                    const fl = modules.flood;
                    const hasData = fl.record_count > 0;
                    html += `
                        <div class="preview-module-card">
                            <div class="preview-module-header">
                                <div class="module-title">
                                    <i class="bi bi-water"></i>
                                    <h4>Monitoring Banjir & Cuaca Mikro (ESP32)</h4>
                                </div>
                                <span class="badge-data-status ${hasData ? 'badge-has-data' : 'badge-no-data'}">
                                    ${hasData ? fl.record_count + ' Log Sensor' : 'Tidak Ada Data'}
                                </span>
                            </div>
                            <div class="preview-metrics-grid">
                                <div class="preview-metric-box">
                                    <span>Tinggi Air Maksimum</span>
                                    <strong>${fl.max_water_level_cm !== null ? fl.max_water_level_cm : '--'}</strong><small>cm</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Intensitas Hujan Maks</span>
                                    <strong>${fl.max_rain_intensity !== null ? fl.max_rain_intensity : '--'}</strong><small>mm/h</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Sensor Lidah Wetan</span>
                                    <strong>${fl.count_lidah}</strong><small>log</small>
                                </div>
                                <div class="preview-metric-box">
                                    <span>Sensor Ketintang</span>
                                    <strong>${fl.count_ketintang}</strong><small>log</small>
                                </div>
                            </div>
                            <div class="preview-module-footer">
                                <a href="${ApiService.getExportDownloadUrl(date, 'flood')}" class="btn-mini-download">
                                    <i class="bi bi-download"></i> Unduh CSV Sensor Banjir
                                </a>
                            </div>
                        </div>
                    `;
                }

                if (!html) {
                    html = `
                        <div class="empty-preview-card">
                            <i class="bi bi-inbox"></i>
                            <h4>Tidak Ada Data</h4>
                            <p>Tidak ditemukan rekaman data pada tanggal ${date}.</p>
                        </div>
                    `;
                }

                previewArea.innerHTML = html;
            }

            btnCheck.addEventListener("click", handleCheck);

            // Handler Download Data
            btnDownload.addEventListener("click", () => {
                const date = dateInput.value;
                const mod = moduleSelect ? moduleSelect.value : "all";
                if (!date) {
                    alert("Silakan pilih tanggal terlebih dahulu.");
                    return;
                }
                const url = ApiService.getExportDownloadUrl(date, mod);
                window.location.href = url;
            });
        }

        initReportsModule();


        /*
           ==========================================
           DEBUG
           ==========================================
        */

        console.log(
            "Sistem monitoring aktif."
        );

        console.log(
            "Update sensor & grafik: setiap 2 detik."
        );

        console.log(
            "Update histori: setiap menit tepat."
        );

    }
);