'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import MainLayout from '../../components/layout/MainLayout'
import { NodeManagerApi, type NodeConfig, type Reading } from '../../../lib/node-manager'

export default function MonitoringNodePage() {
  const params = useParams<{ nodeKey: string }>()
  const nodeKey = params.nodeKey
  const [node, setNode] = useState<NodeConfig[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [config, latest] = await Promise.all([NodeManagerApi.getConfig(), NodeManagerApi.getLatest()])
        if (active) {
          setNode(config.nodes.filter((item) => item.node_key === nodeKey))
          setReadings(latest.readings.filter((item) => item.node_key === nodeKey))
          setError('')
        }
      } catch { if (active) setError('Data monitoring belum tersedia.') }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [nodeKey])
  const info = node[0]
  return <MainLayout><div className="mx-auto max-w-6xl px-5 py-8"><h1 className="text-2xl font-bold">{info?.name ?? 'Monitoring node'}</h1><p className="mt-1 text-slate-500">{info?.location || info?.category || nodeKey}</p>{error && <p role="status" className="mt-4 text-rose-600">{error}</p>}<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{node.filter((item) => item.metric_id && item.metric_enabled).map((metric) => { const value = readings.find((item) => item.metric_key === metric.metric_key); return <article key={metric.metric_key} className="rounded-xl border bg-white p-5 shadow-sm dark:bg-slate-900"><div className="flex items-center gap-2 text-slate-500"><i className={`bi ${metric.icon || 'bi-activity'}`}/>{metric.metric_name}</div><strong className="mt-3 block text-3xl">{value ? `${metric.prefix ?? ''}${value.value.toLocaleString('id-ID')}${metric.suffix ?? (metric.unit ? ` ${metric.unit}` : '')}` : '—'}</strong><small className="mt-2 block text-slate-500">{value ? `Terakhir: ${new Date(value.observed_at ?? value.received_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB` : 'Menunggu data'}</small></article>})}</div>{!error && node.length === 0 && <p className="mt-5">Node tidak ditemukan.</p>}</div></MainLayout>
}
