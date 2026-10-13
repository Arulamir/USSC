"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import MainLayout from "../components/layout/MainLayout";
import "./digital.css";


// ============================================================
// TYPES
// ============================================================

type Vehicle = {
    id: string | number;

    lat?: number | string;
    latitude?: number | string;

    lon?: number | string;
    lng?: number | string;
    longitude?: number | string;

    type?: string;
    class?: string;
    class_name?: string;
    vehicle_type?: string;

    speed?: number | string;
    heading?: number | string;
};

type CameraData = {
    camera_id?: string;
    timestamp?: string;
    vehicles?: Vehicle[];
};

type DigitalTwinResponse = {
    status?: string;
    data?: Record<string, CameraData>;
    message?: string;
};

type VehicleStats = {
    motor: number;
    car: number;
    bus: number;
    truck: number;
    total: number;
};

type TrafficTableRow = {
  timestamp: string;
  motor: number;
  mobil: number;
  bus: number;
  truck: number;
  total: number;
};

type LeafletModule = typeof import("leaflet");


// ============================================================
// CAMERA CONFIGURATION
// ============================================================

const CAMERA_ID = "CAMERA_01";
const CAMERA_NAME = "Unesa";
const CAMERA_LAT = -7.3011205;
const CAMERA_LON = 112.6725244;
const CAMERA_ZOOM = 19;
const API_URL = "/api/digital-twin";
const REFRESH_INTERVAL = 2000;

// ============================================================
// VEHICLE HELPER
// ============================================================

function getVehicleType(vehicle: Vehicle): string {
    return String(
        vehicle.type ??
        vehicle.class ??
        vehicle.class_name ??
        vehicle.vehicle_type ??
        "car"
    ).toLowerCase();
}


function getVehicleName(vehicle: Vehicle): string {
    const type = getVehicleType(vehicle);

    if (
        type === "motor" ||
        type === "motorcycle" ||
        type === "motorbike"
    ) {
        return "Motor";
    }

    if (type === "bus") {
        return "Bus";
    }

    if (
        type === "truck" ||
        type === "truk"
    ) {
        return "Truk";
    }

    return "Mobil";
}


function getVehicleEmoji(vehicle: Vehicle): string {
    const type = getVehicleType(vehicle);

    if (
        type === "motor" ||
        type === "motorcycle" ||
        type === "motorbike"
    ) {
        return "🏍";
    }

    if (type === "bus") {
        return "🚌";
    }

    if (
        type === "truck" ||
        type === "truk"
    ) {
        return "🚛";
    }

    return "🚗";
}


function getVehicleLat(vehicle: Vehicle): number {
    return Number(
        vehicle.lat ??
        vehicle.latitude
    );
}


function getVehicleLon(vehicle: Vehicle): number {
    return Number(
        vehicle.lon ??
        vehicle.lng ??
        vehicle.longitude
    );
}


function getVehicleSpeed(vehicle: Vehicle): number {
    const value = Number(
        vehicle.speed ?? 0
    );

    return Number.isFinite(value)
        ? value
        : 0;
}


function getVehicleHeading(vehicle: Vehicle): number {
    const value = Number(
        vehicle.heading ?? 0
    );

    return Number.isFinite(value)
        ? value
        : 0;
}


// ============================================================
// STATISTICS
// ============================================================

function calculateStatistics(
    vehicles: Vehicle[]
): VehicleStats {

    let motor = 0;
    let car = 0;
    let bus = 0;
    let truck = 0;

    vehicles.forEach((vehicle) => {

        const type =
            getVehicleType(vehicle);

        if (
            type === "motor" ||
            type === "motorcycle" ||
            type === "motorbike"
        ) {
            motor++;
        }

        else if (type === "bus") {
            bus++;
        }

        else if (
            type === "truck" ||
            type === "truk"
        ) {
            truck++;
        }

        else {
            car++;
        }
    });

    return {
        motor,
        car,
        bus,
        truck,
        total:
            motor +
            car +
            bus +
            truck,
    };
}


// ============================================================
// TIME FORMAT
// ============================================================

function formatTime(
    dateString?: string
): string {

    if (!dateString) {
        return "-";
    }

    const date =
        new Date(dateString);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "-";
    }

    return date.toLocaleTimeString(
        "id-ID",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        }
    );
}

// function downloadCSV(
//   data: TrafficTableRow[],
//   filename: string
// ) {
//   if (!data || data.length === 0) return;

//   const headers = [
//     "No",
//     "Waktu",
//     "Motor",
//     "Mobil",
//     "Bus",
//     "Truk",
//     "Total",
//   ];

//   const csvRows = [
//     headers.join(","),
//     ...data.map((row, index) =>
//       [
//         index + 1,
//         formatTimestampAMPM(row.timestamp),
//         row.motor,
//         row.mobil,
//         row.bus,
//         row.truck,
//         row.total,
//       ]
//         .map((value) => {
//           const escaped = String(value ?? "")
//             .replace(/"/g, '""');

//           return `"${escaped}"`;
//         })
//         .join(",")
//     ),
//   ];

