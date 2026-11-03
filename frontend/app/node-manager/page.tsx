'use client'

import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import MainLayout from '../components/layout/MainLayout'
import { getLoginSession } from '../components/auth/Google'
import { NodeManagerApi, type DashboardCard, type MenuItem, type MonitoringConfig, type NodeConfig } from '../../lib/node-manager'
import bootstrapIconsMap from 'bootstrap-icons/font/bootstrap-icons.json'
import './node-manager.css'

const ALL_ICONS = Object.keys(bootstrapIconsMap)

// ─── helpers ─────────────────────────────────────────────────────────────────
function cardId(nodeKey: string, metricKey: string) { return `${nodeKey}:${metricKey}` }

function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// ─── DraggableCard ────────────────────────────────────────────────────────────
function DraggableCard({
  card, index, label, icon, unit,
  dragRef, onDragStart, onDragOver, onDrop, onRemove, onMoveUp, onMoveDown, isFirst, isLast,
}: {
  card: DashboardCard; index: number; label: string; icon: string; unit: string
  dragRef: React.RefObject<string | null>
  onDragStart: (id: string) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (index: number) => void
  onRemove: (id: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean; isLast: boolean
}) {
  return (
    <div
      className="nm-card-row"
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(card.id) }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(e) }}
      onDrop={(e) => { e.preventDefault(); onDrop(index) }}
      onDragEnd={() => { dragRef.current = null }}
    >
      <span className="nm-drag-handle" aria-hidden="true" title="Seret">⣿</span>
      <i className={`bi ${icon}`} aria-hidden="true" />
      <span className="nm-card-label">{label}<small>{card.nodeKey} · {card.metricKey}{unit ? ` · ${unit}` : ''}</small></span>
      <button type="button" aria-label="Naik" disabled={isFirst} onClick={onMoveUp}>↑</button>
      <button type="button" aria-label="Turun" disabled={isLast} onClick={onMoveDown}>↓</button>
      <button type="button" className="nm-remove" aria-label="Hapus kartu" onClick={() => onRemove(card.id)}>✕</button>
    </div>
  )
}

