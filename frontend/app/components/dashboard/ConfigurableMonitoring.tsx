'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { NodeManagerApi, type DashboardCard, type MonitoringConfig, type Reading } from '../../../lib/node-manager'
import { getLoginSession } from '../auth/Google'
import './configurable-monitoring.css'

function cardId(nodeKey: string, metricKey: string) { return `${nodeKey}:${metricKey}` }

type HistoryPoint = { value: number; received_at: string; observed_at: string | null }

function Sparkline({ nodeKey, metricKey, label, unit }: { nodeKey: string; metricKey: string; label: string; unit: string }) {
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [active, setActive] = useState<number | null>(null)
  const [tableOpen, setTableOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const loadHistory = useCallback(async () => {
    try {
      const result = await NodeManagerApi.getHistory(nodeKey, metricKey, 12)
      setPoints(result.readings.filter((point) => Number.isFinite(Number(point.value))))
      setFailed(false)
    } catch { setFailed(true) }
  }, [nodeKey, metricKey])
  useEffect(() => {
    const initial = window.setTimeout(() => void loadHistory(), 0)
    const timer = window.setInterval(() => void loadHistory(), 60000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [loadHistory])

  const width = 240
  const height = 48
  const pad = 6
  const values = points.map((point) => Number(point.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const coords = values.map((value, index) => ({
    x: pad + (values.length <= 1 ? (width - pad * 2) : index * (width - pad * 2) / (values.length - 1)),
    y: height - pad - ((value - min) / span) * (height - pad * 2),
  }))
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const formatTime = (point: HistoryPoint) => new Date(point.observed_at ?? point.received_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
  const formatValue = (value: number) => `${value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`
  const chooseNearest = (event: PointerEvent<SVGSVGElement>) => {
    if (!coords.length) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) * width / bounds.width
    let nearest = 0
    coords.forEach((point, index) => { if (Math.abs(point.x - x) < Math.abs(coords[nearest].x - x)) nearest = index })
    setActive(nearest)
  }
  const handleKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setActive((current) => Math.max(0, Math.min(coords.length - 1, (current ?? coords.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))))
  }

  if (points.length < 2) return <div className="config-sparkline-empty" aria-live="polite">{failed ? 'Riwayat tren tidak tersedia.' : points.length === 1 ? 'Riwayat tren: perlu lebih banyak data.' : 'Riwayat tren belum tersedia.'}</div>
  const selected = active === null ? null : points[active]
  return <figure className="config-sparkline" aria-label={`Tren ${label}, ${points.length} pembacaan terakhir`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik garis ${label}: ${formatValue(values[0])} hingga ${formatValue(values[values.length - 1])}`} onPointerMove={chooseNearest} onPointerLeave={() => setActive(null)} onFocus={() => setActive((current) => current ?? points.length - 1)} onKeyDown={handleKey} tabIndex={0}>
      <path d={line} className="config-sparkline-line" fill="none" />
      {coords.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === points.length - 1 || active === index ? 4 : 2} className={index === points.length - 1 ? 'config-sparkline-point-current' : 'config-sparkline-point'} />)}
      {active !== null && coords[active] && <line x1={coords[active].x} x2={coords[active].x} y1={pad} y2={height - pad} className="config-sparkline-crosshair" />}
      {active !== null && coords[active] && <circle cx={coords[active].x} cy={coords[active].y} r="5" className="config-sparkline-point-current" />}
    </svg>
    <figcaption><span>{selected ? `${formatTime(selected)} — ${formatValue(Number(selected.value))}` : `${points.length} pembacaan terakhir`}</span><button type="button" aria-expanded={tableOpen} onClick={() => setTableOpen((open) => !open)}>{tableOpen ? 'Tutup data' : 'Lihat data'}</button></figcaption>
    {tableOpen && <table className="config-sparkline-table"><caption>Riwayat {label}</caption><thead><tr><th scope="col">Waktu (WIB)</th><th scope="col">Nilai</th></tr></thead><tbody>{points.slice().reverse().map((point, index) => <tr key={`${point.received_at}-${index}`}><td>{formatTime(point)}</td><td>{formatValue(Number(point.value))}</td></tr>)}</tbody></table>}
  </figure>
}

export default function ConfigurableMonitoring() {
  const [config, setConfig] = useState<MonitoringConfig | null>(null)
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<DashboardCard[]>([])
  const [dragged, setDragged] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<ReturnType<typeof getLoginSession>>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    const refreshUser = () => {
      setUser(getLoginSession())
      const raw = document.cookie.split('; ').find((item) => item.startsWith('unesa_session='))?.split('=').slice(1).join('=')
      setToken(raw ? decodeURIComponent(raw) : '')
    }
    const timer = window.setTimeout(refreshUser, 0)
    window.addEventListener('unesa-auth-changed', refreshUser)
    return () => { window.clearTimeout(timer); window.removeEventListener('unesa-auth-changed', refreshUser) }
  }, [])

  const dashboardCards = config?.dashboard?.cards ?? []
  const publishedCards = dashboardCards.slice().sort((a, b) => a.order - b.order)

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextReadings] = await Promise.all([NodeManagerApi.getConfig(), NodeManagerApi.getLatest()])
      setConfig(nextConfig)
      setReadings(nextReadings.readings)
      setError('')
    } catch {
      setError('Monitoring node service belum tersedia.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 15000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [load])

  const metrics = useMemo(() => (config?.nodes ?? []).filter((node) => node.metric_id && node.metric_enabled).map((node) => ({
    id: cardId(node.node_key, node.metric_key!), node, reading: readings.find((reading) => reading.node_key === node.node_key && reading.metric_key === node.metric_key),
  })), [config, readings])
  const displayed = (editing ? draft : publishedCards).map((card) => metrics.find((metric) => metric.id === card.id)).filter(Boolean) as typeof metrics
  const saveable = token.length > 0 && user?.role === 'admin' && Boolean(config)

  const moveCard = (from: number, to: number) => setDraft((current) => {
    if (to < 0 || to >= current.length || from === to) return current
    const next = [...current]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next.map((card, order) => ({ ...card, order }))
  })

  const save = async () => {
    if (!saveable) { setError('Sesi admin diperlukan untuk menyimpan dashboard.'); return }
    setSaving(true)
    try {
      await NodeManagerApi.saveConfig('dashboard', { cards: draft }, token)
      setConfig((current) => current ? { ...current, dashboard: { cards: draft } } : current)
      setEditing(false)
      setError('')
    } catch { setError('Gagal menyimpan konfigurasi; pastikan sesi admin valid.') }
    finally { setSaving(false) }
  }

  return <section className="config-monitoring" aria-labelledby="config-monitoring-title">
    <div className="config-monitoring-heading">
      <div><h3 id="config-monitoring-title">Monitoring Node</h3><p>Flood, lingkungan, cuaca, dan sensor yang dikonfigurasi admin.</p></div>
      {user?.role === 'admin' && !editing && <button type="button" onClick={() => {
        setDraft(publishedCards.length ? publishedCards : metrics.map((metric, order) => ({ id: metric.id, nodeKey: metric.node.node_key, metricKey: metric.node.metric_key!, order })))
        setEditing(true)
      }}>Edit dashboard</button>}
      {editing && <div className="config-editor-actions"><button type="button" onClick={() => setEditing(false)}>Batal</button><button type="button" disabled={saving || !saveable} onClick={() => void save()}>{saving ? 'Menyimpan…' : 'Simpan'}</button></div>}
    </div>
    {error && <p role="status" className="config-monitoring-error">{error}</p>}
    {loading && <p>Memuat monitoring…</p>}
    {!loading && metrics.length === 0 && <p>Belum ada node atau metrik. Admin dapat menambahkannya melalui pengelola node.</p>}
    {editing && <div className="config-card-picker"><strong>Tambah kartu:</strong>{metrics.filter((metric) => !draft.some((card) => card.id === metric.id)).map((metric) => <button key={metric.id} type="button" onClick={() => setDraft((current) => [...current, { id: metric.id, nodeKey: metric.node.node_key, metricKey: metric.node.metric_key!, order: current.length }])}>+ {metric.node.metric_name}</button>)}</div>}
    <div className="config-monitoring-grid">
      {displayed.map(({ id, node, reading }, index) => <article key={id} className="config-monitoring-card" draggable={editing} onDragStart={() => setDragged(id)} onDragOver={(event) => { if (editing) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (dragged) moveCard(draft.findIndex((card) => card.id === dragged), index); setDragged(null) }}>
        <div className="config-monitoring-card-top"><i className={`bi ${node.icon || 'bi-activity'}`} aria-hidden="true"/><span>{node.name}</span>{editing && <button type="button" aria-label={`Hapus ${node.metric_name} dari dashboard`} onClick={() => setDraft((current) => current.filter((card) => card.id !== id).map((card, order) => ({ ...card, order })))}>Hapus</button>}</div>
        <h4>{node.metric_name}</h4>
        <strong>{reading ? `${node.prefix ?? ''}${Number(reading.value).toLocaleString('id-ID', { maximumFractionDigits: 2 })}${node.suffix ?? (node.unit ? ` ${node.unit}` : '')}` : '—'}</strong>
        <small>{reading ? `Data: ${new Date(reading.observed_at ?? reading.received_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB` : 'Menunggu data'}</small>
        {node.chart_type === 'line' && <Sparkline nodeKey={node.node_key} metricKey={node.metric_key!} label={node.metric_name ?? node.metric_key!} unit={node.unit ?? node.suffix ?? ''} />}
        {editing && <div className="config-card-moves"><button type="button" onClick={() => moveCard(index, index - 1)} disabled={index === 0}>Naik</button><button type="button" onClick={() => moveCard(index, index + 1)} disabled={index === displayed.length - 1}>Turun</button><span>Seret untuk mengurutkan</span></div>}
      </article>)}
    </div>
    {!editing && publishedCards.length === 0 && metrics.length > 0 && <p>Admin belum memilih kartu untuk dashboard.</p>}
  </section>
}
