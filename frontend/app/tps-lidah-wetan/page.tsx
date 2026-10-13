'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip, type ChartData, type ChartOptions } from 'chart.js'
import { Line } from 'react-chartjs-2'
import * as XLSX from 'xlsx'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { isLoggedIn as checkIsLoggedIn } from '../components/auth/Google'
import MainLayout from '../components/layout/MainLayout'
import './markdown.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const DEVICE_IMEI = '860987054243453'
const MAX_DATE_RANGE_DAYS = 31

type PhaseValues = { a?: number; b?: number; c?: number; total?: number }

type EnergyMeasurement = {
  voltage_v?: PhaseValues
  current_a?: PhaseValues
  active_power_w?: PhaseValues
  power_factor?: { total?: number }
  frequency_hz?: number
  thd_voltage_pct?: PhaseValues
  thd_current_pct?: PhaseValues
}

type EnergyRecord = {
  timestamp: string
  measurement?: EnergyMeasurement
}

type EnergyResponse = {
  status?: string
  message?: string
  data?: EnergyRecord[]
}

type ChartSeries = {
  label: string
  color: string
  value: (record: EnergyRecord) => number
}

const phaseColors = ['#2563eb', '#0f9f6e', '#e14c5a']
const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  elements: { line: { tension: 0.2 }, point: { radius: 1.5, hoverRadius: 4 } },
  plugins: {
    legend: { position: 'bottom', labels: { boxWidth: 10, padding: 16 } },
    tooltip: { enabled: true },
  },
  scales: {
    x: { grid: { display: false }, ticks: { maxTicksLimit: 12, maxRotation: 0 } },
    y: { grid: { color: 'rgba(148, 163, 184, 0.2)', tickBorderDash: [3, 3] } },
  },
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function datesBetween(start: string, end: string) {
  const dates: string[] = []
  const current = new Date(`${start}T00:00:00`)
  const last = new Date(`${end}T00:00:00`)
  while (current <= last) {
    dates.push(localDateString(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function asNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

function formatTimestamp(timestamp: string) {
  if (/^\d{14}$/.test(timestamp)) {
    return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)} ${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}`
  }
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString('id-ID')
}

function chartTimestamp(timestamp: string) {
  if (/^\d{14}$/.test(timestamp)) {
    return `${timestamp.slice(6, 8)}/${timestamp.slice(4, 6)} ${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}`
  }
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function averagePhase(values?: PhaseValues) {
  if (!values) return 0
  return (asNumber(values.a) + asNumber(values.b) + asNumber(values.c)) / 3
}

function averageAcrossRecords(records: EnergyRecord[], field: 'thd_voltage_pct' | 'thd_current_pct') {
  if (!records.length) return 0
  return records.reduce((sum, record) => sum + averagePhase(record.measurement?.[field]), 0) / records.length
}

function downloadCsv(records: EnergyRecord[]) {
  const headings = [
    'No',
    'Timestamp',
    'Tegangan_A',
    'Tegangan_B',
    'Tegangan_C',
    'Arus_A',
    'Arus_B',
    'Arus_C',
    'Daya_A',
    'Daya_B',
    'Daya_C',
    'Daya_Total',
    'PF_Total',
    'Frekuensi',
    'THD_V_A',
    'THD_V_B',
    'THD_V_C',
  ]
  const rows = records.map((record, index) => {
    const measurement = record.measurement ?? {}
    const voltage = measurement.voltage_v ?? {}
    const current = measurement.current_a ?? {}
    const power = measurement.active_power_w ?? {}
    const thd = measurement.thd_voltage_pct ?? {}
    return [
      index + 1,
      formatTimestamp(record.timestamp),
      voltage.a ?? 0,
      voltage.b ?? 0,
      voltage.c ?? 0,
      current.a ?? 0,
      current.b ?? 0,
      current.c ?? 0,
      power.a ?? 0,
      power.b ?? 0,
      power.c ?? 0,
      power.total ?? 0,
      measurement.power_factor?.total ?? 0,
      measurement.frequency_hz ?? 0,
      thd.a ?? 0,
      thd.b ?? 0,
      thd.c ?? 0,
    ]
  })
  const csv = [headings, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const link = document.createElement('a')
  const objectUrl = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.href = objectUrl
  link.download = `TPS_Lidah_Wetan_${localDateString()}.csv`
  link.click()
  URL.revokeObjectURL(objectUrl)
}

type SampahRow = {
  id?: string
  tanggal: string
  jamMasuk: string
  sumberSampah: string
  berat: string
}

const SAMPAH_HEADINGS = ['No', 'Tanggal', 'Jam Masuk', 'Sumber Sampah', 'Berat']

function downloadSampahExcel(rows: SampahRow[]) {
  const data = rows.map((row, index) => [index + 1, row.tanggal, row.jamMasuk, row.sumberSampah, row.berat])
  const worksheet = XLSX.utils.aoa_to_sheet([SAMPAH_HEADINGS, ...data])
  worksheet['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 10 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sampah Masuk Keluar')
  XLSX.writeFile(workbook, `Sampah_Lidah_Wetan_${localDateString()}.xlsx`)
}

function importSampahExcel(file: File): Promise<SampahRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, { header: 1, defval: '' }) as (string | number | undefined)[][]
        const imported = rows
          .slice(1)
          .filter((row) => String(row[1] ?? '').trim() !== '')
          .map((row) => ({
            tanggal: String(row[1] ?? ''),
            jamMasuk: String(row[2] ?? ''),
            sumberSampah: String(row[3] ?? ''),
            berat: String(row[4] ?? ''),
          }))
        resolve(imported)
      } catch {
        reject(new Error('Gagal membaca file Excel. Gunakan kolom Tanggal, Jam Masuk, Sumber Sampah, dan Berat.'))
      }
    }
    reader.onerror = () => reject(new Error('Gagal membaca file.'))
    reader.readAsArrayBuffer(file)
  })
}

function ChartPanel({ title, unit, records, series }: { title: string; unit: string; records: EnergyRecord[]; series: ChartSeries[] }) {
  const chronological = records.slice(0, 50).reverse()
  const data: ChartData<'line', number[], string> = {
    labels: chronological.map((record) => chartTimestamp(record.timestamp)),
    datasets: series.map((item) => ({
      label: item.label,
      data: chronological.map(item.value),
      borderColor: item.color,
      backgroundColor: item.color,
      borderWidth: 2,
      fill: false,
    })),
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
        <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">{unit}</span>
      </div>
      <div className="h-[250px]">
        <Line data={data} options={chartOptions} />
      </div>
    </section>
  )
}

function MetricCard({ title, value, unit, tone }: { title: string; value: string; unit: string; tone: string }) {
  return (
    <section
      className={`min-w-0 rounded-lg border border-slate-200 border-t-[3px] bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5 ${tone}`}
    >
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 sm:text-sm">{title}</p>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-slate-900 dark:text-white sm:text-3xl">
        {value} <span className="text-sm font-normal text-slate-400">{unit}</span>
      </p>
    </section>
  )
}

export default function TpsLidahWetanPage() {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [limit, setLimit] = useState(25)
  const [records, setRecords] = useState<EnergyRecord[]>([])
  const [weeklyEnergyRecords, setWeeklyEnergyRecords] = useState<EnergyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Menunggu pembaruan')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const requestController = useRef<AbortController | null>(null)

  useEffect(() => {
    const refreshLoginState = () => {
      setIsLoggedIn(checkIsLoggedIn())
    }

    refreshLoginState()
    window.addEventListener('unesa-auth-changed', refreshLoginState)
    return () => window.removeEventListener('unesa-auth-changed', refreshLoginState)
  }, [])

  const loadWeeklyEnergyData = useCallback(async () => {
    const today = new Date()
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - index)
      return localDateString(date)
    })

    try {
      const results = await Promise.all(dates.map(async (date) => {
        const params = new URLSearchParams({ tanggal: date, limit: '100' })
        const response = await fetch(`/admin/tps/energy?${params}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`API Monacolisa merespons ${response.status}.`)
        const result = (await response.json()) as EnergyResponse
        if (result.status !== 'success') throw new Error(result.message || 'Gagal mengambil data energi mingguan.')
        return Array.isArray(result.data) ? result.data : []
      }))
      setWeeklyEnergyRecords(results.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
    } catch (requestError) {
      console.error('[TPS WEEKLY ENERGY ERROR]', requestError)
    }
  }, [])

  const loadEnergyData = useCallback(async (start: string, end: string, pageLimit: number) => {
    if (!start || !end) return
    if (start > end) {
      setError('Tanggal mulai tidak boleh melewati tanggal selesai.')
      return
    }
    const dates = datesBetween(start, end)
    if (dates.length > MAX_DATE_RANGE_DAYS) {
      setError(`Rentang tanggal maksimal ${MAX_DATE_RANGE_DAYS} hari.`)
      return
    }

    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setLoading(true)
    setError('')
    setStatus('Mengambil data...')

    try {
      const results = await Promise.all(
        dates.map(async (date) => {
          const params = new URLSearchParams({ tanggal: date, limit: String(pageLimit) })
          const response = await fetch(`/admin/tps/energy?${params}`, {
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`API Monacolisa merespons ${response.status}.`)
          const result = (await response.json()) as EnergyResponse
          if (result.status !== 'success') throw new Error(result.message || 'Gagal mengambil telemetri energi.')
          return Array.isArray(result.data) ? result.data : []
        })
      )
      const combined = results.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      setRecords(combined)
      setStatus(combined.length ? `Diperbarui ${new Date().toLocaleTimeString('id-ID')}` : 'Tidak ada data')
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return
      setRecords([])
      setStatus('Koneksi bermasalah')
      setError(requestError instanceof Error ? requestError.message : 'Gagal terhubung ke API Monacolisa.')
    } finally {
      if (requestController.current === controller) {
        requestController.current = null
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEnergyData(startDate, endDate, 25)
      void loadWeeklyEnergyData()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestController.current?.abort()
    }
  }, [endDate, loadEnergyData, loadWeeklyEnergyData, startDate])

  const latest = records[0]?.measurement
  const voltage = averagePhase(latest?.voltage_v)
  const current = averagePhase(latest?.current_a)
  const thdVoltage = averageAcrossRecords(records, 'thd_voltage_pct')
  const thdCurrent = averageAcrossRecords(records, 'thd_current_pct')
  const chartRecords = records.slice(0, 50)
  const phaseSeries = (field: 'voltage_v' | 'current_a' | 'active_power_w' | 'thd_voltage_pct' | 'thd_current_pct'): ChartSeries[] =>
    (['a', 'b', 'c'] as const).map((phase, index) => ({
      label: `Fasa ${['R', 'S', 'T'][index]}`,
      color: phaseColors[index],
      value: (record) => asNumber(record.measurement?.[field]?.[phase]),
    }))

  const filterData = () => void loadEnergyData(startDate, endDate, limit)

  const [sampahRows, setSampahRows] = useState<SampahRow[]>([])
  const [sampahImportError, setSampahImportError] = useState('')
  const [sampahImporting, setSampahImporting] = useState(false)
  const [aiSummary, setAiSummary] = useState('')
  const [aiSummaryUpdatedAt, setAiSummaryUpdatedAt] = useState('')
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiSummaryError, setAiSummaryError] = useState('')
  const sampahImportInputRef = useRef<HTMLInputElement>(null)

  const handleSampahImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSampahImporting(true)
    setSampahImportError('')
    try {
      const imported = await importSampahExcel(file)
      if (!imported.length) setSampahImportError('Tidak ada data yang berhasil diimpor. Periksa format file.')
      else {
        const response = await fetch('/admin/tps/waste/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: imported }),
        })
        const result = await response.json() as { rows?: SampahRow[]; error?: string }
        if (!response.ok) throw new Error(result.error || 'Gagal menyimpan data sampah.')
        setSampahRows(result.rows ?? [])
      }
    } catch (err) {
      setSampahImportError(err instanceof Error ? err.message : 'Gagal mengimpor file.')
    } finally {
      setSampahImporting(false)
      if (sampahImportInputRef.current) sampahImportInputRef.current.value = ''
    }
  }

  const refreshAiSummary = useCallback(async () => {
    setAiSummaryLoading(true)
    setAiSummaryError('')
    try {
      const response = await fetch('/admin/tps/summary', {
        method: 'POST',
        cache: 'no-store',
      })
      const result = (await response.json()) as { summary?: string; generatedAt?: string; error?: string }
      if (!response.ok || !result.summary) throw new Error(result.error || 'Gagal mengambil kesimpulan AI.')
      setAiSummary(result.summary)
      setAiSummaryUpdatedAt(result.generatedAt ?? '')
    } catch (err) {
      setAiSummaryError(err instanceof Error ? err.message : 'Kesimpulan AI tidak tersedia.')
    } finally {
      setAiSummaryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false
    void fetch('/admin/tps/waste', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { data?: SampahRow[]; error?: string }
        if (!response.ok) throw new Error(result.error || 'Gagal mengambil catatan sampah.')
        if (!cancelled) setSampahRows(result.data ?? [])
      })
      .catch((error) => { if (!cancelled) setSampahImportError(error instanceof Error ? error.message : 'Gagal mengambil catatan sampah.') })
    void refreshAiSummary()
    const interval = window.setInterval(() => void refreshAiSummary(), 2 * 60 * 60 * 1000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [isLoggedIn, refreshAiSummary])

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-400">Monacolisa REST API · Smart Energy</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Depo Sampah Lidah Wetan</h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">IMEI {DEVICE_IMEI}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
            <span
              className={`h-2.5 w-2.5 rounded-full ${loading ? 'animate-pulse bg-amber-500' : error ? 'bg-rose-500' : records.length ? 'bg-emerald-500' : 'bg-slate-400'}`}
            />
            <span>{loading ? 'Mengambil data' : status}</span>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:flex-row md:items-end md:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(160px,1fr)_auto_minmax(160px,1fr)_auto] sm:items-end">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Tanggal mulai
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1.5 block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-teal-900"
              />
            </label>
            <span className="hidden pb-3 text-sm text-slate-400 sm:block">s/d</span>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Tanggal selesai
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-1.5 block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-teal-900"
              />
            </label>
            <button
              type="button"
              onClick={filterData}
              disabled={loading || !startDate || !endDate}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <i className={`bi ${loading ? 'bi-arrow-repeat animate-spin' : 'bi-funnel'}`} aria-hidden="true" />
              Terapkan filter
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://goo.gl/maps/P5emmL1PKBb3Kk2w5"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-700 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              <i className="bi bi-geo-alt" aria-hidden="true" /> Lokasi depo
            </a>
            <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Data <strong className="ml-1 tabular-nums text-teal-800 dark:text-teal-300">{records.length}</strong>
            </div>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <i className="bi bi-exclamation-circle mt-0.5" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Tegangan rerata" value={formatNumber(voltage)} unit="V" tone="border-t-blue-500" />
          <MetricCard title="Arus rerata" value={formatNumber(current, 2)} unit="A" tone="border-t-emerald-600" />
          <MetricCard
            title="Rerata THD (V / I)"
            value={`${formatNumber(thdVoltage, 2)}% / ${formatNumber(thdCurrent, 2)}%`}
            unit=""
            tone="border-t-rose-500"
          />
          <MetricCard
            title="Power factor · Frekuensi"
            value={`${formatNumber(asNumber(latest?.power_factor?.total), 3)} · ${formatNumber(asNumber(latest?.frequency_hz), 2)}`}
            unit="PF / Hz"
            tone="border-t-amber-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartPanel title="Tegangan 3-fasa" unit="Volt (V)" records={chartRecords} series={phaseSeries('voltage_v')} />
          <ChartPanel title="Arus listrik 3-fasa" unit="Ampere (A)" records={chartRecords} series={phaseSeries('current_a')} />
          <ChartPanel title="Daya aktif per fasa" unit="Watt (W)" records={chartRecords} series={phaseSeries('active_power_w')} />
          <ChartPanel
            title="Power factor total"
            unit="Cos φ"
            records={chartRecords}
            series={[{ label: 'PF Total', color: '#d97706', value: (record) => asNumber(record.measurement?.power_factor?.total) }]}
          />
          <ChartPanel title="THD tegangan" unit="Persentase (%)" records={chartRecords} series={phaseSeries('thd_voltage_pct')} />
          <ChartPanel title="THD arus" unit="Persentase (%)" records={chartRecords} series={phaseSeries('thd_current_pct')} />
          <div className="xl:col-span-2">
            <ChartPanel
              title="Frekuensi listrik"
              unit="Hertz (Hz)"
              records={chartRecords}
              series={[{ label: 'Frekuensi', color: '#0284c7', value: (record) => asNumber(record.measurement?.frequency_hz) }]}
            />
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Data pengukuran real-time</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Urutan terbaru lebih dahulu</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                Data per hari
                <select
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-teal-900"
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={filterData}
                disabled={loading}
                title="Muat ulang data"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <i className={`bi bi-arrow-clockwise ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => downloadCsv(records)}
                disabled={!records.length}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-700 px-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950"
              >
                <i className="bi bi-download" aria-hidden="true" /> Ekspor CSV
              </button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-[1320px] w-full border-collapse text-center text-xs text-slate-700 dark:text-slate-300">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th rowSpan={2} className="border-r border-slate-200 px-3 py-2.5 dark:border-slate-700">
                    No
                  </th>
                  <th rowSpan={2} className="border-r border-slate-200 px-4 py-2.5 text-left dark:border-slate-700">
                    Timestamp
                  </th>
                  <th colSpan={3} className="border-r border-slate-200 px-3 py-2 dark:border-slate-700">
                    Tegangan (V)
                  </th>
                  <th colSpan={3} className="border-r border-slate-200 px-3 py-2 dark:border-slate-700">
                    Arus (A)
                  </th>
                  <th colSpan={4} className="border-r border-slate-200 px-3 py-2 dark:border-slate-700">
                    Daya aktif (W)
                  </th>
                  <th rowSpan={2} className="border-r border-slate-200 px-3 py-2.5 dark:border-slate-700">
                    PF
                  </th>
                  <th rowSpan={2} className="border-r border-slate-200 px-3 py-2.5 dark:border-slate-700">
                    Hz
                  </th>
                  <th colSpan={3} className="px-3 py-2">
                    THD tegangan (%)
                  </th>
                </tr>
                <tr className="border-b border-slate-200 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {['R', 'S', 'T', 'R', 'S', 'T', 'R', 'S', 'T', 'Total', 'R', 'S', 'T'].map((label, index) => (
                    <th key={`${index}-${label}`} className="px-3 py-1.5">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && records.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="px-4 py-12 text-slate-500">
                      Mengambil data dari Monacolisa...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="px-4 py-12 text-slate-500">
                      Tidak ada data untuk periode ini.
                    </td>
                  </tr>
                ) : (
                  records.map((record, index) => {
                    const measurement = record.measurement ?? {}
                    const voltageValues = measurement.voltage_v ?? {}
                    const currentValues = measurement.current_a ?? {}
                    const powerValues = measurement.active_power_w ?? {}
                    const thdValues = measurement.thd_voltage_pct ?? {}
                    const values = [
                      voltageValues.a,
                      voltageValues.b,
                      voltageValues.c,
                      currentValues.a,
                      currentValues.b,
                      currentValues.c,
                      powerValues.a,
                      powerValues.b,
                      powerValues.c,
                      powerValues.total,
                      measurement.power_factor?.total,
                      measurement.frequency_hz,
                      thdValues.a,
                      thdValues.b,
                      thdValues.c,
                    ]
                    return (
                      <tr
                        key={`${record.timestamp}-${index}`}
                        className="border-b border-slate-100 hover:bg-teal-50/60 dark:border-slate-800 dark:hover:bg-slate-800/60"
                      >
                        <td className="px-3 py-2.5 text-slate-400">{index + 1}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-left font-mono">{formatTimestamp(record.timestamp)}</td>
                        {values.map((value, valueIndex) => (
                          <td key={valueIndex} className="px-3 py-2.5 tabular-nums">
                            {formatNumber(asNumber(value), 2)}
                          </td>
                        ))}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {isLoggedIn && (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Sampah Masuk &amp; Keluar (Sudah diolah)</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Catatan sampah yang masuk dan sudah diolah</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={sampahImportInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleSampahImport} />
                <button
                  type="button"
                  onClick={() => downloadSampahExcel(sampahRows)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-700 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  <i className="bi bi-file-earmark-excel" aria-hidden="true" /> Ekspor Excel
                </button>
                <button
                  type="button"
                  onClick={() => sampahImportInputRef.current?.click()}
                  disabled={sampahImporting}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-700 px-3 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-950"
                >
                  <i className={`bi ${sampahImporting ? 'bi-arrow-repeat animate-spin' : 'bi-file-earmark-arrow-up'}`} aria-hidden="true" />
                  {sampahImporting ? 'Mengimpor...' : 'Impor Excel'}
                </button>
              </div>
            </div>
            {sampahImportError && (
              <div role="alert" className="m-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {sampahImportError}
              </div>
            )}
            <div className="overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    {SAMPAH_HEADINGS.map((heading) => (
                      <th key={heading} className="px-4 py-3 font-semibold">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampahRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        Belum ada data sampah.
                      </td>
                    </tr>
                  ) : (
                    sampahRows.map((row, index) => (
                      <tr key={`${row.tanggal}-${index}`} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                        <td className="px-4 py-3">{row.tanggal}</td>
                        <td className="px-4 py-3">{row.jamMasuk}</td>
                        <td className="px-4 py-3">{row.sumberSampah}</td>
                        <td className="px-4 py-3">{row.berat}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <i className="bi bi-robot text-teal-700 dark:text-teal-400" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Kesimpulan AI (9router · ringkasan)</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Analisis data TPS otomatis diperbarui tiap 2 jam sekali
                  {aiSummaryUpdatedAt && (
                    <span className="ml-1 text-[11px] text-teal-800 dark:text-teal-300">
                      · Terakhir diperbarui: {new Date(aiSummaryUpdatedAt).toLocaleString('id-ID')}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void refreshAiSummary()}
              disabled={aiSummaryLoading}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-700 px-3 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-500 dark:text-teal-300 dark:hover:bg-teal-950"
            >
              <i className={`bi bi-arrow-repeat ${aiSummaryLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {aiSummaryLoading ? 'Menganalisis...' : 'Perbarui Analisis'}
            </button>
          </div>
          <div className="p-4 sm:p-5">
            {aiSummaryLoading && !aiSummary ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate-500 dark:text-slate-400">
                <i className="bi bi-arrow-repeat animate-spin text-sm text-teal-600" aria-hidden="true" />
                <span>Sedang membuat kesimpulan dengan model ringkasan melalui 9router...</span>
              </div>
            ) : aiSummaryError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <i className="bi bi-exclamation-circle mt-0.5" aria-hidden="true" />
                <span>{aiSummaryError}</span>
              </div>
            ) : aiSummary ? (
              <article
                className="markdown-body max-w-none overflow-x-auto text-[14px] leading-[1.65] text-slate-800 dark:text-slate-200"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(aiSummary) as string) }}
              />
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Belum ada kesimpulan untuk data TPS.</p>
            )}
          </div>
        </section>
      </div>
    </MainLayout>
  )
}
