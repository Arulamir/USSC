'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useTheme } from './Theme'
import GoogleLoginButton, { logout, isLoggedIn as checkIsLoggedIn, getLoginSession } from '../auth/Google'
import { NodeManagerApi, type MenuItem } from '../../../lib/node-manager'
import Cookies from 'js-cookie'

type SidebarProps = { mobileOpen: boolean; onClose: () => void }
interface UserSession { uid: string; name: string; email: string; picture: string; role: 'admin' | 'mahasiswa' | 'dosen' }
type PageKey = 'admin-users' | 'reports' | 'node-manager'

const baseItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'bi-grid-1x2-fill', order: 0, enabled: true },
  { id: 'flood-lidah', label: 'Lidah Wetan', path: '/lidah-wetan', icon: 'bi-geo-alt', order: 1, enabled: true },
  { id: 'flood-ketintang', label: 'Ketintang', path: '/ketintang', icon: 'bi-geo-alt', order: 2, enabled: true },
  { id: 'air-quality', label: 'Kualitas Udara', path: '/air-quality', icon: 'bi-wind', order: 3, enabled: true },
  { id: 'vehicles', label: 'Pemantauan Kendaraan & Emisi', path: '/vehicles', icon: 'bi-car-front-fill', order: 4, enabled: true },
  { id: 'smart-office', label: 'Smart Office', path: '/smart-office', icon: 'bi-building-gear', order: 5, enabled: true },
  { id: 'pju-lidah-wetan', label: 'Digital Twin', path: '/pju-lidah-wetan', icon: 'bi-cpu', order: 6, enabled: true },
  { id: 'tps-lidah-wetan', label: 'TPS Lidah Wetan', path: '/tps-lidah-wetan', icon: 'bi-recycle', order: 7, enabled: true },
]

function isMenuItem(value: unknown): value is MenuItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<MenuItem>
  return typeof item.id === 'string' && typeof item.label === 'string' && item.label.length <= 80
    && typeof item.path === 'string' && /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(item.path)
    && typeof item.icon === 'string' && /^bi-[a-z0-9-]+$/.test(item.icon)
    && typeof item.order === 'number' && typeof item.enabled === 'boolean'
}

