'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './digital.css'
import type L from 'leaflet'
import { Chart as ChartJS, LinearScale, PointElement, LineElement, LineController, Tooltip, Legend, LogarithmicScale } from 'chart.js'
import { Line } from 'react-chartjs-2'
import MainLayout from '../components/layout/MainLayout'
import { Marker, CONDITIONS, CONDITION_COLORS, MODES } from '../../types/Marker'
import { MarkerApi, SocketConnection } from '../../lib/api_2'
import PhotoViewer, { PhotoViewerState } from './PhotoViewer'
import 'leaflet/dist/leaflet.css'
import 'pannellum/build/pannellum.css'
import './index.css'

// ============================================================
// CONFIG & CONSTANTS
// ============================================================

const AREA_ID = 'lidah-wetan'
const AREA_NAME = 'Kampus Lidah Wetan'
const BASE_IMAGE_URL = 'https://ussc.nurutomo.my.id'
const CENTER_LAT = -7.301062
const CENTER_LON = 112.670743
const CENTER_ZOOM = 17
const LUX_BUCKET_SIZE = 5

ChartJS.register(LinearScale, LogarithmicScale, PointElement, LineElement, LineController, Tooltip, Legend)

const formatTime = (ts?: string | number | Date) => (ts ? new Date(ts).toLocaleTimeString() : new Date().toLocaleTimeString())
const toImageProxyUrl = (value: string, base = BASE_IMAGE_URL): string => {
  const url = new URL(value, base)
  if (url.pathname.startsWith('/admin/img/')) return `${url.pathname}${url.search}${url.hash}`
  if (url.pathname.startsWith('/img/')) return `/admin${url.pathname}${url.search}${url.hash}`
  return url.toString()
}
const withThumbnail = (value: string): string => {
  const url = new URL(value, BASE_IMAGE_URL)
  url.searchParams.set('thumb', '50')
  return `${url.pathname}${url.search}${url.hash}`
}

const getImageUrl = (path: string) => toImageProxyUrl(path)

function PanoramaThumbnail({ imageUrl, alt }: { imageUrl: string; alt: string }) {
  const [src, setSrc] = useState(() => {
    const url = new URL(imageUrl, BASE_IMAGE_URL)
    const preview = url.pathname.toLowerCase().endsWith('.json')
      ? url.toString().replace(/\/config\.json(?:\?.*)?$/i, '/fallback/f.jpg?thumb=50')
      : `${url.toString()}${url.search ? '&' : '?'}thumb=50`
    return toImageProxyUrl(preview)
  })

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const sourceUrl = new URL(imageUrl, BASE_IMAGE_URL)
    const configUrl = sourceUrl.pathname.toLowerCase().endsWith('.json')
      ? sourceUrl
      : new URL(`${sourceUrl.pathname.split('.').slice(0, -1).join('.')}/config.json`, sourceUrl.origin)
    const proxiedConfigUrl = toImageProxyUrl(configUrl.toString())
    const directPreviewUrl = toImageProxyUrl(`${sourceUrl.toString()}${sourceUrl.search ? '&' : '?'}thumb=50`)

    const loadPreview = async () => {
      try {
        const response = await fetch(proxiedConfigUrl, { signal: controller.signal })
        if (!response.ok) {
          if (!cancelled) setSrc(directPreviewUrl)
          return
        }

        const config = (await response.json()) as {
          panorama?: string
          multiRes?: {
            equirectangularThumbnail?: string
            fallbackPath?: string
            extension?: string
          }
        }
        if (cancelled) return
        const multiRes = config.multiRes
        if (multiRes?.equirectangularThumbnail) {
          setSrc(toImageProxyUrl(multiRes.equirectangularThumbnail, configUrl.toString()))
          return
        }

        if (config.panorama) {
          const panoramaUrl = new URL(config.panorama, configUrl)
          panoramaUrl.searchParams.set('thumb', '50')
          setSrc(toImageProxyUrl(panoramaUrl.toString()))
          return
        }

        if (multiRes?.fallbackPath) {
          const fallbackPath = `${multiRes.fallbackPath.replace('%s', 'f')}.${multiRes.extension || 'jpg'}`
          const fallbackUrl = new URL(fallbackPath, configUrl)
          fallbackUrl.searchParams.set('thumb', '50')
          setSrc(toImageProxyUrl(fallbackUrl.toString()))
          return
        }

        setSrc(directPreviewUrl)
      } catch (error: unknown) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) setSrc(directPreviewUrl)
      }
    }

    void loadPreview()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [imageUrl])

  return <img src={src} alt={alt} />
}

const getLuxColor = (lux: number, maxLux: number) => {
  const intensity = maxLux > 0 ? Math.min(1, Math.max(0, lux) / maxLux) : 0
  return `hsl(${Math.round(intensity * 120)} 78% 45%)`
}

const getLightingCondition = (pju: Marker) => {
  if (pju.marker_type === MODES.PJU_LUAR) {
    const lux = Number(pju.lux ?? 0)
    if (lux > 40) return CONDITIONS.TERANG
    if (lux < 15) return CONDITIONS.GELAP
    return CONDITIONS.REDUP
  }

  return pju.condition || CONDITIONS.GELAP
}

const calculateStatistics = (pjus: Marker[]) => {
  return pjus.reduce(
    (acc, p) => {
      acc.total++
      const condition = getLightingCondition(p)
      if (condition === CONDITIONS.TERANG) acc.terang++
      else if (condition === CONDITIONS.REDUP) acc.redup++
      else acc.gelap++
      return acc
    },
    { total: 0, terang: 0, redup: 0, gelap: 0 }
  )
}

// ============================================================
// TYPES
// ============================================================

