'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTheme } from './Theme'
import GoogleLoginButton, { logout, isLoggedIn as checkIsLoggedIn, getLoginSession } from '../auth/Google'

type SidebarProps = {
  mobileOpen: boolean
  onClose: () => void
}

// Interface untuk data user dari cookie
interface UserSession {
  uid: string
  name: string
  email: string
  picture: string
  role: 'mahasiswa' | 'dosen' //'adm'
}

const pages = {
  dashboard: '/',
  'lidah-wetan': '/lidah-wetan',
  ketintang: '/ketintang',
  'air-quality': '/air-quality',
  vehicles: '/vehicles',
  'digital-twin': '/digital-twin',
  reports: '/reports',
  'smart-office': '/smart-office',
  'pju-lidah-wetan': '/pju-lidah-wetan',
  'tps-lidah-wetan': '/tps-lidah-wetan',
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { theme } = useTheme()
  const darkMode = theme === 'dark'
  const pathname = usePathname()
  const router = useRouter()

  const isFloodActive = pathname === '/lidah-wetan' || pathname === '/ketintang'
  const [floodOpen, setFloodOpen] = useState(true)
  const [canSeeSecret, setCanSeeSecret] = useState(false)

  // State untuk melacak status login & data user
  const [user, setUser] = useState<UserSession | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false)

  // Periksa sesi lewat helper autentikasi yang dipakai bersama.
  useEffect(() => {
    const refreshAuthState = () => {
      const session = getLoginSession()
      setUser(session)
      setIsLoggedIn(checkIsLoggedIn())
    }

    refreshAuthState()
    window.addEventListener('unesa-auth-changed', refreshAuthState)

    return () => window.removeEventListener('unesa-auth-changed', refreshAuthState)
  }, [])

  // Fungsi untuk menangani Logout
  const handleLogout = () => {
    // Bersihkan cookie dari subdomain induk .nurutomo.my.id
    logout()
    setUser(null)
    setIsLoggedIn(false)
    router.push('/')
  }

  useEffect(() => {
    if (isFloodActive) {
      setFloodOpen(true)
    }
  }, [isFloodActive])

  useEffect(() => {
    const refreshSecretAccess = () => {
      const session = getLoginSession()
      setCanSeeSecret(session?.role === 'mahasiswa')
    }

    refreshSecretAccess()
    window.addEventListener('unesa-auth-changed', refreshSecretAccess)

    return () => window.removeEventListener('unesa-auth-changed', refreshSecretAccess)
  }, [pathname])

  const goTo = (page: keyof typeof pages) => {
    router.push(pages[page])
    onClose()
  }

  const active = (page: keyof typeof pages) => {
    if (page === 'dashboard') return pathname === '/'
    return pathname === pages[page]
  }

  return (
    <>
      {/* MOBILE OVERLAY */}
      <div className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`} id="sidebarOverlay" onClick={onClose} />

      {/* SIDEBAR */}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} id="sidebar">
        <div className="sidebar-header">
          <div className="brand-logo">
            <img src="/assets/img/lo.png" alt="Logo" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} />
          </div>

          <div className="brand-text">
            <strong>USSC</strong>
            <span>Universitas Negeri Surabaya</span>
          </div>
        </div>

        <nav className="sidebar-menu">
          {/* DASHBOARD */}
          <button className={`menu-item ${active('dashboard') ? 'active' : ''}`} data-page="dashboard" onClick={() => goTo('dashboard')}>
            <i className="bi bi-grid-1x2-fill"></i>
            <span>Dashboard</span>
          </button>

          {/* BANJIR */}
          <div className="menu-group">
            <button className={`menu-item submenu-toggle ${floodOpen ? 'open' : ''}`} id="floodMenu" onClick={() => setFloodOpen(!floodOpen)}>
              <i className="bi bi-water"></i>
              <span>Pemantauan Lingkungan</span>
              <i className="bi bi-chevron-down menu-arrow"></i>
            </button>

            <div className={`submenu ${floodOpen ? 'open' : ''}`} id="floodSubmenu">
              <button className={`submenu-item ${active('lidah-wetan') ? 'active' : ''}`} data-page="lidah-wetan" onClick={() => goTo('lidah-wetan')}>
                <i className="bi bi-geo-alt"></i>
                <span>Lidah Wetan</span>
              </button>

              <button className={`submenu-item ${active('ketintang') ? 'active' : ''}`} data-page="ketintang" onClick={() => goTo('ketintang')}>
                <i className="bi bi-geo-alt"></i>
                <span>Ketintang</span>
              </button>
            </div>
          </div>

          {/* KUALITAS UDARA */}
          <button className={`menu-item ${active('air-quality') ? 'active' : ''}`} data-page="air-quality" onClick={() => goTo('air-quality')}>
            <i className="bi bi-wind"></i>
            <span>Kualitas Udara</span>
          </button>

          {/* KENDARAAN */}
          <button className={`menu-item ${active('vehicles') ? 'active' : ''}`} data-page="vehicles" onClick={() => goTo('vehicles')}>
            <i className="bi bi-car-front-fill"></i>
            <span>Pemantauan Kendaraan & Emisi</span>
          </button>

          {/* DIGITAL TWIN */}
          {/*<button className={`menu-item ${active('digital-twin') ? 'active' : ''}`} data-page="digital-twin" onClick={() => goTo('digital-twin')}>
            <i className="bi bi-bounding-box"></i>
            <span>Digital Twin</span>
          </button>*/}


          <button
            className={`menu-item ${active('smart-office') ? 'active' : ''}`}
            data-page="smart-office"
            onClick={() => goTo('smart-office')}
          >
            <i className="bi bi-building-gear"></i>
            <span>Smart Office</span>
          </button>

          {/* PJU LIDAH WETAN */}
          <button
            className={`menu-item ${active('pju-lidah-wetan') ? 'active' : ''}`}
            data-page="pju-lidah-wetan"
            onClick={() => goTo('pju-lidah-wetan')}
          >
            <i className="bi bi-lightbulb"></i>
            <span>PJU Lidah Wetan</span>
          </button>

          {/* TPS LIDAH WETAN */}
          <button
            className={`menu-item ${active('tps-lidah-wetan') ? 'active' : ''}`}
            data-page="tps-lidah-wetan"
            onClick={() => goTo('tps-lidah-wetan')}
          >
            <i className="bi bi-recycle"></i>
            <span>TPS Lidah Wetan</span>
          </button>

          {canSeeSecret && (
            <>
              <a href="/admin" className="menu-item">
                <i className="bi bi-person"></i>
                <span>Secret</span>
              </a>

              {/* RIWAYAT & EKSPOR DATA */}
              <button className={`menu-item ${active('reports') ? 'active' : ''}`} data-page="reports" onClick={() => goTo('reports')}>
                <i className="bi bi-file-earmark-arrow-down-fill"></i>
                <span>Riwayat & Ekspor Data</span>
              </button>
            </>
          )}
        </nav>

        {/* SIDEBAR FOOTER */}
        <div className="sidebar-footer">
          {/* AREA AUTENTIKASI DENGAN KONDISI LOGIN */}
          <div className="flex w-full items-center justify-center">
            {isLoggedIn && user ? (
              // Tampilan Profil & Tombol Logout jika User Sudah Login
              <div className="flex items-center gap-3">
                <img
                  src={user.picture}
                  alt={user.name}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-slate-300 object-cover shadow-sm"
                  title={`${user.name} (${user.role})`}
                />
                <div className="hidden md:flex flex-col text-left">
                  <span className={`text-xs font-bold leading-none ${darkMode ? 'text-white' : 'text-slate-900'}`}>{user.name}</span>
                  <span className={`text-[10px] capitalize font-medium ${user.role === 'dosen' ? 'text-sky-500' : 'text-emerald-500'}`}>
                    {user.role}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className={`flex items-center justify-center h-9 px-3 text-xs font-semibold rounded-xl border transition-all duration-200 ${
                    darkMode
                      ? 'border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-900/30'
                      : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                  title="Keluar dari Akun"
                >
                  <i className="bi bi-box-arrow-right sm:mr-1.5 text-sm" />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </div>
            ) : (
              // Tampilkan Tombol Google Login jika Belum Login
              <GoogleLoginButton
                onLoginSuccess={(userData) => {
                  setUser(userData)
                  setIsLoggedIn(true)
                  console.log('Login berhasil di Navbar:', userData)
                }}
                onLoginFailure={(error) => {
                  console.error('Login gagal di Navbar:', error)
                }}
              />
            )}
          </div>

          <div className="sidebar-version">Smart Sustainability Campus v1.0</div>
        </div>
      </aside>
    </>
  )
}