// ─── IconPickerModal ──────────────────────────────────────────────────────────
function IconPickerModal({
  selected,
  onSelect,
  onClose,
}: {
  selected: string
  onSelect: (iconName: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^bi-/, '')
    if (!q) return ALL_ICONS.slice(0, 180)
    return ALL_ICONS.filter((name) => name.toLowerCase().includes(q)).slice(0, 180)
  }, [search])

  const selectedClean = selected.replace(/^bi-/, '')

  return (
    <div className="nm-icon-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Pilih Ikon">
      <div className="nm-icon-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nm-icon-modal-header">
          <h3>Pilih Ikon ({ALL_ICONS.length} Ikon)</h3>
          <button type="button" className="nm-icon-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="nm-icon-search-wrap">
          <i className="bi bi-search" aria-hidden="true" />
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari ikon... (contoh: water, bolt, temp, cloud, car, wifi)"
          />
          <span className="nm-icon-search-count">{filtered.length} ditampilkan</span>
        </div>
        <div className="nm-icon-grid">
          {filtered.map((name) => {
            const isCurrent = name === selectedClean
            return (
              <button
                key={name}
                type="button"
                className={`nm-icon-item${isCurrent ? ' active' : ''}`}
                onClick={() => { onSelect(`bi-${name}`); onClose() }}
                title={`bi-${name}`}
              >
                <i className={`bi bi-${name}`} aria-hidden="true" />
                <span>{name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── MetricPicker ─────────────────────────────────────────────────────────────
function MetricPicker({ nodes, cards, onAdd }: {
  nodes: NodeConfig[]
  cards: DashboardCard[]
  onAdd: (card: Omit<DashboardCard, 'order'>) => void
}) {
  const [selectedNodeFilter, setSelectedNodeFilter] = useState('all')
  const metrics = useMemo(() => nodes.filter((n) => n.metric_id && n.metric_enabled), [nodes])

  const nodeOptions = useMemo(() => {
    const map = new Map<string, string>()
    metrics.forEach((n) => {
      if (!map.has(n.node_key)) map.set(n.node_key, n.name || n.node_key)
    })
    return Array.from(map.entries()).map(([key, name]) => ({ key, name }))
  }, [metrics])

  const filteredMetrics = useMemo(() => {
    if (selectedNodeFilter === 'all') return metrics
    return metrics.filter((n) => n.node_key === selectedNodeFilter)
  }, [metrics, selectedNodeFilter])

  return (
    <div className="nm-metric-picker">
      <div className="nm-picker-header">
        <p className="nm-picker-hint"><i className="bi bi-plus-circle" /> Klik metrik untuk menambah ke dashboard:</p>
        {nodeOptions.length > 0 && (
          <div className="nm-picker-filter">
            <label htmlFor="nm-node-filter">Filter Node:</label>
            <select
              id="nm-node-filter"
              value={selectedNodeFilter}
              onChange={(e) => setSelectedNodeFilter(e.target.value)}
              aria-label="Filter metrik berdasarkan node"
            >
              <option value="all">Semua Node ({metrics.length})</option>
              {nodeOptions.map((n) => (
                <option key={n.key} value={n.key}>{n.name} ({n.key})</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="nm-picker-grid">
        {filteredMetrics.length === 0 && <span className="nm-empty">Tidak ada metrik untuk filter ini.</span>}
        {filteredMetrics.map((n) => {
          const id = cardId(n.node_key, n.metric_key!)
          const added = cards.some((c) => c.id === id)
          return (
            <button
              key={id}
              type="button"
              className={`nm-picker-chip${added ? ' nm-chip-added' : ''}`}
              disabled={added}
              onClick={() => onAdd({ id, nodeKey: n.node_key, metricKey: n.metric_key!, title: n.metric_name ?? undefined })}
            >
              <i className={`bi ${n.icon || 'bi-activity'}`} />
              <span>{n.metric_name ?? n.metric_key}</span>
              {added && <i className="bi bi-check2" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── DraggableMenuRow ─────────────────────────────────────────────────────────
function DraggableMenuRow({
  item, index, dragRef, onDragStart, onDragOver, onDrop, onToggle, onMoveUp, onMoveDown, isFirst, isLast,
}: {
  item: MenuItem; index: number
  dragRef: React.RefObject<string | null>
  onDragStart: (id: string) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (index: number) => void
  onToggle: (id: string, enabled: boolean) => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean; isLast: boolean
}) {
  return (
    <div
      className="node-manager-menu-row"
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(item.id) }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(e) }}
      onDrop={(e) => { e.preventDefault(); onDrop(index) }}
      onDragEnd={() => { dragRef.current = null }}
    >
      <span className="nm-drag-handle" aria-hidden="true" title="Seret">⣿</span>
      <i className={`bi ${item.icon}`} aria-hidden="true" />
      <span>{item.label}</span>
      <label>
        <input type="checkbox" checked={item.enabled} onChange={(e) => onToggle(item.id, e.target.checked)} /> Tampil
      </label>
      <button type="button" aria-label={`Naikkan ${item.label}`} disabled={isFirst} onClick={onMoveUp}>↑</button>
      <button type="button" aria-label={`Turunkan ${item.label}`} disabled={isLast} onClick={onMoveDown}>↓</button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NodeManagerPage() {
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [nodeKey, setNodeKey] = useState('')
  const [config, setConfig] = useState<MonitoringConfig | null>(null)

  // dashboard cards
  const [cards, setCards] = useState<DashboardCard[]>([])
  const [cardsSaving, setCardsSaving] = useState(false)
  const cardDragRef = useRef<string | null>(null)

  // menu items
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [menuSaving, setMenuSaving] = useState(false)
  const menuDragRef = useRef<string | null>(null)

  // form dropdown states
  const [nodeCategory, setNodeCategory] = useState('environment')
  const [nodeLocation, setNodeLocation] = useState('Kampus Lidah Wetan')
  const [customLocation, setCustomLocation] = useState('')
  const [metricUnit, setMetricUnit] = useState('cm')
  const [metricIcon, setMetricIcon] = useState('bi-activity')
  const [iconModalOpen, setIconModalOpen] = useState(false)

  // registered nodes for dropdown
  const registeredNodes = useMemo(() => {
    if (!config?.nodes) return []
    const map = new Map<string, string>()
    config.nodes.forEach((n) => {
      if (!map.has(n.node_key)) map.set(n.node_key, n.name || n.node_key)
    })
    return Array.from(map.entries()).map(([key, name]) => ({ key, name }))
  }, [config?.nodes])

  useEffect(() => {
    const session = getLoginSession()
    if (session?.role === 'admin') {
      const value = document.cookie.split('; ').find((c) => c.startsWith('unesa_session='))?.split('=').slice(1).join('=')
      if (value) setToken(decodeURIComponent(value))
    }
  }, [])

  useEffect(() => {
    let active = true
    NodeManagerApi.getConfig().then((value) => {
      if (!active) return
      setConfig(value)

      // dashboard cards
      setCards((value.dashboard?.cards ?? []).map((c, i) => ({ ...c, order: i })))

      // menu items
      const existing = value.menu?.items ?? []
      const defaults: MenuItem[] = [
        { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'bi-grid-1x2-fill', order: 0, enabled: true },
        { id: 'air-quality', label: 'Kualitas Udara', path: '/air-quality', icon: 'bi-wind', order: 1, enabled: true },
        { id: 'smart-office', label: 'Smart Office', path: '/smart-office', icon: 'bi-building-gear', order: 2, enabled: true },
        { id: 'vehicles', label: 'Kendaraan & Emisi', path: '/vehicles', icon: 'bi-car-front-fill', order: 3, enabled: true },
      ]
      const merged = new Map(defaults.map((item) => [item.id, item]))
      existing.forEach((item) => merged.set(item.id, item))
      value.nodes.filter((n) => n.enabled).forEach((n, i) =>
        merged.set(`node:${n.node_key}`, { id: `node:${n.node_key}`, label: n.name, path: `/monitoring/${n.node_key}`, icon: 'bi-water', order: defaults.length + i, enabled: true })
      )
      setMenuItems([...merged.values()].sort((a, b) => a.order - b.order))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  // ── dashboard card actions ─────────────────────────────────────────────────
  const addCard = (card: Omit<DashboardCard, 'order'>) =>
    setCards((prev) => [...prev, { ...card, order: prev.length }])

  const removeCard = (id: string) =>
    setCards((prev) => prev.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })))

  const moveCard = (from: number, to: number) =>
    setCards((prev) => reorder(prev, from, to).map((c, i) => ({ ...c, order: i })))

  const saveCards = async () => {
    if (!token) { setMessage('Login admin diperlukan.'); return }
    setCardsSaving(true)
    try {
      await NodeManagerApi.saveConfig('dashboard', { cards: cards.map((c, i) => ({ ...c, order: i })) }, token)
      setMessage('Kartu dashboard berhasil disimpan.')
    } catch { setMessage('Gagal menyimpan kartu dashboard.') }
    finally { setCardsSaving(false) }
  }

  // ── menu actions ───────────────────────────────────────────────────────────
  const moveMenu = (from: number, to: number) =>
    setMenuItems((prev) => reorder(prev, from, to).map((item, i) => ({ ...item, order: i })))

  const saveMenu = async () => {
    if (!token) { setMessage('Login admin diperlukan.'); return }
    setMenuSaving(true)
    try {
      await NodeManagerApi.saveConfig('menu', { items: menuItems.map((item, i) => ({ ...item, order: i })) }, token)
      setMessage('Urutan menu berhasil disimpan.')
    } catch { setMessage('Gagal menyimpan menu.') }
    finally { setMenuSaving(false) }
  }

  // ── form handlers ──────────────────────────────────────────────────────────
  const submitNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const finalLocation = nodeLocation === '__custom__' ? customLocation.trim() : nodeLocation
    try {
      const keyVal = String(form.get('key'))
      await NodeManagerApi.createNode({
        name: form.get('name'),
        key: keyVal,
        category: nodeCategory,
        location: finalLocation || undefined,
      }, token)
      setNodeKey(keyVal)
      setMessage('Node dibuat. Tambahkan metrik di bawah.')
      void NodeManagerApi.getConfig().then(setConfig)
    } catch { setMessage('Gagal membuat node. Pastikan akun admin dan node key unik.') }
  }

  const submitMetric = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const targetKey = String(form.get('nodeKey') || nodeKey)
    try {
      await NodeManagerApi.createMetric(targetKey, {
        key: form.get('key'),
        name: form.get('name'),
        topic: form.get('topic'),
        payloadPath: form.get('payloadPath'),
        unit: metricUnit,
        prefix: form.get('prefix'),
        suffix: form.get('suffix'),
        icon: metricIcon,
        chartType: form.get('chartType'),
      }, token)
      setMessage('Metrik ditambahkan.')
      event.currentTarget.reset()
      void NodeManagerApi.getConfig().then(setConfig)
    } catch { setMessage('Gagal menambahkan metrik.') }
  }

  // ── lookup helpers for card labels ─────────────────────────────────────────
  const metricMeta = (nodeKey: string, metricKey: string) => {
    const row = config?.nodes.find((n) => n.node_key === nodeKey && n.metric_key === metricKey)
    return { label: row?.metric_name ?? metricKey, icon: row?.icon ?? 'bi-activity', unit: row?.unit ?? '' }
  }

  return (
    <MainLayout>
      <div className="node-manager-page">
        <header className="node-manager-intro">
          <h1>Pengelola Monitoring Node</h1>
          <p>Daftarkan sensor, petakan MQTT topic, dan atur tampilan dashboard. Kredensial broker hanya dikelola di konfigurasi server.</p>
        </header>

        {!token && <p className="node-manager-warning">Login admin diperlukan untuk menyimpan konfigurasi.</p>}
        {message && <p role="status" className="node-manager-status">{message}</p>}

        {/* ── top 2-col grid: add node + add metric ── */}
        <div className="node-manager-grid">
          <form onSubmit={submitNode} className="node-manager-panel node-manager-form">
            <h2>Tambah node</h2>
            <p>Tentukan nama, kategori, dan lokasi titik monitoring.</p>
            <input name="name" required placeholder="Nama, mis. Sensor Banjir Ketintang" />
            <input name="key" required pattern="[a-z0-9][a-z0-9_-]{1,95}" placeholder="node-key, mis. banjir-ketintang" />
            <div className="node-manager-form-row">
              <select
                name="category"
                value={nodeCategory}
                onChange={(e) => setNodeCategory(e.target.value)}
                aria-label="Kategori Node"
              >
                <option value="environment">Environment (Lingkungan)</option>
                <option value="flood">Flood (Banjir)</option>
                <option value="weather">Weather (Cuaca & Iklim)</option>
                <option value="energy">Energy (Energi & Listrik)</option>
                <option value="traffic">Traffic (Kendaraan & Emisi)</option>
                <option value="other">Other (Lainnya)</option>
              </select>

              <select
                value={nodeLocation}
                onChange={(e) => setNodeLocation(e.target.value)}
                aria-label="Lokasi Node"
              >
                <option value="Kampus Lidah Wetan">Kampus Lidah Wetan</option>
                <option value="Kampus Ketintang">Kampus Ketintang</option>
                <option value="Smart Office Gedung Rektorat">Smart Office Gedung Rektorat</option>
                <option value="TPS Lidah Wetan">TPS Lidah Wetan</option>
                <option value="Gedung Rektorat">Gedung Rektorat</option>
                <option value="Laboratorium Terpadu">Laboratorium Terpadu</option>
                <option value="Pintu Gerbang Utama">Pintu Gerbang Utama</option>
                <option value="__custom__">Lokasi Lainnya (Kustom)...</option>
              </select>
            </div>
            {nodeLocation === '__custom__' && (
              <input
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                required
                placeholder="Ketik lokasi kustom..."
                aria-label="Nama Lokasi Kustom"
              />
            )}
            <button disabled={!token} className="node-manager-primary">Buat node</button>
          </form>

          <form onSubmit={submitMetric} className="node-manager-panel node-manager-form">
            <h2>Tambah metrik</h2>
            <p>Petakan satu nilai numerik dari payload MQTT ke sebuah kartu.</p>
            {registeredNodes.length > 0 ? (
              <select
                name="nodeKey"
                required
                value={nodeKey || (registeredNodes[0]?.key ?? '')}
                onChange={(e) => setNodeKey(e.target.value)}
                aria-label="Pilih Node Terdaftar"
              >
                {registeredNodes.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.name} ({n.key})
                  </option>
                ))}
              </select>
            ) : (
              <input name="nodeKey" required defaultValue={nodeKey} placeholder="node-key" />
            )}
            <div className="node-manager-form-row">
              <input name="key" required placeholder="metric-key, mis. water-level" />
              <input name="name" required placeholder="Label, mis. Ketinggian Air" />
            </div>
            <input name="topic" required placeholder="MQTT topic" />
            <input name="payloadPath" required placeholder="JSON field path, mis. data.level" />
            <div className="node-manager-form-row">
              <select
                name="unit"
                value={metricUnit}
                onChange={(e) => setMetricUnit(e.target.value)}
                aria-label="Satuan Metrik"
              >
                <option value="">Tanpa satuan (-)</option>
                <option value="cm">cm (Centimeter)</option>
                <option value="m">m (Meter)</option>
                <option value="°C">°C (Derajat Celsius)</option>
                <option value="%">% (Persen)</option>
                <option value="µg/m³">µg/m³ (Partikulat PM)</option>
                <option value="ppm">ppm (Gas Concentration)</option>
                <option value="kWh">kWh (Energi Listrik)</option>
                <option value="W">W (Daya Listrik)</option>
                <option value="V">V (Tegangan Volt)</option>
                <option value="A">A (Arus Ampere)</option>
                <option value="lx">lx (Intensitas Cahaya)</option>
                <option value="km/h">km/h (Kecepatan)</option>
                <option value="m/s">m/s (Kecepatan Angin)</option>
                <option value="hPa">hPa (Tekanan Udara)</option>
                <option value="dB">dB (Kebisingan Suara)</option>
              </select>
              <div className="nm-icon-field">
                <button
                  type="button"
                  className="nm-icon-trigger"
                  onClick={() => setIconModalOpen(true)}
                  title="Pilih ikon dari koleksi lengkap"
                  aria-label="Pilih ikon metrik"
                >
                  <i className={`bi ${metricIcon}`} aria-hidden="true" />
                  <span>{metricIcon}</span>
                  <span className="nm-icon-arrow">Pilih ▾</span>
                </button>
              </div>
            </div>
            <div className="node-manager-form-row">
              <input name="prefix" placeholder="Awalan (opsional)" />
              <input name="suffix" placeholder="Akhiran (opsional)" />
            </div>
            <select name="chartType">
              <option value="none">Tanpa chart</option>
              <option value="line">Line</option>
              <option value="bar">Bar</option>
            </select>
            <button disabled={!token} className="node-manager-primary">Tambah metrik</button>
          </form>
        </div>

        {/* ── dashboard card editor ── */}
        <section className="node-manager-panel nm-section-full">
          <div className="nm-section-header">
            <div>
              <h2>Kartu dashboard</h2>
              <p>Seret untuk mengurutkan. Pilih metrik dari daftar di bawah untuk menambah kartu.</p>
            </div>
            <button type="button" disabled={!token || cardsSaving} onClick={() => void saveCards()} className="node-manager-primary">
              {cardsSaving ? 'Menyimpan…' : 'Simpan dashboard'}
            </button>
          </div>

          <div className="nm-card-list">
            {cards.length === 0 && (
              <p className="nm-empty">Belum ada kartu. Tambah dari daftar metrik di bawah.</p>
            )}
            {cards.map((card, index) => {
              const { label, icon, unit } = metricMeta(card.nodeKey, card.metricKey)
              return (
                <DraggableCard
                  key={card.id}
                  card={card}
                  index={index}
                  label={label}
                  icon={icon}
                  unit={unit}
                  dragRef={cardDragRef}
                  onDragStart={(id) => { cardDragRef.current = id }}
                  onDragOver={() => undefined}
                  onDrop={(to) => {
                    const from = cards.findIndex((c) => c.id === cardDragRef.current)
                    if (from !== -1) moveCard(from, to)
                    cardDragRef.current = null
                  }}
                  onRemove={removeCard}
                  onMoveUp={() => moveCard(index, index - 1)}
                  onMoveDown={() => moveCard(index, index + 1)}
                  isFirst={index === 0}
                  isLast={index === cards.length - 1}
                />
              )
            })}
          </div>

          <MetricPicker nodes={config?.nodes ?? []} cards={cards} onAdd={addCard} />
        </section>

        {/* ── menu editor ── */}
        <section className="node-manager-panel nm-section-full">
          <div className="nm-section-header">
            <div>
              <h2>Urutan menu</h2>
              <p>Seret atau gunakan tombol ↑ ↓ untuk mengurutkan. Centang untuk menampilkan di sidebar.</p>
            </div>
            <button type="button" disabled={!token || menuSaving} onClick={() => void saveMenu()} className="node-manager-primary node-manager-save">
              {menuSaving ? 'Menyimpan…' : 'Simpan menu'}
            </button>
          </div>
          <div className="node-manager-menu-list">
            {menuItems.map((item, index) => (
              <DraggableMenuRow
                key={item.id}
                item={item}
                index={index}
                dragRef={menuDragRef}
                onDragStart={(id) => { menuDragRef.current = id }}
                onDragOver={() => undefined}
                onDrop={(to) => {
                  const from = menuItems.findIndex((m) => m.id === menuDragRef.current)
                  if (from !== -1) moveMenu(from, to)
                  menuDragRef.current = null
                }}
                onToggle={(id, enabled) => setMenuItems((prev) => prev.map((m) => m.id === id ? { ...m, enabled } : m))}
                onMoveUp={() => moveMenu(index, index - 1)}
                onMoveDown={() => moveMenu(index, index + 1)}
                isFirst={index === 0}
                isLast={index === menuItems.length - 1}
              />
            ))}
          </div>
        </section>

        {iconModalOpen && (
          <IconPickerModal
            selected={metricIcon}
            onSelect={(name) => setMetricIcon(name)}
            onClose={() => setIconModalOpen(false)}
          />
        )}
      </div>
    </MainLayout>
  )
}
