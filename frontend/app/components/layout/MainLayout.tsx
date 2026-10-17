'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import MonitoringStyles from './MonitoringStyles'
import '../../monitoring.css'

type MainLayoutProps = {
  children: React.ReactNode
}

const pageInfo: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Dashboard',
    subtitle: 'Smart Sustainability Campus',
  },
  '/lidah-wetan': {
    title: 'Pemantauan Banjir',
    subtitle: 'Monitoring kondisi lingkungan Lidah Wetan',
  },
  '/ketintang': {
    title: 'Pemantauan Banjir',
    subtitle: 'Monitoring kondisi lingkungan Ketintang',
  },
  '/air-quality': {
    title: 'Kualitas Udara',
    subtitle: 'Monitoring kualitas udara lingkungan Direktorat',
  },
  '/vehicles': {
    title: 'Kendaraan & Emisi',
    subtitle: 'Monitoring kendaraan dan estimasi emisi',
  },
  '/digital-twin': {
    title: 'Digital Twin',
    subtitle: 'Visualisasi kendaraan secara realtime',
  },
  '/reports': {
    title: 'Riwayat & Ekspor Data',
    subtitle: 'Riwayat monitoring dan pengunduhan data',
  },
  '/smart-office': {
    title: 'Smart Office',
    subtitle: 'Monitoring energi dan kontrol perangkat kantor',
  },
  '/pju-lidah-wetan': {
    title: 'PJU Lidah Wetan',
    subtitle: 'Monitoring kondisi PJU Lidah Wetan',
  },
  '/tps-lidah-wetan': {
    title: 'TPS Lidah Wetan',
    subtitle: 'Monitoring energi listrik Depo Sampah Lidah Wetan',
  },
}

export default function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const info = pageInfo[pathname] ?? pageInfo['/']

  return (
    <div className="min-h-screen bg-[#f6f9fc] text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <main className="min-h-screen bg-[#f6f9fc] text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100 lg:ml-[270px]">
        <Navbar title={info.title} subtitle={info.subtitle} onMenuClick={() => setMobileOpen(true)} />

        <div className="ussc-visuals transition-colors duration-300">
          <MonitoringStyles />
          {children}
        </div>

        <footer className="border-t border-slate-200 px-5 py-5 text-center text-xs text-slate-400 transition-colors duration-300 dark:border-slate-700 dark:text-slate-500 lg:px-8">
          © 2026 Smart Sustainability Campus / Universitas Negeri Surabaya
        </footer>
      </main>
    </div>
  )
}