type Vehicle = {
  id: string | number

  lat?: number | string
  latitude?: number | string

  lon?: number | string
  lng?: number | string
  longitude?: number | string

  type?: string
  class?: string
  class_name?: string
  vehicle_type?: string

  speed?: number | string
  heading?: number | string
}

type CameraData = {
  camera_id?: string
  timestamp?: string
  vehicles?: Vehicle[]
}

type VehicleStats = {
  motor: number
  car: number
  bus: number
  truck: number
  total: number
}

type TrafficTableRow = {
  timestamp: string
  motor: number
  mobil: number
  bus: number
  truck: number
  total: number
}

type LeafletModule = typeof import('leaflet')

type AdminCamera = {
  id: number
  public_code: string
  public_name: string | null
  latitude: number | null
  longitude: number | null
  status: string
  enabled: number | boolean
}

// ============================================================
// CAMERA CONFIGURATION
// ============================================================

const ALLOWED_CAMERA_NAMES = ['CCTV GERBANG UTAMA LIDAH 2', 'CCTV GERBANG UTAMA KETINTANG 1'] as const

const PUBLIC_CAMERA_STREAMS: Record<string, string> = {
  'CCTV GERBANG UTAMA LIDAH 2': 'CTV_GL1_01_00_02',
  'CCTV GERBANG UTAMA KETINTANG 1': 'CCTV_GK_1_01_02_01',
}

const API_URL = '/api/traffic-grafik'
const CAMERAS_API_URL = '/api/cctv/public/cameras'
const REFRESH_INTERVAL = 2000

// ============================================================
// VEHICLE HELPER
// ============================================================

function getVehicleType(vehicle: Vehicle): string {
  return String(vehicle.type ?? vehicle.class ?? vehicle.class_name ?? vehicle.vehicle_type ?? 'car').toLowerCase()
}

type TrafficData = {
  status: string
  selected_date?: string | null
  available_dates?: string[]

  start_time?: string | null
  end_time?: string | null

  vehicle: {
    summary: {
      motor: number
      mobil: number
      bus: number
      truck: number
      total: number
    }

    hourly: Array<{
      jam: number
      total: number
    }>

    table: TrafficTableRow[]
  }

  emission: {
    summary: {
      motor: number
      mobil: number
      bus: number
      truck: number
      total: number
    }

    hourly: Array<{
      jam: number
      total: number
    }>

    table: TrafficTableRow[]
  }
}

function getVehicleName(vehicle: Vehicle): string {
  const type = getVehicleType(vehicle)

  if (type === 'motor' || type === 'motorcycle' || type === 'motorbike') {
    return 'Motor'
  }

  if (type === 'bus') {
    return 'Bus'
  }

  if (type === 'truck' || type === 'truk') {
    return 'Truk'
  }

  return 'car'
}

function getVehicleEmoji(vehicle: Vehicle): string {
  const type = getVehicleType(vehicle)

  if (type === 'motor' || type === 'motorcycle' || type === 'motorbike') {
    return '🏍'
  }

  if (type === 'bus') {
    return '🚌'
  }

  if (type === 'truck' || type === 'truk') {
    return '🚛'
  }

  return '🚗'
}

function getVehicleLat(vehicle: Vehicle): number {
  return Number(vehicle.lat ?? vehicle.latitude)
}

function getVehicleLon(vehicle: Vehicle): number {
  return Number(vehicle.lon ?? vehicle.lng ?? vehicle.longitude)
}

function getVehicleSpeed(vehicle: Vehicle): number {
  const value = Number(vehicle.speed ?? 0)

  return Number.isFinite(value) ? value : 0
}

function getVehicleHeading(vehicle: Vehicle): number {
  const value = Number(vehicle.heading ?? 0)
  return Number.isFinite(value) ? value : 0
}

// ============================================================
// STATISTICS
// ============================================================

function calculateStatisticstraffic(vehicles: Vehicle[]): VehicleStats {
  let motor = 0
  let car = 0
  let bus = 0
  let truck = 0

  vehicles.forEach((vehicle) => {
    const type = getVehicleType(vehicle)

    if (type === 'motor' || type === 'motorcycle' || type === 'motorbike') {
      motor++
    } else if (type === 'bus') {
      bus++
    } else if (type === 'truck' || type === 'truk') {
      truck++
    } else {
      car++
    }
  })

  return { motor, car, bus, truck, total: motor + car + bus + truck }
}

// ============================================================
// TIME FORMAT
// ============================================================

