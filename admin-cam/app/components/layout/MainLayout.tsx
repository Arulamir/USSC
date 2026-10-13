'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

type MainLayoutProps = {
  children: React.ReactNode
}

const pageInfo: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Dashboard',
    subtitle: 'Smart Sustainability Campus',
  },
  '/config-camera': {
    title: 'Pemantauan Banjir',
    subtitle: 'Monitoring kondisi lingkungan Lidah Wetan',
  },
  '/user': {
    title: 'user',
    subtitle: 'Monitoring kondisi lingkungan Ketintang',
  },
  '/admin': {
    title: 'admin',
    subtitle: 'Monitoring kualitas udara lingkungan Direktorat',
  },
  '/master': {
    title: 'admin master',
    subtitle: 'Monitoring kendaraan dan estimasi emisi',
  },
  
  
}

export default function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname()
    if (pathname === '/login') {
    return <>{children}</>
  }
  const [mobileOpen, setMobileOpen] = useState(false)

  const info = pageInfo[pathname] ?? pageInfo['/']

  return (
    <div className="min-h-screen bg-[#f6f9fc] text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <main className="min-h-screen bg-[#f6f9fc] text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100 lg:ml-[270px]">
        <Navbar title={info.title} subtitle={info.subtitle} onMenuClick={() => setMobileOpen(true)} />

        <div className="transition-colors duration-300">{children}</div>

        <footer className="border-t border-slate-200 px-5 py-5 text-center text-xs text-slate-400 transition-colors duration-300 dark:border-slate-700 dark:text-slate-500 lg:px-8">
          © 2026 Smart Sustainability Campus / Universitas Negeri Surabaya
        </footer>
      </main>
    </div>
  )
}