//   // BOM agar karakter terbaca dengan benar di Excel
//   const csvContent =
//     "\uFEFF" + csvRows.join("\r\n");

//   const blob = new Blob(
//     [csvContent],
//     { type: "text/csv;charset=utf-8;" }
//   );

//   const url = URL.createObjectURL(blob);
//   const link = document.createElement("a");

//   link.href = url;
//   link.download = filename;

//   document.body.appendChild(link);
//   link.click();
//   document.body.removeChild(link);

//   URL.revokeObjectURL(url);
// }


// ============================================================
// PAGE
// ============================================================

export default function DigitalTwinPage() {

    // ========================================================
    // MAP REFS
    // ========================================================

    const mapRef =
        useRef<any>(null);

    const leafletRef =
        useRef<LeafletModule | null>(
            null
        );

    const streetLayerRef =
        useRef<any>(null);

    const satelliteLayerRef =
        useRef<any>(null);

    const cameraMarkerRef =
        useRef<any>(null);

    const vehicleMarkersRef =
        useRef<Record<string, any>>(
            {}
        );


    // ========================================================
    // STATE
    // ========================================================

    const [vehicles, setVehicles] =
        useState<Vehicle[]>([]);

    const [cameraId, setCameraId] =
        useState(CAMERA_ID);

    const [serverTimestamp, setServerTimestamp] =
        useState<string | undefined>();

    const [lastUpdate, setLastUpdate] =
        useState("-");

    const [isOnline, setIsOnline] =
        useState(true);

    const [satelliteVisible, setSatelliteVisible] =
        useState(false);

    const [trafficVisible, setTrafficVisible] =
        useState(false);

    const [vehicleVisible, setVehicleVisible] =
        useState(true);

    const [mapReady, setMapReady] =
        useState(false);

    const [mapError, setMapError] =
        useState("");


    // ========================================================
    // STATISTICS
    // ========================================================

    const stats = useMemo(() =>calculateStatistics(vehicles),[vehicles]);
    const percentages = useMemo(() => {if (stats.total <= 0) {
            return {motor: 0, car: 0, bus: 0,truck: 0,};}
            return {
                motor: Math.round(
                    (stats.motor /
                        stats.total) *
                        100
                ),

                car: Math.round(
                    (stats.car /
                        stats.total) *
                        100
                ),

                bus: Math.round(
                    (stats.bus /
                        stats.total) *
                        100
                ),

                truck: Math.round(
                    (stats.truck /
                        stats.total) *
                        100
                ),};}, [stats]);


    // ========================================================
    // INITIALIZE LEAFLET
    // ========================================================

    useEffect(() => {
        let cancelled = false;
        let resizeObserver:
            ResizeObserver | null = null;
        async function initializeMap() {
            try {const L = await import("leaflet");
                if (cancelled) {return;}
                leafletRef.current = L;
                // =================================================
                // CREATE MAP
                // =================================================

                const map =L.map("digital-twin-map",
                        {
                            zoomControl: false,
                            attributionControl:
                                false,
                        });
                mapRef.current = map;
                // =================================================
                // INITIAL CAMERA VIEW
                // =================================================

                map.setView(
                    [
                        CAMERA_LAT,
                        CAMERA_LON,
                    ],
                    CAMERA_ZOOM
                );


                // =================================================
                // MAP CONTAINER
                // =================================================

                const mapContainer =
                    document.getElementById(
                        "digital-twin-map"
                    );


                // =================================================
                // RESIZE OBSERVER
                // =================================================

                if (mapContainer) {

                    resizeObserver =
                        new ResizeObserver(
                            () => {

                                if (
                                    cancelled
                                ) {
                                    return;
                                }

                                map.invalidateSize(
                                    {
                                        animate:
                                            false,
                                    }
                                );
                            }
                        );


                    resizeObserver.observe(
                        mapContainer
                    );
                }
                // =================================================
                // ZOOM CONTROL
                // =================================================

                L.control
                    .zoom({
                        position:
                            "bottomright",
                    })
                    .addTo(map);


                // =================================================
                // STREET LAYER
                // =================================================

                const streetLayer =
                    L.tileLayer(
                        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                        {
                            maxZoom: 24,
                        }
                    );
                streetLayerRef.current =
                    streetLayer;
                streetLayer.addTo(map);


                // =================================================
                // SATELLITE LAYER
                // =================================================

                // const satelliteLayer =
                //     L.tileLayer(
                //         "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                //         {
                //             maxZoom: 24,
                //             maxNativeZoom: 22,

                //             attribution:
                //                 "Tiles &copy; Esri",
                //         }
                //     );
                
                const satelliteLayer = L.tileLayer(
                    "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
                    {
                        maxZoom: 24,
                        maxNativeZoom: 22,
                        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
                    }
                )

                satelliteLayerRef.current =
                    satelliteLayer;


                // =================================================
                // CAMERA ICON
                // =================================================

                const cameraIcon =
                    L.divIcon({

                        className:
                            "digital-camera-marker",

                        html: `
                            <div class="digital-camera-pulse">
                                📷
                            </div>
                        `,

                        iconSize: [
                            42,
                            42,
                        ],

                        iconAnchor: [
                            21,
                            21,
                        ],
                    });


                // =================================================
                // CAMERA MARKER
                // =================================================

                const cameraMarker =
                    L.marker(
                        [
                            CAMERA_LAT,
                            CAMERA_LON,
                        ],
                        {
                            icon:
                                cameraIcon,
                        }
                    ).addTo(map);


                cameraMarkerRef.current =
                    cameraMarker;


                // =================================================
                // CAMERA POPUP
                // =================================================

                cameraMarker.bindPopup(`
                    <div class="digital-popup-camera">

                        <div class="digital-popup-title">
                            ${CAMERA_ID}
                        </div>

                        <div class="digital-popup-camera-name">
                            ${CAMERA_NAME}
                        </div>

                        <div class="digital-popup-coordinate">
                            Latitude:
                            ${CAMERA_LAT.toFixed(6)}
                        </div>

                        <div class="digital-popup-coordinate">
                            Longitude:
                            ${CAMERA_LON.toFixed(6)}
                        </div>

                        <div class="digital-popup-online">
                            ● ONLINE
                        </div>

                    </div>
                `);


                // =================================================
                // MAP READY
                // =================================================

                setMapReady(true);


                // =================================================
                // IMPORTANT:
                // FORCE LEAFLET TO RECALCULATE SIZE
                // =================================================

                requestAnimationFrame(() => {

                    if (cancelled) {
                        return;
                    }

                    map.invalidateSize({
                        animate: false,
                    });

                    map.setView(
                        [
                            CAMERA_LAT,
                            CAMERA_LON,
                        ],
                        CAMERA_ZOOM,
                        {
                            animate: false,
                        }
                    );
                });


                // =================================================
                // SECOND REFRESH
                // =================================================

                window.setTimeout(() => {

                    if (!cancelled) {

                        map.invalidateSize({
                            animate: false,
                        });
                    }

                }, 100);


                // =================================================
                // THIRD REFRESH
                // =================================================

                window.setTimeout(() => {

                    if (!cancelled) {

                        map.invalidateSize({
                            animate: false,
                        });
                    }

                }, 500);


                // =================================================
                // FINAL REFRESH
                // =================================================

                window.setTimeout(() => {

                    if (!cancelled) {

                        map.invalidateSize({
                            animate: false,
                        });
                    }

                }, 1000);


            } catch (error) {

                console.error(
                    "[DIGITAL TWIN] Leaflet error:",
                    error
                );

                setMapError(
                    "Leaflet gagal dimuat."
                );
            }
        }


        initializeMap();


        // ========================================================
        // CLEANUP
        // ========================================================

        return () => {

            cancelled = true;


            if (resizeObserver) {

                resizeObserver.disconnect();

                resizeObserver = null;
            }


            if (mapRef.current) {

                mapRef.current.remove();

                mapRef.current = null;
            }


            vehicleMarkersRef.current = {};

            cameraMarkerRef.current =
                null;

            streetLayerRef.current =
                null;

            satelliteLayerRef.current =
                null;

            leafletRef.current =
                null;

            setMapReady(false);
        };

    }, []);


    // ============================================================
    // CREATE VEHICLE ICON
    // ============================================================

    const createVehicleIcon =
        useCallback(
            (
                vehicle: Vehicle
            ) => {

                const L =
                    leafletRef.current;


                if (!L) {
                    return null;
                }


                const emoji =
                    getVehicleEmoji(
                        vehicle
                    );


                const heading =
                    getVehicleHeading(
                        vehicle
                    );


                return L.divIcon({

                    className:
                        "digital-vehicle-marker",

                    html: `
                        <div
                            class="digital-vehicle-icon"
                            style="
                                transform:
                                    rotate(${heading}deg);
                            "
                        >
                            ${emoji}
                        </div>
                    `,

                    iconSize: [
                        40,
                        40,
                    ],

                    iconAnchor: [
                        20,
                        20,
                    ],
                });
            },
            []
        );


    // ============================================================
    // UPDATE VEHICLE MARKERS
    // ============================================================

    const updateVehicleMarkers =
        useCallback(
            (
                currentVehicles:
                    Vehicle[]
            ) => {

                const L =
                    leafletRef.current;

                const map =
                    mapRef.current;


                if (!L || !map) {
                    return;
                }


                const activeIds =
                    new Set<string>();


                currentVehicles.forEach(
                    (vehicle) => {

                        if (
                            vehicle.id ===
                                undefined ||
                            vehicle.id ===
                                null
                        ) {

                            console.warn(
                                "[DIGITAL TWIN] Vehicle tanpa ID:",
                                vehicle
                            );

                            return;
                        }


                        const id =
                            String(
                                vehicle.id
                            );


                        const lat =
                            getVehicleLat(
                                vehicle
                            );


                        const lon =
                            getVehicleLon(
                                vehicle
                            );


                        if (
                            !Number.isFinite(
                                lat
                            ) ||
                            !Number.isFinite(
                                lon
                            )
                        ) {

                            console.warn(
                                "[DIGITAL TWIN] Koordinat kendaraan tidak valid:",
                                vehicle
                            );

                            return;
                        }


                        activeIds.add(id);


                        const type =
                            getVehicleName(
                                vehicle
                            );


                        const speed =
                            getVehicleSpeed(
                                vehicle
                            );


                        const heading =
                            getVehicleHeading(
                                vehicle
                            );


                        // =========================================
                        // POPUP
                        // =========================================

                        const popup = `
                            <div class="digital-vehicle-popup">

                                <div class="digital-popup-title">
                                    ${getVehicleEmoji(vehicle)}
                                    ${type}
                                </div>

                                <div class="digital-popup-row">
                                    <span>ID</span>
                                    <strong>
                                        ${id}
                                    </strong>
                                </div>

                                <div class="digital-popup-row">
                                    <span>Latitude</span>
                                    <strong>
                                        ${lat.toFixed(6)}
                                    </strong>
                                </div>

                                <div class="digital-popup-row">
                                    <span>Longitude</span>
                                    <strong>
                                        ${lon.toFixed(6)}
                                    </strong>
                                </div>

                                <div class="digital-popup-row">
                                    <span>Kecepatan</span>
                                    <strong>
                                        ${speed.toFixed(1)} km/h
                                    </strong>
                                </div>

                                <div class="digital-popup-row">
                                    <span>Arah</span>
                                    <strong>
                                        ${heading.toFixed(0)}°
                                    </strong>
                                </div>

                                <div class="digital-popup-row">
                                    <span>Status</span>
                                    <strong class="digital-vehicle-active">
                                        ● AKTIF
                                    </strong>
                                </div>

                            </div>
                        `;


                        const icon =
                            createVehicleIcon(
                                vehicle
                            );


                        const existing =
                            vehicleMarkersRef
                                .current[id];


                        // =========================================
                        // UPDATE MARKER LAMA
                        // =========================================

                        if (existing) {

                            existing.setLatLng(
                                [
                                    lat,
                                    lon,
                                ]
                            );


                            if (icon) {

                                existing.setIcon(
                                    icon
                                );
                            }


                            existing.setPopupContent(
                                popup
                            );


                            if (
                                vehicleVisible
                            ) {

                                if (
                                    !map.hasLayer(
                                        existing
                                    )
                                ) {

                                    existing.addTo(
                                        map
                                    );
                                }

                            } else {

                                if (
                                    map.hasLayer(
                                        existing
                                    )
                                ) {

                                    map.removeLayer(
                                        existing
                                    );
                                }
                            }


                            return;
                        }


                        // =========================================
                        // MARKER BARU
                        // =========================================

                        if (!icon) {
                            return;
                        }


                        const marker =
                            L.marker(
                                [
                                    lat,
                                    lon,
                                ],
                                {
                                    icon,
                                }
                            );


                        marker.bindPopup(
                            popup
                        );


                        if (
                            vehicleVisible
                        ) {

                            marker.addTo(
                                map
                            );
                        }


                        vehicleMarkersRef
                            .current[id] =
                            marker;


                        console.log(
                            "[DIGITAL TWIN] Vehicle baru:",
                            id,
                            type,
                            lat,
                            lon
                        );
                    }
                );


                // ================================================
                // REMOVE VEHICLES YANG SUDAH TIDAK ADA
                // ================================================

                Object.keys(
                    vehicleMarkersRef
                        .current
                ).forEach(
                    (id) => {

                        if (
                            !activeIds.has(
                                id
                            )
                        ) {

                            const marker =
                                vehicleMarkersRef
                                    .current[id];


                            if (
                                marker &&
                                map.hasLayer(
                                    marker
                                )
                            ) {

                                map.removeLayer(
                                    marker
                                );
                            }


                            delete vehicleMarkersRef
                                .current[id];


                            console.log(
                                "[DIGITAL TWIN] Vehicle keluar:",
                                id
                            );
                        }
                    }
                );
            },
            [
                createVehicleIcon,
                vehicleVisible,
            ]
        );


    
    // ============================================================
    // LOAD DIGITAL TWIN API
    // ============================================================

    const fetchDigitalTwin = useCallback(
        async () => {
            try {
                const response = await fetch(API_URL, {
                    method: "GET",
                    cache: "no-store",
                    headers: {
                        Accept: "application/json",
                    },
                });

                console.log("[DIGITAL TWIN HTTP]", {
                    url: API_URL,
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok,
                });

                const responseText =
                    await response.text();

                console.log(
                    "[DIGITAL TWIN RESPONSE]",
                    responseText
                );

                if (!response.ok) {
                    const errorMessage =
                        "HTTP " +
                        response.status +
                        ": " +
                        (responseText ||
                            response.statusText);

                    throw new Error(errorMessage);
                }

                let result: DigitalTwinResponse;

                try {
                    result =
                        JSON.parse(
                            responseText
                        ) as DigitalTwinResponse;
                } catch {
                    throw new Error(
                        "Respons API bukan JSON yang valid: " +
                            responseText
                    );
                }

                console.log(
                    "[DIGITAL TWIN API]",
                    result
                );

                if (
                    result.status !==
                    "success"
                ) {
                    throw new Error(
                        result.message ??
                            `API status tidak sesuai: ${
                                result.status ??
                                "undefined"
                            }`
                    );
                }

                // ================================================
                // DATA SELURUH KAMERA
                // ================================================

                const cameras =
                    result.data ?? {};

                // ================================================
                // DATA CAMERA YANG DIGUNAKAN
                // ================================================

                const cameraData =
                    cameras[CAMERA_ID];

                // ================================================
                // CAMERA TIDAK DITEMUKAN
                // ================================================

                if (!cameraData) {
                    console.warn(
                        "[DIGITAL TWIN] Data kamera tidak ditemukan:",
                        CAMERA_ID
                    );

                    setVehicles([]);
                    setCameraId(
                        CAMERA_ID
                    );
                    setServerTimestamp(
                        undefined
                    );

                    updateVehicleMarkers(
                        []
                    );

                    setIsOnline(false);
                    setLastUpdate(
                        formatTime()
                    );

                    return;
                }

                // ================================================
                // VEHICLES
                // ================================================

                const receivedVehicles =
                    Array.isArray(
                        cameraData.vehicles
                    )
                        ? cameraData.vehicles
                        : [];

                // ================================================
                // UPDATE CAMERA
                // ================================================

                setCameraId(
                    cameraData.camera_id ??
                        CAMERA_ID
                );

                setServerTimestamp(
                    cameraData.timestamp
                );

                // ================================================
                // UPDATE VEHICLES
                // ================================================

                setVehicles(
                    receivedVehicles
                );

                // ================================================
                // UPDATE MAP MARKERS
                // ================================================

                updateVehicleMarkers(
                    receivedVehicles
                );

                // ================================================
                // ONLINE
                // ================================================

                setIsOnline(true);

                setLastUpdate(
                    formatTime()
                );

                console.log(
                    "[DIGITAL TWIN] Data berhasil diperbarui:",
                    receivedVehicles.length,
                    "kendaraan"
                );

            } catch (error) {
                console.error(
                    "[DIGITAL TWIN ERROR]",
                    error
                );

                setIsOnline(false);

                setLastUpdate(
                    formatTime()
                );
            }
        },
        [
            updateVehicleMarkers,
        ]
    );


    // ============================================================
    // POLLING
    // ============================================================

    useEffect(() => {
        if (!mapReady) {
            return;
        }

        // Request pertama
        fetchDigitalTwin();

        // Request berikutnya setiap 2 detik
        const interval =
            window.setInterval(() => {
                fetchDigitalTwin();
            }, REFRESH_INTERVAL);

        return () => {
            window.clearInterval(
                interval
            );
        };
    }, [
        mapReady,
        fetchDigitalTwin,
    ]);



    // ============================================================
    // VEHICLE VISIBILITY
    // ============================================================

    useEffect(() => {

        const map =
            mapRef.current;


        if (!map) {
            return;
        }


        Object.values(
            vehicleMarkersRef.current
        ).forEach(
            (marker) => {

                if (
                    vehicleVisible
                ) {

                    if (
                        !map.hasLayer(
                            marker
                        )
                    ) {

                        marker.addTo(
                            map
                        );
                    }

                } else {

                    if (
                        map.hasLayer(
                            marker
                        )
                    ) {

                        map.removeLayer(
                            marker
                        );
                    }
                }
            }
        );

    }, [
        vehicleVisible,
    ]);


    // ============================================================
    // SATELLITE TOGGLE
    // ============================================================

    function toggleSatellite() {

        const map =
            mapRef.current;

        const street =
            streetLayerRef.current;

        const satellite =
            satelliteLayerRef.current;


        if (
            !map ||
            !street ||
            !satellite
        ) {
            return;
        }


        if (
            satelliteVisible
        ) {

            map.removeLayer(
                satellite
            );

            street.addTo(map);

            setSatelliteVisible(
                false
            );

        } else {

            map.removeLayer(
                street
            );

            satellite.addTo(map);

            setSatelliteVisible(
                true
            );
        }


        // Recalculate map
        window.setTimeout(() => {

            map.invalidateSize({
                animate: false,
            });

        }, 100);
    }


    // ============================================================
    // TRAFFIC TOGGLE
    // ============================================================

    function toggleTraffic() {

        setTrafficVisible(
            (current) =>
                !current
        );
    }


    // ============================================================
    // VEHICLE TOGGLE
    // ============================================================

    function toggleVehicles() {

        setVehicleVisible(
            (current) =>
                !current
        );
    }


    // ============================================================
    // CENTER MAP
    // ============================================================

    function centerMap() {

        const map =
            mapRef.current;


        if (!map) {
            return;
        }


        map.flyTo(
            [
                CAMERA_LAT,
                CAMERA_LON,
            ],
            CAMERA_ZOOM,
            {
                duration: 1,
            }
        );
    }


    // ============================================================
    // RENDER
    // ============================================================

    return (
        <MainLayout>

            <div className="digital-twin-page">

                {/* ==================================================
                     HEADER
                ================================================== */}

                <div className="page-heading">
                  <div>
                    <span className="eyebrow">KENDARAAN</span>
                    <h2>Pemantauan Kendaraa</h2>
                    <p>Visualisasi kendaraan secara realtime di peta kampus.</p>
                  </div>
                  <div className="location-badge">
                    <i className="bi bi-pin-map-fill"></i> Live Map
                  </div>
                </div>


                {/* ==================================================
                     STATISTICS
                ================================================== */}

                <section className="digital-stats">

                    <div className="digital-stat-card">

                        <div className="digital-stat-icon total">
                            🚗
                        </div>

                        <div>

                            <span>
                                Total Kendaraan
                            </span>

                            <strong>
                                {stats.total}
                            </strong>

                        </div>

                    </div>


                    <div className="digital-stat-card">

                        <div className="digital-stat-icon motor">
                            🏍
                        </div>

                        <div>

                            <span>
                                Motor
                            </span>

                            <strong>
                                {stats.motor}
                            </strong>

                        </div>

                    </div>


                    <div className="digital-stat-card">

                        <div className="digital-stat-icon car">
                            🚗
                        </div>

                        <div>

                            <span>
                                Mobil
                            </span>

                            <strong>
                                {stats.car}
                            </strong>

                        </div>

                    </div>


                    <div className="digital-stat-card">

                        <div className="digital-stat-icon bus">
                            🚌
                        </div>

                        <div>

                            <span>
                                Bus
                            </span>

                            <strong>
                                {stats.bus}
                            </strong>

                        </div>

                    </div>


                    <div className="digital-stat-card">

                        <div className="digital-stat-icon truck">
                            🚛
                        </div>

                        <div>

                            <span>
                                Truk
                            </span>

                            <strong>
                                {stats.truck}
                            </strong>

                        </div>

                    </div>

                </section>


                {/* ==================================================
                     DIGITAL TWIN MAP
                ================================================== */}

                <section className="digital-area">

                    {/* =================================================
                         MAP HEADER
                    ================================================= */}

                    <div className="digital-map-header">

                        {/* LEFT */}
                        <div className="digital-map-title">

                            <h2>
                                Peta Monitoring kendaraan
                            </h2>

                            
                        </div>


                        {/* CENTER */}
                        <div className="digital-map-tools">

                            <button
                                type="button"
                                className={
                                    satelliteVisible
                                        ? "active"
                                        : ""
                                }
                                onClick={
                                    toggleSatellite
                                }
                            >
                                🛰 Satelit
                            </button>


                            <button
                                type="button"
                                className={
                                    trafficVisible
                                        ? "active"
                                        : ""
                                }
                                onClick={
                                    toggleTraffic
                                }
                            >
                                🚦 Traffic
                            </button>


                            <button
                                type="button"
                                className={
                                    vehicleVisible
                                        ? "active"
                                        : ""
                                }
                                onClick={
                                    toggleVehicles
                                }
                            >
                                🚘 Kendaraan
                            </button>

                        </div>


                        {/* RIGHT */}
                        <div className="digital-header-right">

                            <div className="digital-last-update">

                                <span
                                    className={
                                        isOnline
                                            ? "digital-status-green"
                                            : "digital-status-red"
                                    }
                                >
                                    ●
                                </span>


                                <div>

                                    <small>
                                        Last Update
                                    </small>

                                    <strong>
                                        {lastUpdate}
                                    </strong>

                                </div>

                            </div>


                            <button
                                type="button"
                                className="digital-map-control"
                                onClick={
                                    centerMap
                                }
                                title="Kembali ke posisi kamera"
                            >
                                ⌖
                            </button>

                        </div>

                    </div>


                    {/* =================================================
                         MAP
                    ================================================= */}

                    <div
                        id="digital-twin-map"
                        className="digital-map"
                    />


                    {/* =================================================
                         MAP ERROR
                    ================================================= */}

                    {mapError && (

                        <div className="digital-map-error">
                            {mapError}
                        </div>

                    )}


                    {/* =================================================
                         LEGEND
                    ================================================= */}

                    <div className="digital-map-legend">

                        <div className="digital-legend-title">
                            Kendaraan
                        </div>


                        <div className="digital-legend-item">
                            <span>🏍</span>
                            Motor
                        </div>


                        <div className="digital-legend-item">
                            <span>🚗</span>
                            Mobil
                        </div>


                        <div className="digital-legend-item">
                            <span>🚌</span>
                            Bus
                        </div>


                        <div className="digital-legend-item">
                            <span>🚛</span>
                            Truk
                        </div>

                    </div>


                    {/* =================================================
                         LIVE
                    ================================================= */}

                    <div className="digital-live-indicator">

                        <span
                            className={
                                isOnline
                                    ? ""
                                    : "offline"
                            }
                        />


                        <div>

                            <strong>
                                {isOnline
                                    ? "LIVE"
                                    : "OFFLINE"}
                            </strong>


                            <small>
                                {isOnline
                                    }
                            </small>

                        </div>

                    </div>


                </section>


                {/* ==================================================
                     INFORMATION
                ================================================== */}

                <section className="digital-bottom-grid">

                    {/* =================================================
                         CAMERA INFORMATION
                    ================================================= */}

                    <div className="digital-info-card">

                        <div className="digital-card-header">

                            <div>

                                <h3>
                                    Camera Information
                                </h3>

                               

                            </div>


                            <span className="digital-online-badge">

                                {isOnline
                                    ? "ONLINE"
                                    : "OFFLINE"}

                            </span>

                        </div>


                        <div className="digital-camera-info-grid">

                            <div>

                                <small>
                                    Camera ID
                                </small>

                                <strong>
                                    {cameraId}
                                </strong>

                            </div>


                            <div>

                                <small>
                                    Location
                                </small>

                                <strong>
                                    {CAMERA_NAME}
                                </strong>

                            </div>


                            <div>

                                <small>
                                    Latitude
                                </small>

                                <strong>
                                    {CAMERA_LAT.toFixed(6)}
                                </strong>

                            </div>


                            <div>

                                <small>
                                    Longitude
                                </small>

                                <strong>
                                    {CAMERA_LON.toFixed(6)}
                                </strong>

                            </div>

                        </div>

                    </div>


                    {/* =================================================
                         VEHICLE STATUS
                    ================================================= */}

                    <div className="digital-info-card">

                        <div className="digital-card-header">

                            <div>

                                <h3>
                                    Vehicle Status
                                </h3>

                                <span>
                                    Komposisi kendaraan aktif
                                </span>

                            </div>


                            <span className="digital-vehicle-count">

                                {stats.total} kendaraan

                            </span>

                        </div>


                        <div className="digital-status-list">

                            {/* MOTOR */}

                            <div className="digital-status-row">

                                <span className="digital-vehicle-name">
                                    🏍 Motor
                                </span>


                                <div className="digital-status-bar">

                                    <div
                                        className="digital-status-fill motor-fill"
                                        style={{
                                            width:
                                                `${percentages.motor}%`,
                                        }}
                                    />

                                </div>


                                <strong>
                                    {percentages.motor}%
                                </strong>

                            </div>


                            {/* MOBIL */}

                            <div className="digital-status-row">

                                <span className="digital-vehicle-name">
                                    🚗 Mobil
                                </span>


                                <div className="digital-status-bar">

                                    <div
                                        className="digital-status-fill car-fill"
                                        style={{
                                            width:
                                                `${percentages.car}%`,
                                        }}
                                    />

                                </div>


                                <strong>
                                    {percentages.car}%
                                </strong>

                            </div>


                            {/* BUS */}

                            <div className="digital-status-row">

                                <span className="digital-vehicle-name">
                                    🚌 Bus
                                </span>


                                <div className="digital-status-bar">

                                    <div
                                        className="digital-status-fill bus-fill"
                                        style={{
                                            width:
                                                `${percentages.bus}%`,
                                        }}
                                    />

                                </div>


                                <strong>
                                    {percentages.bus}%
                                </strong>

                            </div>


                            {/* TRUK */}

                            <div className="digital-status-row">

                                <span className="digital-vehicle-name">
                                    🚛 Truk
                                </span>


                                <div className="digital-status-bar">

                                    <div
                                        className="digital-status-fill truck-fill"
                                        style={{
                                            width:
                                                `${percentages.truck}%`,
                                        }}
                                    />

                                </div>


                                <strong>
                                    {percentages.truck}%
                                </strong>

                            </div>

                        </div>

                    </div>

                </section>
                
                {/* =================================================
                            VEHICLE TABLE
                    ================================================= */}

                {/* <section className="traffic-card traffic-table-card">

                    <div className="traffic-card-header traffic-table-header">
                    <div>
                        <i className="bi bi-car-front traffic-icon-spacing"></i>
                        Riwayat Kendaraan
                    </div>

                    <button
                        type="button"
                        className="traffic-btn traffic-btn-success"
                        onClick={() =>
                        downloadCSV(
                            vehicleTable,
                            `vehicle-${selectedDate}.csv`
                        )
                        }
                        disabled={
                        loadingData ||
                        vehicleTable.length === 0
                        }
                    >
                        <i className="bi bi-download traffic-icon-spacing"></i>
                        Download CSV
                    </button>
                    </div>

                    <div className="traffic-card-body">

                    <div className="traffic-table-wrapper">

                        <table className="traffic-table">

                        <thead>
                            <tr>
                            <th>No</th>
                            <th>Waktu</th>
                            <th>Motor</th>
                            <th>Mobil</th>
                            <th>Bus</th>
                            <th>Truk</th>
                            <th>Total</th>
                            </tr>
                        </thead>

                        <tbody>

                            {vehiclePaginatedData.length > 0 ? (
                            vehiclePaginatedData.map(
                                (item, index) => (
                                <tr
                                    key={`${item.timestamp}-${index}`}
                                >
                                    <td>
                                    {vehicleStartIndex +
                                        index +
                                        1}
                                    </td>

                                    <td>
                                    {formatTimestampAMPM(
                                        item.timestamp
                                    )}
                                    </td>

                                    <td>{item.motor}</td>
                                    <td>{item.mobil}</td>
                                    <td>{item.bus}</td>
                                    <td>{item.truck}</td>
                                    <td>{item.total}</td>
                                </tr>
                                )
                            )
                            ) : (
                            <tr>
                                <td
                                colSpan={7}
                                className="traffic-empty"
                                >
                                Tidak ada data
                                </td>
                            </tr>
                            )}

                        </tbody>

                        </table>

                    </div>

                    {vehicleTotalPages > 1 && (
                        <div className="traffic-pagination">

                        <div className="traffic-pagination-buttons">

                            <button
                            type="button"
                            disabled={
                                vehiclePage === 1
                            }
                            onClick={() =>
                                setVehiclePage(
                                (page) =>
                                    page - 1
                                )
                            }
                            >
                            ‹
                            </button>

                            {Array.from(
                            {
                                length:
                                vehicleTotalPages,
                            },
                            (_, index) =>
                                index + 1
                            ).map((page) => (
                            <button
                                type="button"
                                key={page}
                                className={
                                vehiclePage === page
                                    ? "active"
                                    : ""
                                }
                                onClick={() =>
                                setVehiclePage(
                                    page
                                )
                                }
                            >
                                {page}
                            </button>
                            ))}

                            <button
                            type="button"
                            disabled={
                                vehiclePage ===
                                vehicleTotalPages
                            }
                            onClick={() =>
                                setVehiclePage(
                                (page) =>
                                    page + 1
                                )
                            }
                            >
                            ›
                            </button>

                        </div>

                        </div>
                    )}

                    </div>

                </section> 
                */}

                {/* =================================================
                    EMISSION TABLE
                ================================================= */}
                {/*
                <section className="traffic-card traffic-table-card">
                    <div className="traffic-card-header traffic-table-header">
                    <div>
                        🌫️ Riwayat Emisi Kendaraan
                    </div>

                    <button
                        type="button"
                        className="traffic-btn traffic-btn-success"
                        onClick={() =>
                        downloadCSV(
                            emissionTable,
                            `emission-${selectedDate}.csv`
                        )
                        }
                        disabled={
                        loadingData ||
                        emissionTable.length === 0
                        }
                    >
                        <i className="bi bi-download traffic-icon-spacing"></i>
                        Download CSV
                    </button>
                    </div>


                    <div className="traffic-card-body">

                    <div className="traffic-table-wrapper">

                        <table className="traffic-table">

                        <thead>
                            <tr>
                            <th>No</th>
                            <th>Waktu</th>
                            <th>Motor</th>
                            <th>Mobil</th>
                            <th>Bus</th>
                            <th>Truk</th>
                            <th>Total</th>
                            </tr>
                        </thead>

                        <tbody>

                            {emissionPaginatedData.length > 0 ? (
                            emissionPaginatedData.map(
                                (item, index) => (
                                <tr
                                    key={`${item.timestamp}-${index}`}
                                >
                                    <td>
                                    {emissionStartIndex +
                                        index +
                                        1}
                                    </td>

                                    <td>
                                    {formatTimestampAMPM(
                                        item.timestamp
                                    )}
                                    </td>

                                    <td>{item.motor}</td>
                                    <td>{item.mobil}</td>
                                    <td>{item.bus}</td>
                                    <td>{item.truck}</td>
                                    <td>{item.total}</td>
                                </tr>
                                )
                            )
                            ) : (
                            <tr>
                                <td
                                colSpan={7}
                                className="traffic-empty"
                                >
                                Tidak ada data
                                </td>
                            </tr>
                            )}

                        </tbody>

                        </table>

                    </div>

                    {emissionTotalPages > 1 && (
                        <div className="traffic-pagination">

                        <div className="traffic-pagination-buttons">

                            <button
                            type="button"
                            disabled={
                                emissionPage === 1
                            }
                            onClick={() =>
                                setEmissionPage(
                                (page) =>
                                    page - 1
                                )
                            }
                            >
                            ‹
                            </button>

                            {Array.from(
                            {
                                length:
                                emissionTotalPages,
                            },
                            (_, index) =>
                                index + 1
                            ).map((page) => (
                            <button
                                type="button"
                                key={page}
                                className={
                                emissionPage === page
                                    ? "active"
                                    : ""
                                }
                                onClick={() =>
                                setEmissionPage(
                                    page
                                )
                                }
                            >
                                {page}
                            </button>
                            ))}

                            <button
                            type="button"
                            disabled={
                                emissionPage ===
                                emissionTotalPages
                            }
                            onClick={() =>
                                setEmissionPage(
                                (page) =>
                                    page + 1
                                )
                            }
                            >
                            ›
                            </button>

                        </div>

                        </div>
                    )}

                    </div>

                </section> 
                */}


                {/* ==================================================
                     SERVER TIME
                ================================================== */}

                {serverTimestamp && (

                    <div className="digital-server-time">

                        Server timestamp:{" "}

                        {formatTime(
                            serverTimestamp
                        )}

                    </div>

                )}

                

            </div>

        </MainLayout>
    );
}