function formatTimeTraffic(dateString?: string): string {
  if (!dateString) {
    return '-'
  }

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTimestampAMPM(dateString?: string): string {
  if (!dateString) {
    return '-'
  }

  const date = new Date(dateString)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function downloadCSV(data: TrafficTableRow[], filename: string) {
  if (!data || data.length === 0) return

  const headers = ['No', 'Waktu', 'Motor', 'car', 'Bus', 'Truk', 'Total']

  const csvRows = [
    headers.join(','),
    ...data.map((row, index) =>
      [index + 1, formatTimestampAMPM(row.timestamp), row.motor, row.mobil, row.bus, row.truck, row.total]
        .map((value) => {
          const escaped = String(value ?? '').replace(/"/g, '""')

          return `"${escaped}"`
        })
        .join(',')
    ),
  ]

  // BOM agar karakter terbaca dengan benar di Excel
  const csvContent = '\uFEFF' + csvRows.join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

// ============================================================
// PAGE
// ============================================================

export default function PjuLiwetPage() {
  const api = useMemo(() => new MarkerApi(), [])
  const connection = useMemo(() => new SocketConnection(), [])

  // ========================================================
  // MAP REFS
  // ========================================================
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const pjuLayer = useRef<L.LayerGroup | null>(null)
  const streetLayerRef = useRef<L.TileLayer | null>(null)
  const satelliteLayerRef = useRef<L.TileLayer | null>(null)
  const pjuInstances = useRef(new Map<number, L.Marker>())

  // ========================================================
  // STATE
  // ========================================================

  // const [cameraId, setCameraId] = useState(CAMERA_ID);
  const [serverTimestamp, setServerTimestamp] = useState<string | undefined>()
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [visibleMapBounds, setVisibleMapBounds] = useState<L.LatLngBounds | null>(null)
  const [lastUpdate, setLastUpdate] = useState('-:-:-')
  const [isOnline, setIsOnline] = useState(false)
  const [satelliteVisible, setSatelliteVisible] = useState(false)
  const [selectedType, setSelectedType] = useState<MODES>(MODES.PJU)
  const [photoViewer, setPhotoViewer] = useState<PhotoViewerState>(null)
  const [vehicleVisible, setVehicleVisible] = useState(true)
  const vehicleMarkersRef = useRef<Record<string, L.Marker>>({})
  const [trafficVisible, setTrafficVisible] = useState(false)
  const toggleTraffic = () => {
    setTrafficVisible((visible) => !visible)
  }
  const [trafficData, setTrafficData] = useState<TrafficData | null>(null)
  const [trafficLoading, setTrafficLoading] = useState(false)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [cameras, setCameras] = useState<AdminCamera[]>([])
  const [selectedCameraCode, setSelectedCameraCode] = useState('')
  const [cameraLoading, setCameraLoading] = useState(true)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)

  const selectedCamera = cameras.find((camera) => camera.public_code === selectedCameraCode)

  const visibleMarkers = useMemo(() => {
    if (!visibleMapBounds) return []
    return markers.filter((marker) => {
      const latitude = Number(marker.latitude)
      const longitude = Number(marker.longitude)
      return Number.isFinite(latitude) && Number.isFinite(longitude) && visibleMapBounds.contains([latitude, longitude])
    })
  }, [markers, visibleMapBounds])
  const pjus = useMemo(() => markers.filter((m) => m.marker_type === selectedType), [markers, selectedType])
  const visiblePjus = useMemo(() => visibleMarkers.filter((m) => m.marker_type === selectedType), [visibleMarkers, selectedType])
  const stats = useMemo(() => calculateStatistics(pjus), [pjus])
  const maxLux = useMemo(
    () => Math.max(0, ...pjus.map((marker) => Number(marker.lux) || 0)),
    [pjus]
  )
  const luxBucketCount = Math.max(1, Math.ceil(maxLux / LUX_BUCKET_SIZE) + 1)
  const luxChartMax = Math.max(LUX_BUCKET_SIZE, Math.ceil(maxLux / LUX_BUCKET_SIZE) * LUX_BUCKET_SIZE)
  const luxTickStep = Math.max(LUX_BUCKET_SIZE, Math.ceil(luxChartMax / 10 / LUX_BUCKET_SIZE) * LUX_BUCKET_SIZE)
  const luxDistribution = useMemo(() => {
    const buckets = Array.from({ length: luxBucketCount }, () => 0)
    visiblePjus.forEach((pju) => {
      const lux = Math.max(0, Number(pju.lux) || 0)
      const bucketIndex = Math.min(Math.floor(lux / LUX_BUCKET_SIZE), luxBucketCount - 1)
      buckets[bucketIndex]++
    })
    return buckets
  }, [visiblePjus, luxBucketCount])
  const maxLuxBucketCount = Math.max(1, ...luxDistribution)
  const luxChartPoints = luxDistribution.map((count, index) => ({
    x: index === 0 ? 0 : index * LUX_BUCKET_SIZE + LUX_BUCKET_SIZE / 2,
    y: count,
    bucketIndex: index,
  }))
  const luxChartData = {
    datasets: [
      {
        label: 'Jumlah marker',
        data: luxChartPoints,
        borderColor: '#16a36a',
        backgroundColor: 'rgba(22, 163, 106, 0.12)',
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 8,
        spanGaps: true,
        tension: 0.35,
        cubicInterpolationMode: 'monotone' as const,
        fill: true,
      },
    ],
  }
  const luxChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' as const },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: { dataIndex: number }[]) => {
            const bucketIndex = luxChartPoints[items[0]?.dataIndex ?? 0]?.bucketIndex ?? 0
            const bucketStart = bucketIndex * LUX_BUCKET_SIZE
            return `${bucketStart}–${bucketStart + LUX_BUCKET_SIZE - 1} lx`
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        min: 0,
        max: luxChartMax,
        title: { display: true, text: 'Intensitas cahaya (lx)' },
        ticks: {
          stepSize: luxTickStep,
          callback: (value: string | number) => `${Number(value).toLocaleString()} lx`,
        },
      },
      y: {
        type: 'linear' as const,
        beginAtZero: true,
        title: { display: true, text: 'Jumlah marker' },
        ticks: { precision: 0, callback: (value: string | number) => Number(value).toLocaleString() },
      },
    },
  }

  const percentages = useMemo(() => {
    if (stats.total <= 0) return { terang: 0, redup: 0, gelap: 0 }
    return {
      terang: Math.round((stats.terang / stats.total) * 100),
      redup: Math.round((stats.redup / stats.total) * 100),
      gelap: Math.round((stats.gelap / stats.total) * 100),
    }
  }, [stats])

  const fetchTrafficData = useCallback(async () => {
    try {
      setTrafficLoading(true)
      setTrafficError(null)

      const response = await fetch(API_URL, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const result: TrafficData = await response.json()

      if (result.status !== 'success') {
        throw new Error('Gagal mengambil data traffic')
      }

      setTrafficData(result)
    } catch (error) {
      console.error('[TRAFFIC ERROR]', error)

      setTrafficError(error instanceof Error ? error.message : 'Gagal mengambil data traffic')
    } finally {
      setTrafficLoading(false)
    }
  }, [])

  // ========================================================
  // STATISTICS
  // ========================================================
  const trafficStats = useMemo(() => {
    const summary = trafficData?.vehicle?.summary

    if (!summary) {
      return {
        motor: 0,
        mobil: 0,
        bus: 0,
        truck: 0,
        total: 0,
      }
    }

    return {
      motor: summary.motor ?? 0,
      mobil: summary.mobil ?? 0,
      bus: summary.bus ?? 0,
      truck: summary.truck ?? 0,
      total: summary.total ?? 0,
    }
  }, [trafficData])

  const trafficPercentages = useMemo(() => {
    if (trafficStats.total <= 0) {
      return {
        motor: 0,
        car: 0,
        bus: 0,
        truck: 0,
      }
    }

    return {
      motor: Math.round((trafficStats.motor / trafficStats.total) * 100),

      car: Math.round((trafficStats.mobil / trafficStats.total) * 100),

      bus: Math.round((trafficStats.bus / trafficStats.total) * 100),

      truck: Math.round((trafficStats.truck / trafficStats.total) * 100),
    }
  }, [trafficStats])

  // ========================================================
  // INITIALIZE LEAFLET (DYNAMIC IMPORT FOR SSR SAFE)
  // ========================================================
  useEffect(() => {
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null

    async function initializeMap() {
      try {
        const Leaflet = await import('leaflet')
        if (cancelled) return
        leafletRef.current = Leaflet

        if (!mapElement.current) return

        const map = Leaflet.map(mapElement.current, { zoomControl: false, attributionControl: false }).setView([CENTER_LAT, CENTER_LON], CENTER_ZOOM)
        Leaflet.control.zoom({ position: 'bottomright' }).addTo(map)

        const streetLayer = Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 24, maxNativeZoom: 19 })
        // const satelliteLayer = Leaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' })
        const satelliteLayer = Leaflet.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          maxZoom: 24,
          maxNativeZoom: 22,
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        })

        streetLayerRef.current = streetLayer
        satelliteLayerRef.current = satelliteLayer
        streetLayer.addTo(map)

        mapRef.current = map
        pjuLayer.current = Leaflet.layerGroup().addTo(map)
        setMapInstance(map)
        setVisibleMapBounds(map.getBounds())
        map.on('moveend', () => setVisibleMapBounds(map.getBounds()))

        // Handle Resize
        if (mapElement.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (!cancelled) map.invalidateSize({ animate: false })
          })
          resizeObserver.observe(mapElement.current)
        }

        // Force UI recalcs just like reference
        requestAnimationFrame(() => {
          if (!cancelled) {
            map.invalidateSize({ animate: false })
            map.setView([CENTER_LAT, CENTER_LON], CENTER_ZOOM, { animate: false })
          }
        })
      } catch (error) {
        console.error('[DIGITAL TWIN] Leaflet error:', error)
      }
    }

    initializeMap()

    return () => {
      cancelled = true
      if (resizeObserver) resizeObserver.disconnect()
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      pjuInstances.current.clear()
      setMapInstance(null)
    }
  }, [])

  // ========================================================
  // INITIAL LOAD & SOCKET CONNECTION
  // ========================================================
  useEffect(() => {
    api
      .list()
      .then((data) => {
        setMarkers(data)
        const newestMarkerTime = data.reduce<number | null>((newest, marker) => {
          const timestamp = new Date(marker.date).getTime()
          return Number.isNaN(timestamp) ? newest : Math.max(newest ?? timestamp, timestamp)
        }, null)
        if (newestMarkerTime !== null) setLastUpdate(formatTime(new Date(newestMarkerTime)))
      })
      .catch((error) => console.error('[DIGITAL TWIN ERROR]', error))

    const off = [
      connection.on('connect', () => setIsOnline(true)),
      connection.on('disconnect', () => setIsOnline(false)),
      connection.on('marker.add', (data: Marker) => {
        setMarkers((items) => (items.some((item) => item.id === data.id) ? items : [...items, data]))
        setLastUpdate(formatTime())
      }),
      connection.on('marker.update', (data: Marker) => {
        setMarkers((items) => items.map((item) => (item.id === data.id ? data : item)))
        setLastUpdate(formatTime())
      }),
      connection.on('marker.remove', (data: { id: number }) => {
        setMarkers((items) => items.filter((item) => item.id !== data.id))
        setLastUpdate(formatTime())
      }),
    ]

    return () => off.forEach((cleanup) => cleanup())
  }, [api, connection])

  // ========================================================
  // MAP PJU MARKERS RENDERING (Optimized via instances dictionary)
  // ========================================================
  useEffect(() => {
    const Leaflet = leafletRef.current
    if (!mapRef.current || !pjuLayer.current || !Leaflet) return

    const layer = pjuLayer.current
    const instances = pjuInstances.current
    const activeIds = new Set<number>()

    visiblePjus.forEach((pju) => {
      if (pju.id == null) return

      const id = pju.id
      const lat = Number(pju.latitude)
      const lon = Number(pju.longitude)

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
      activeIds.add(id)

      const name = pju.name || `PJU ${id}`
      const lux = pju.lux ?? 0
      const condition = getLightingCondition(pju)
      const point = Leaflet.latLng(lat, lon)

      const colors = CONDITION_COLORS[condition as keyof typeof CONDITION_COLORS] || CONDITION_COLORS.Gelap
      const iconColor = colors[0]
      const luxColor = getLuxColor(lux, maxLux)

      const popupContent = `
        <div class="pju-lidah-wetan-vehicle-popup">
          <div class="pju-lidah-wetan-popup-title">${name}</div>
          <div class="pju-lidah-wetan-popup-row"><span>ID</span><strong>${id}</strong></div>
          <div class="pju-lidah-wetan-popup-row"><span>Latitude</span><strong>${lat.toFixed(6)}</strong></div>
          <div class="pju-lidah-wetan-popup-row"><span>Longitude</span><strong>${lon.toFixed(6)}</strong></div>
          <div class="pju-lidah-wetan-popup-row"><span>Lux</span><strong>${lux} lx</strong></div>
          <div class="pju-lidah-wetan-popup-row"><span>Status</span><strong style="color: ${iconColor};">● ${condition.toUpperCase()}</strong></div>
        </div>`

      const icon = Leaflet.divIcon({
        className: 'pju-lidah-wetan-pju-marker',
        html: `
          <div class="pju-lidah-wetan-lux-marker" style="background: ${luxColor};"></div>
        `,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      })

      let marker = instances.get(id)
      if (marker) {
        marker.setLatLng(point)
        marker.setIcon(icon)
        marker.setPopupContent(popupContent)
      } else {
        marker = Leaflet.marker(point, { icon }).bindPopup(popupContent)
        instances.set(id, marker)
        marker.addTo(layer)
      }
    })

    for (const [id, marker] of instances.entries()) {
      if (!activeIds.has(id)) {
        layer.removeLayer(marker)
        instances.delete(id)
      }
    }
  }, [visiblePjus, mapInstance])

  const toggleSatellite = () => {
    const map = mapRef.current
    const street = streetLayerRef.current
    const satellite = satelliteLayerRef.current
    if (!map || !street || !satellite) return

    if (satelliteVisible) {
      map.removeLayer(satellite)
      map.addLayer(street)
    } else {
      map.removeLayer(street)
      map.addLayer(satellite)
    }
    setSatelliteVisible(!satelliteVisible)

    setTimeout(() => map.invalidateSize({ animate: false }), 100)
  }

  const centerMap = () => mapRef.current?.flyTo([CENTER_LAT, CENTER_LON], CENTER_ZOOM, { duration: 1 })

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    Object.values(vehicleMarkersRef.current).forEach((marker) => {
      if (vehicleVisible) {
        if (!map.hasLayer(marker)) {
          marker.addTo(map)
        }
      } else {
        if (map.hasLayer(marker)) {
          map.removeLayer(marker)
        }
      }
    })
  }, [vehicleVisible])
  useEffect(() => {
    fetchTrafficData()

    const interval = window.setInterval(() => {
      fetchTrafficData()
    }, REFRESH_INTERVAL)

    return () => {
      window.clearInterval(interval)
    }
  }, [fetchTrafficData])

  // ========================================================
  // LOAD CAMERAS FROM USSC DATABASE
  // ========================================================

  useEffect(() => {
    let cancelled = false

    async function loadCameras() {
      try {
        setCameraLoading(true)
        setCameraError(null)

        const response = await fetch(CAMERAS_API_URL, {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Gagal memuat CCTV`)
        }

        const result = await response.json()

        if (!result.success || !Array.isArray(result.data)) {
          throw new Error('Format data kamera tidak valid')
        }

        // Hanya nama yang diizinkan yang ditampilkan.
        const allowedCameras: AdminCamera[] = result.data.filter((camera: AdminCamera) =>
          ALLOWED_CAMERA_NAMES.includes(camera.public_name as (typeof ALLOWED_CAMERA_NAMES)[number])
        )

        if (cancelled) return

        setCameras(allowedCameras)

        // Pertahankan pilihan jika masih tersedia.
        setSelectedCameraCode((previous) => {
          if (previous && allowedCameras.some((camera) => camera.public_code === previous)) {
            return previous
          }

          return allowedCameras[0]?.public_code ?? ''
        })
      } catch (error) {
        if (cancelled) return

        setCameraError(error instanceof Error ? error.message : 'Gagal mengambil data kamera')
      } finally {
        if (!cancelled) setCameraLoading(false)
      }
    }

    void loadCameras()

    return () => {
      cancelled = true
    }
  }, [])

  const publicCameraPath: string | undefined = selectedCamera ? PUBLIC_CAMERA_STREAMS[selectedCamera.public_name ?? ''] : undefined

  useEffect(() => {
    const streamPath = publicCameraPath

    if (!selectedCamera || typeof streamPath !== 'string' || streamPath.length === 0) {
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      return
    }

    let cancelled = false
    const pc = new RTCPeerConnection({
      iceServers: [],
    })

    peerConnectionRef.current = pc

    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (event) => {
      if (cancelled || !videoRef.current) return

      const stream = event.streams[0]
      if (stream) {
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch((error) => {
          console.warn('Video belum dapat diputar:', error)
        })
      }
    }

    async function startWebRTC() {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        // Tunggu ICE selesai dikumpulkan sebelum mengirim SDP.
        if (pc.iceGatheringState !== 'complete') {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              cleanup()
              reject(new Error('Timeout saat mengumpulkan ICE'))
            }, 10000)

            function cleanup() {
              window.clearTimeout(timeout)
              pc.removeEventListener('icegatheringstatechange', onIceGatheringStateChange)
            }

            function onIceGatheringStateChange() {
              if (pc.iceGatheringState === 'complete') {
                cleanup()
                resolve()
              }
            }

            pc.addEventListener('icegatheringstatechange', onIceGatheringStateChange)

            // Periksa kembali untuk menghindari race condition.
            if (pc.iceGatheringState === 'complete') {
              cleanup()
              resolve()
            }
          })
        }

        if (cancelled || !pc.localDescription?.sdp) return
        if (typeof streamPath !== 'string' || streamPath.length === 0) {
          throw new Error('Path stream CCTV tidak tersedia')
        }
        const safeStreamPath: string = streamPath
        const response = await fetch(`/api/cctv/whep/${encodeURIComponent(safeStreamPath)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
          },
          body: pc.localDescription.sdp,
          cache: 'no-store',
        })

        if (!response.ok) {
          const detail = await response.text()
          throw new Error(`WHEP HTTP ${response.status}: ${detail}`)
        }

        const answer = await response.text()

        if (cancelled) return

        await pc.setRemoteDescription({
          type: 'answer',
          sdp: answer,
        })
      } catch (error) {
        if (!cancelled) {
          console.error('[PUBLIC CCTV WEBRTC]', error)
        }
      }
    }

    void startWebRTC()

    return () => {
      cancelled = true
      pc.close()

      if (peerConnectionRef.current === pc) {
        peerConnectionRef.current = null
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [selectedCameraCode, publicCameraPath])

  // ========================================================
  // RENDER
  // ========================================================
  return (
    <MainLayout>
      <div className="pju-lidah-wetan-page-container">
        <div className="page-heading">
          <div>
            <span className="eyebrow">PJU</span>
            <h2>PJU UNESA Lidah Wetan</h2>
            <p>Visualisasi Penerangan Jalan Umum secara realtime di peta kampus.</p>
          </div>
          <div className="location-badge">
            <i className="bi bi-pin-map-fill" /> Live Map
          </div>
        </div>

        <section className="digital-stats">
          <div className="digital-stat-card">
            <div className="digital-stat-icon total">🚗</div>
            <div>
              <span>Total Kendaraan</span>
              <strong>{trafficStats.total}</strong>
            </div>
          </div>

          <div className="digital-stat-card">
            <div className="digital-stat-icon motor">🏍</div>
            <div>
              <span>Motor</span>

              <strong>{trafficStats.motor}</strong>
            </div>
          </div>

          <div className="digital-stat-card">
            <div className="digital-stat-icon car">🚗</div>
            <div>
              <span>Mobil</span>

              <strong>{trafficStats.mobil}</strong>
            </div>
          </div>

          <div className="digital-stat-card">
            <div className="digital-stat-icon bus">🚌</div>
            <div>
              <span>Bus</span>
              <strong>{trafficStats.bus}</strong>
            </div>
          </div>

          <div className="digital-stat-card">
            <div className="digital-stat-icon truck">🚛</div>
            <div>
              <span>Truk</span>
              <strong>{trafficStats.truck}</strong>
            </div>
          </div>
        </section>

        <section className="pju-lidah-wetan-stats">
          <div className="pju-lidah-wetan-stat-card">
            <div className="pju-lidah-wetan-stat-icon total" style={{ background: '#3b82f6' }}>
              <i className="bi bi-lightbulb-fill" aria-hidden="true" />
            </div>
            <div>
              <span>Total PJU</span>
              <strong>{stats.total}</strong>
            </div>
          </div>
          <div className="pju-lidah-wetan-stat-card">
            <div className="pju-lidah-wetan-stat-icon motor" style={{ background: CONDITION_COLORS.Terang[0] }}>
              <i className="bi bi-brightness-high-fill" aria-hidden="true" />
            </div>
            <div>
              <span>Terang</span>
              <strong>{stats.terang}</strong>
            </div>
          </div>
          <div className="pju-lidah-wetan-stat-card">
            <div className="pju-lidah-wetan-stat-icon car" style={{ background: CONDITION_COLORS.Redup[0] }}>
              <i className="bi bi-brightness-alt-high-fill" aria-hidden="true" />
            </div>
            <div>
              <span>Redup</span>
              <strong>{stats.redup}</strong>
            </div>
          </div>
          <div className="pju-lidah-wetan-stat-card">
            <div className="pju-lidah-wetan-stat-icon truck" style={{ background: CONDITION_COLORS.Gelap[0] }}>
              <i className="bi bi-moon-stars-fill" aria-hidden="true" />
            </div>
            <div>
              <span>Gelap</span>
              <strong>{stats.gelap}</strong>
            </div>
          </div>
        </section>

        <section className="pju-lidah-wetan-area">
          <div className="pju-lidah-wetan-map-header">
            <div className="pju-lidah-wetan-map-title">
              <h2>Peta PJU</h2>
            </div>
            <div className="pju-lidah-wetan-map-tools">
              <button type="button" className={`${satelliteVisible ? 'active' : ''}`.trim()} onClick={toggleSatellite}>
                <i className="bi bi-globe" aria-hidden="true" /> Satelit
              </button>
              <button type="button" className={trafficVisible ? 'active' : ''} onClick={toggleTraffic}>
                🚦 Traffic
              </button>
              <fieldset className="pju-lidah-wetan-type-switch" aria-label="Pilih jenis PJU">
                <label className={selectedType === MODES.PJU ? 'active' : ''}>
                  <input
                    type="radio"
                    name="pju-type"
                    value={MODES.PJU}
                    checked={selectedType === MODES.PJU}
                    onChange={() => setSelectedType(MODES.PJU)}
                  />
                  PJU Hutan
                </label>
                <label className={selectedType === MODES.PJU_LUAR ? 'active' : ''}>
                  <input
                    type="radio"
                    name="pju-type"
                    value={MODES.PJU_LUAR}
                    checked={selectedType === MODES.PJU_LUAR}
                    onChange={() => setSelectedType(MODES.PJU_LUAR)}
                  />
                  PJU Luar
                </label>
              </fieldset>
            </div>
            <div className="pju-lidah-wetan-header-right">
              <div className="pju-lidah-wetan-last-update">
                <i className={`bi bi-circle-fill ${isOnline ? 'pju-lidah-wetan-status-green' : 'pju-lidah-wetan-status-red'}`} aria-hidden="true" />
                <div>
                  <small>Last Update</small>
                  <strong>{lastUpdate}</strong>
                </div>
              </div>
              <button type="button" className="pju-lidah-wetan-map-control" onClick={centerMap} title="Kembali ke tengah">
                <i className="bi bi-cursor"></i>
              </button>
            </div>
          </div>

          <div className="pju-lidah-wetan-map-stage">
            <div id="pju-lidah-wetan-map" ref={mapElement} className="pju-lidah-wetan-map" />
            <div className="pju-lidah-wetan-live-indicator">
              <span className={isOnline ? '' : 'offline'} />
              <div>
                <strong>{isOnline ? 'LIVE' : 'OFFLINE'}</strong>
              </div>
            </div>
          </div>

          <div className="pju-lidah-wetan-map-legend">
            <div className="pju-lidah-wetan-legend-title">Lux (linear)</div>
            <div className="pju-lidah-wetan-lux-gradient" />
            <div className="pju-lidah-wetan-lux-legend-labels">
              <span>0</span>
              <span>{maxLux} lx</span>
            </div>
          </div>
        </section>

        <section className="pju-lidah-wetan-bottom-grid">
          <div className="pju-lidah-wetan-info-card">
            <div className="pju-lidah-wetan-card-header">
              <div><h3>Area Information</h3></div>
              <span className="pju-lidah-wetan-online-badge">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <div className="pju-lidah-wetan-camera-info-grid">
              <div><small>Area ID</small><strong>{AREA_ID}</strong></div>
              <div><small>Location</small><strong>{AREA_NAME}</strong></div>
              <div><small>Latitude</small><strong>{CENTER_LAT.toFixed(6)}</strong></div>
              <div><small>Longitude</small><strong>{CENTER_LON.toFixed(6)}</strong></div>
            </div>
          </div>

          <div className="pju-lidah-wetan-info-card">
            <div className="pju-lidah-wetan-card-header">
              <div>
                <h3>Status Penerangan</h3>
                <span>Komposisi lampu jalan aktif</span>
              </div>
              <span className="pju-lidah-wetan-vehicle-count">{stats.total} PJU</span>
            </div>
            <div className="pju-lidah-wetan-status-list">
              <div className="pju-lidah-wetan-status-row">
                <span className="pju-lidah-wetan-vehicle-name">
                  <i className="bi bi-brightness-high-fill" aria-hidden="true" /> Terang
                </span>
                <div className="pju-lidah-wetan-status-bar">
                  <div
                    className="pju-lidah-wetan-status-fill motor-fill"
                    style={{ width: `${percentages.terang}%`, background: CONDITION_COLORS.Terang[0] }}
                  />
                </div>
                <strong>{percentages.terang}%</strong>
              </div>
              <div className="pju-lidah-wetan-status-row">
                <span className="pju-lidah-wetan-vehicle-name">
                  <i className="bi bi-brightness-alt-high-fill" aria-hidden="true" /> Redup
                </span>
                <div className="pju-lidah-wetan-status-bar">
                  <div
                    className="pju-lidah-wetan-status-fill car-fill"
                    style={{ width: `${percentages.redup}%`, background: CONDITION_COLORS.Redup[0] }}
                  />
                </div>
                <strong>{percentages.redup}%</strong>
              </div>
              <div className="pju-lidah-wetan-status-row">
                <span className="pju-lidah-wetan-vehicle-name">
                  <i className="bi bi-moon-stars-fill" aria-hidden="true" /> Gelap
                </span>
                <div className="pju-lidah-wetan-status-bar">
                  <div
                    className="pju-lidah-wetan-status-fill truck-fill"
                    style={{ width: `${percentages.gelap}%`, background: CONDITION_COLORS.Gelap[0] }}
                  />
                </div>
                <strong>{percentages.gelap}%</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="pju-lidah-wetan-data-grid">
          <div className="pju-lidah-wetan-info-card pju-lidah-wetan-distribution">
            <div className="pju-lidah-wetan-card-header">
              <div>
                <h3>Distribusi Lux</h3>
                <span>
                  {selectedType === MODES.PJU ? 'PJU Hutan' : 'PJU Luar'} · {visiblePjus.length} titik terlihat
                </span>
              </div>
            </div>
            <div className="pju-lidah-wetan-line-chart" role="img" aria-label={`Distribusi lux PJU ${selectedType} dengan skala linear hingga ${maxLux} lx`}>
              <Line data={luxChartData} options={luxChartOptions} />
              <div className="pju-lidah-wetan-chart-summary">
                Puncak: {maxLuxBucketCount} marker dalam satu bucket · interval {LUX_BUCKET_SIZE} lx
              </div>
            </div>
          </div>

          <div className="pju-lidah-wetan-info-card pju-lidah-wetan-marker-list">
            <div className="pju-lidah-wetan-card-header">
              <div>
                <h3>Daftar Marker</h3>
                <span>{visiblePjus.length} titik PJU terlihat</span>
              </div>
            </div>
            <div className="ussc-table-scroll pju-lidah-wetan-table-wrap">
              <table className="ussc-data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nama</th>
                    <th>Foto</th>
                    <th>Lux</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePjus.length > 0 ? (
                    visiblePjus.map((pju) => {
                      const condition = getLightingCondition(pju)
                      const conditionColor = CONDITION_COLORS[condition as keyof typeof CONDITION_COLORS]?.[0] || CONDITION_COLORS.Gelap[0]
                      const photoUrl = pju.photo ? getImageUrl(pju.photo) : ''
                      const photo360Url = pju.photo_360 ? getImageUrl(pju.photo_360) : ''
                      return (
                        <tr key={pju.id}>
                          <td>{pju.id}</td>
                          <td>{pju.name || `PJU ${pju.id}`}</td>
                          <td>
                            <div className="pju-lidah-wetan-photo-actions">
                              {photoUrl && (
                                <button
                                  type="button"
                                  title="Lihat foto"
                                  aria-label={`Lihat foto ${pju.name || `PJU ${pju.id}`}`}
                                  onClick={() => setPhotoViewer({ image: photoUrl, type: 'photo', title: pju.name || `Foto PJU ${pju.id}` })}
                                >
                                  <img src={withThumbnail(photoUrl)} alt={`Pratinjau ${pju.name || `PJU ${pju.id}`}`} />
                                </button>
                              )}
                              {photo360Url && (
                                <button
                                  type="button"
                                  title="Lihat foto 360"
                                  aria-label={`Lihat foto 360 ${pju.name || `PJU ${pju.id}`}`}
                                  onClick={() =>
                                    setPhotoViewer({ image: photo360Url, type: '360', title: `Foto 360 ${pju.name || `PJU ${pju.id}`}` })
                                  }
                                >
                                  <PanoramaThumbnail imageUrl={photo360Url} alt={`Pratinjau foto 360 ${pju.name || `PJU ${pju.id}`}`} />
                                </button>
                              )}
                              {!photoUrl && !photo360Url && <span aria-label="Foto tidak tersedia">-</span>}
                            </div>
                          </td>
                          <td>
                            <span className="pju-lidah-wetan-lux-badge" style={{ '--lux-color': getLuxColor(pju.lux ?? 0, maxLux) } as React.CSSProperties}>
                              <i className="bi bi-brightness-high" aria-hidden="true" /> {pju.lux ?? 0} lx
                            </span>
                          </td>
                          <td>
                            <span className="pju-lidah-wetan-condition" style={{ '--condition-color': conditionColor } as React.CSSProperties}>
                              <i className="bi bi-circle-fill" aria-hidden="true" /> {condition}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td className="pju-lidah-wetan-empty" colSpan={5}>
                        Belum ada marker untuk jenis ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {selectedCamera && (
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-700 bg-black">
            <div className="p-3 text-white">{selectedCamera.public_name}</div>

            <video ref={videoRef} autoPlay muted playsInline controls className="aspect-video w-full bg-black" />
          </div>
        )}

        {/* =================================================
                CAMERA INFORMATION
            ================================================= */}
        <section className="digital-bottom-grid">
          <div className="digital-info-card">
            <div className="digital-card-header">
              <div>
                <h3>Camera Information</h3>
              </div>

              <span className="digital-online-badge">{selectedCamera?.status ?? 'OFFLINE'}</span>
            </div>

            <div className="digital-camera-info-grid">
              <div>
                <small>Nama CCTV</small>

                {cameraLoading ? (
                  <span>Memuat kamera...</span>
                ) : cameraError ? (
                  <span role="alert">{cameraError}</span>
                ) : cameras.length > 0 ? (
                  <select
                    id="ussc-camera-select"
                    aria-label="Pilih nama CCTV"
                    value={selectedCameraCode}
                    onChange={(event) => setSelectedCameraCode(event.target.value)}
                    className="camera-name-select"
                  >
                    {cameras.map((camera) => (
                      <option key={camera.public_code} value={camera.public_code}>
                        {camera.public_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>Tidak ada kamera tersedia</span>
                )}
              </div>

              <div>
                <small>Location</small>

                <strong>{selectedCamera?.public_code ?? '-'}</strong>
              </div>

              <div>
                <small>Latitude</small>

                <strong>{selectedCamera?.latitude ?? '-'}</strong>
              </div>

              <div>
                <small>Longitude</small>

                <strong>{selectedCamera?.longitude ?? '-'}</strong>
              </div>
            </div>
          </div>
          {/* =================================================
                VEHICLE STATUS
            ================================================= */}

          <div className="digital-info-card">
            <div className="digital-card-header">
              <div>
                <h3>Vehicle Status</h3>

                <span>Komposisi kendaraan aktif</span>
              </div>

              <span className="digital-vehicle-count">{trafficStats.total} kendaraan</span>
            </div>

            <div className="digital-status-list">
              {/* MOTOR */}

              <div className="digital-status-row">
                <span className="digital-vehicle-name">🏍 Motor</span>

                <div className="digital-status-bar">
                  <div
                    className="digital-status-fill motor-fill"
                    style={{
                      width: `${trafficPercentages.motor}%`,
                    }}
                  />
                </div>

                <strong>{trafficPercentages.motor}%</strong>
              </div>

              {/* MOBIL */}

              <div className="digital-status-row">
                <span className="digital-vehicle-name">🚗 Mobil</span>

                <div className="digital-status-bar">
                  <div
                    className="digital-status-fill car-fill"
                    style={{
                      width: `${trafficPercentages.car}%`,
                    }}
                  />
                </div>

                <strong>{trafficPercentages.car}%</strong>
              </div>

              {/* BUS */}

              <div className="digital-status-row">
                <span className="digital-vehicle-name">🚌 Bus</span>

                <div className="digital-status-bar">
                  <div
                    className="digital-status-fill bus-fill"
                    style={{
                      width: `${trafficPercentages.bus}%`,
                    }}
                  />
                </div>

                <strong>{trafficPercentages.bus}%</strong>
              </div>

              {/* TRUK */}

              <div className="digital-status-row">
                <span className="digital-vehicle-name">🚛 Truk</span>

                <div className="digital-status-bar">
                  <div
                    className="digital-status-fill truck-fill"
                    style={{
                      width: `${trafficPercentages.truck}%`,
                    }}
                  />
                </div>

                <strong>{trafficPercentages.truck}%</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
      <PhotoViewer viewer={photoViewer} onClose={() => setPhotoViewer(null)} />
    </MainLayout>
  )
}