export async function saveConfiguredMenu(items: MenuItem[]) {
  const token = Cookies.get('unesa_session')
  if (!token) throw new Error('Admin session required')
  await NodeManagerApi.saveConfig('menu', { items }, decodeURIComponent(token))
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { theme } = useTheme()
  const darkMode = theme === 'dark'
  const pathname = usePathname()
  const router = useRouter()
  const [menuItems, setMenuItems] = useState<MenuItem[]>(baseItems)
  const [floodOpen, setFloodOpen] = useState(true)
  const [adminOpen, setAdminOpen] = useState(true)
  const [canSeeSecret, setCanSeeSecret] = useState(false)
  const [user, setUser] = useState<UserSession | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const isAdminActive = pathname === '/admin-users' || pathname === '/admin' || pathname === '/reports' || pathname === '/node-manager'

  const refreshAuthState = useCallback(() => {
    const session = getLoginSession()
    setUser(session)
    setIsLoggedIn(checkIsLoggedIn())
    setCanSeeSecret(session?.role === 'admin')
  }, [])

  useEffect(() => {
    let active = true
    NodeManagerApi.getConfig().then((result) => {
      if (!active || !Array.isArray(result.menu?.items)) return
      const merged = new Map(baseItems.map((item) => [item.id, item]))
      for (const item of result.menu.items.filter(isMenuItem)) {
        const base = baseItems.find((candidate) => candidate.id === item.id)
        if (base && item.path === base.path) merged.set(item.id, item)
        else if (item.id.startsWith('node:') && /^\/monitoring\/[a-z0-9_-]+$/.test(item.path)) merged.set(item.id, item)
      }
      setMenuItems([...merged.values()].filter((item) => item.enabled).sort((a, b) => a.order - b.order))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(refreshAuthState, 0)
    window.addEventListener('unesa-auth-changed', refreshAuthState)
    return () => { window.clearTimeout(timer); window.removeEventListener('unesa-auth-changed', refreshAuthState) }
  }, [refreshAuthState])
  useEffect(() => { if (pathname === '/lidah-wetan' || pathname === '/ketintang') setFloodOpen(true) }, [pathname])
  useEffect(() => { if (isAdminActive) setAdminOpen(true) }, [isAdminActive])

  const goToPath = (path: string) => { router.push(path); onClose() }
  const isActive = (key: PageKey) => pathname === ({ 'admin-users': '/admin-users', reports: '/reports', 'node-manager': '/node-manager' } as const)[key]
  const menuButton = (item: MenuItem) => <button key={item.id} className={`menu-item ${pathname === item.path ? 'active' : ''}`} onClick={() => goToPath(item.path)}><i className={`bi ${item.icon}`} /><span>{item.label}</span></button>
  const floodItems = menuItems.filter((item) => item.path === '/lidah-wetan' || item.path === '/ketintang')
  const topItems = menuItems.filter((item) => !['/', '/lidah-wetan', '/ketintang'].includes(item.path))

  return <>
    <div className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`} id="sidebarOverlay" onClick={onClose} />
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} id="sidebar">
      <div className="sidebar-header"><div className="brand-logo"><img src="/assets/img/lo.png" alt="Logo" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} /></div><div className="brand-text"><strong>USSC</strong><span>Universitas Negeri Surabaya</span></div></div>
      <nav className="sidebar-menu">
        {menuItems.find((item) => item.path === '/') && menuButton(menuItems.find((item) => item.path === '/')!)}
        <button className={`menu-item ${pathname === '/lidah-wetan' || pathname === '/ketintang' ? 'active' : ''}`} onClick={() => goToPath('/lidah-wetan')}><i className="bi bi-water"/><span>Pemantauan Lingkungan</span></button>
        {topItems.map(menuButton)}
        {canSeeSecret && <div className="menu-group"><button className={`menu-item submenu-toggle ${adminOpen ? 'open' : ''} ${isAdminActive ? 'active' : ''}`} id="adminMenu" onClick={() => setAdminOpen(!adminOpen)} aria-expanded={adminOpen}><i className="bi bi-shield-lock-fill"/><span>Administrasi</span><i className="bi bi-chevron-down menu-arrow"/></button><div className={`submenu ${adminOpen ? 'open' : ''}`} id="adminSubmenu">
          <button className={`submenu-item ${isActive('admin-users') ? 'active' : ''}`} onClick={() => goToPath('/admin-users')}><i className="bi bi-people-fill"/><span>Manajemen Pengguna</span></button>
          <a href="/admin" className={`submenu-item ${pathname === '/admin' ? 'active' : ''}`} onClick={onClose}><i className="bi bi-person"/><span>Manajemen Marker Admin</span></a>
          <button className={`submenu-item ${isActive('reports') ? 'active' : ''}`} onClick={() => goToPath('/reports')}><i className="bi bi-file-earmark-arrow-down-fill"/><span>Riwayat & Ekspor Data</span></button>
          <button className={`submenu-item ${isActive('node-manager') ? 'active' : ''}`} onClick={() => goToPath('/node-manager')}><i className="bi bi-diagram-3"/><span>Pengelola Node</span></button>
        </div></div>}
      </nav>
      <div className="sidebar-footer"><div className="flex w-full items-center justify-center">{isLoggedIn && user ? <div className="flex items-center gap-3">{user.picture && <img src={user.picture} alt={user.name} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-slate-300 object-cover shadow-sm" title={`${user.name} (${user.role})`}/>}<div className="hidden md:flex flex-col text-left"><span className={`text-xs font-bold leading-none ${darkMode ? 'text-white' : 'text-slate-900'}`}>{user.name}</span><span className={`text-[10px] capitalize font-medium ${user.role === 'dosen' ? 'text-sky-500' : 'text-emerald-500'}`}>{user.role}</span></div><button onClick={async () => { await logout(); setUser(null); setIsLoggedIn(false); router.push('/') }} className={`flex items-center justify-center h-9 px-3 text-xs font-semibold rounded-xl border transition-all duration-200 ${darkMode ? 'border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-900/30' : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'}`} title="Keluar dari Akun"><i className="bi bi-box-arrow-right sm:mr-1.5 text-sm"/><span className="hidden sm:inline">Keluar</span></button></div> : <GoogleLoginButton onLoginSuccess={(userData) => { setUser(userData); setIsLoggedIn(true); refreshAuthState() }} onLoginFailure={(error) => console.error('Login gagal di Navbar:', error)} />}</div><div className="sidebar-version">Smart Sustainability Campus v1.0</div></div>
    </aside>
  </>
}
