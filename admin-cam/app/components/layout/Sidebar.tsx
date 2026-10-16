'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTheme } from './Theme'
import './side.css'
// import GoogleLoginButton, { logout, isLoggedIn as checkIsLoggedIn, getLoginSession } from '../auth/Google'

type SidebarProps = {
  mobileOpen: boolean
  onClose: () => void
}

// Interface untuk data user dari cookie
// interface UserSession {
//   uid: string
//   name: string
//   email: string
//   picture: string
//   role: 'mahasiswa' | 'dosen' //'adm'
// }

const pages = {
  dashboard: '/',
  'lidah-wetan': '/lidah-wetan',
  ketintang: '/ketintang',
  'air-quality': '/air-quality',
  vehicles: '/vehicles',
  'digital-twin': '/digital-twin',
  reports: '/reports',
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
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  // State untuk melacak status login & data user
  // const [user, setUser] = useState<UserSession | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false)

  // Periksa sesi lewat helper autentikasi yang dipakai bersama.
  // useEffect(() => {
  //   const refreshAuthState = () => {
  //     const session = getLoginSession()
  //     setUser(session)
  //     setIsLoggedIn(checkIsLoggedIn())
  //   }

  //   refreshAuthState()
  //   window.addEventListener('unesa-auth-changed', refreshAuthState)

  //   return () => window.removeEventListener('unesa-auth-changed', refreshAuthState)
  // }, [])

  // // Fungsi untuk menangani Logout
  // const handleLogout = () => {
  //   // Bersihkan cookie dari subdomain induk .nurutomo.my.id
  //   logout()
  //   setUser(null)
  //   setIsLoggedIn(false)
  //   router.push('/')
  // }

  useEffect(() => {
    if (isFloodActive) {
      setFloodOpen(true)
    }
  }, [isFloodActive])

  // useEffect(() => {
  //   const refreshSecretAccess = () => {
  //     const session = getLoginSession()
  //     setCanSeeSecret(session?.role === 'mahasiswa')
  //   }

  //   refreshSecretAccess()
  //   window.addEventListener('unesa-auth-changed', refreshSecretAccess)

  //   return () => window.removeEventListener('unesa-auth-changed', refreshSecretAccess)
  // }, [pathname])

  const goTo = (page: keyof typeof pages) => {
    router.push(pages[page])
    onClose()
  }

  
  const handleSettings = () => {
    router.push('/settings')
    onClose()
  }

  const handleLogout = async () => {
    if (logoutLoading) return

    const confirmed = window.confirm(
      'Apakah Anda yakin ingin keluar dari akun USSC?'
    )

    if (!confirmed) return

    setLogoutLoading(true)
    setLogoutError('')

    try {
      const response = await fetch('/api/cctv/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error('Logout gagal. Silakan coba kembali.')
      }

      setIsLoggedIn(false)
      onClose()
      router.replace('/login')
      router.refresh()
    } catch (error) {
      setLogoutError(
        error instanceof Error
          ? error.message
          : 'Tidak dapat terhubung ke server.'
      )
    } finally {
      setLogoutLoading(false)
    }
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
            <img src="/assets/img/lo.png" alt="Logo" loading="lazy" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} />
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
              <a href="https://ussc.nurutomo.my.id" target="_blank" rel="noopener noreferrer" className="menu-item">
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
        
        {/* MENU BAWAH SIDEBAR */}
          <div className="sidebar-footer">
            <button
              type="button"
              className={`menu-item ${pathname === '/settings' ? 'active' : ''}`}
              onClick={handleSettings}
            >
              <i className="bi bi-gear-fill"></i>
              <span>Pengaturan</span>
            </button>

            {logoutError && (
              <p
                role="alert"
                style={{
                  padding: '8px 12px',
                  color: '#dc2626',
                  fontSize: '12px',
                }}
              >
                {logoutError}
              </p>
            )}

            <button
              type="button"
              className="menu-item"
              onClick={handleLogout}
              disabled={logoutLoading}
              style={{
                color: logoutLoading ? '#94a3b8' : '#dc2626',
                opacity: logoutLoading ? 0.7 : 1,
              }}
            >
              <i className="bi bi-box-arrow-right"></i>
              <span>
                {logoutLoading ? 'Sedang keluar...' : 'Logout'}
              </span>
            </button>
          </div>


      </aside>
    </>
  )
}
