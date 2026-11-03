'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getLoginSession, isLoggedIn } from '../components/auth/Google'
import MainLayout from '../components/layout/MainLayout'

type Role = 'admin' | 'member'
type User = { id: number; email: string; role: Role; is_active: boolean; created_at: string }
type SortKey = keyof Pick<User, 'email' | 'role' | 'is_active' | 'created_at'>
const PAGE_SIZE = 10

export default function AdminUsersPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'email', direction: 'asc' })
  const [newEmail, setNewEmail] = useState('')
  const [addingUser, setAddingUser] = useState(false)
  const [savingUserId, setSavingUserId] = useState<number | null>(null)
  const currentEmail = getLoginSession()?.email.trim().toLowerCase() ?? ''

  const loadUsers = useCallback(async () => {
    const token = document.cookie.split('; ').find((item) => item.startsWith('unesa_session='))?.split('=').slice(1).join('=')
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.')
    const response = await fetch('/admin/users', { headers: { Authorization: `Bearer ${decodeURIComponent(token)}` }, cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `Gagal memuat pengguna (${response.status})`)
    setUsers(body as User[])
  }, [])

  useEffect(() => {
    const session = getLoginSession()
    if (!isLoggedIn() || session?.role !== 'admin') {
      router.replace('/')
      return
    }
    const initial = window.setTimeout(() => {
      setAuthorized(true)
      loadUsers().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Gagal memuat pengguna.')).finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(initial)
  }, [loadUsers, router])

  const sortedUsers = useMemo(() => [...users].sort((a, b) => {
    const aIsCurrent = a.email.trim().toLowerCase() === currentEmail
    const bIsCurrent = b.email.trim().toLowerCase() === currentEmail
    if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1
    const left = a[sort.key]
    const right = b[sort.key]
    const comparison = typeof left === 'boolean' ? Number(left) - Number(right) : String(left).localeCompare(String(right), 'id', { sensitivity: 'base' })
    return sort.direction === 'asc' ? comparison : -comparison
  }), [users, sort, currentEmail])
  const pageCount = Math.max(1, Math.ceil(sortedUsers.length / PAGE_SIZE))
  const pageUsers = sortedUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const changeSort = (key: SortKey) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  }
  const sessionToken = () => document.cookie.split('; ').find((item) => item.startsWith('unesa_session='))?.split('=').slice(1).join('=')
  const addUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    setAddingUser(true)
    setError('')
    try {
      const response = await fetch('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decodeURIComponent(sessionToken() || '')}` },
        body: JSON.stringify({ email }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Pengguna gagal ditambahkan.')
      setUsers((current) => [...current, body as User])
      setNewEmail('')
      setPage(1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengguna gagal ditambahkan.')
    } finally {
      setAddingUser(false)
    }
  }
  const updateUser = async (user: User, changes: Partial<Pick<User, 'email' | 'role' | 'is_active'>>) => {
    if (user.email.trim().toLowerCase() === currentEmail) return
    setError('')
    setSavingUserId(user.id)
    try {
      const response = await fetch(`/admin/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decodeURIComponent(sessionToken() || '')}` }, body: JSON.stringify(changes) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Perubahan gagal disimpan.')
      setUsers((current) => current.map((item) => item.id === user.id ? body as User : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Perubahan gagal disimpan.')
    } finally {
      setSavingUserId(null)
    }
  }
  const deleteUser = async (user: User) => {
    if (user.email.trim().toLowerCase() === currentEmail) return
    if (!window.confirm(`Hapus akses ${user.email}? Pengguna ini tidak akan dapat masuk kembali sampai ditambahkan lagi.`)) return
    setError('')
    setSavingUserId(user.id)
    try {
      const response = await fetch(`/admin/users/${user.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${decodeURIComponent(sessionToken() || '')}` } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Pengguna gagal dihapus.')
      setUsers((current) => current.filter((item) => item.id !== user.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengguna gagal dihapus.')
    } finally {
      setSavingUserId(null)
    }
  }

  if (!authorized) return <MainLayout><div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8"><p className="text-sm text-slate-500 dark:text-slate-400">Memeriksa akses administrator...</p></div></MainLayout>
  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-center">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-400">Panel administrator · Akses</p><h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">Manajemen Pengguna</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Atur peran dan status akses akun yang terdaftar.</p></div>
          <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Pengguna <strong className="ml-1 tabular-nums text-teal-800 dark:text-teal-300">{users.length}</strong></div>
        </section>
        {error && <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert"><i className="bi bi-exclamation-circle mt-0.5" aria-hidden="true" />{error}</div>}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Daftar pengguna">
          <form onSubmit={addUser} className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs font-medium text-slate-600 dark:text-slate-300">Tambah pengguna dengan email
              <input type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="nama@unesa.ac.id" className="mt-1.5 block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-teal-900" />
            </label>
            <button type="submit" disabled={addingUser} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"><i className="bi bi-person-plus" aria-hidden="true" />{addingUser ? 'Menambahkan...' : 'Tambah pengguna'}</button>
          </form>
          {loading ? <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Memuat pengguna...</p> : <>
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/70 dark:text-slate-400"><tr>
            {([['email', 'Email'], ['role', 'Peran'], ['is_active', 'Status'], ['created_at', 'Terdaftar']] as [SortKey, string][]).map(([key, label]) => <th key={key} className="px-4 py-3 font-semibold"><button className="inline-flex items-center gap-1 hover:text-teal-700 dark:hover:text-teal-300" onClick={() => changeSort(key)}>{label}<span>{sort.key === key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button></th>)}
            <th className="px-4 py-3 font-semibold">Aksi</th>
          </tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{pageUsers.map((user) => {
            const isCurrentUser = user.email.trim().toLowerCase() === currentEmail
            return <tr key={user.id} className={`${isCurrentUser ? 'bg-teal-50/70 dark:bg-teal-950/20' : ''} text-slate-700 dark:text-slate-200`}>
            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{user.email}{isCurrentUser && <span className="ml-2 inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">Anda</span>}</td>
            <td className="px-4 py-3"><select disabled={isCurrentUser} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-teal-900" aria-label={`Peran ${user.email}`} value={user.role} onChange={(event) => updateUser(user, { role: event.target.value as Role })}><option value="admin">Admin</option><option value="member">Member</option></select></td>
            <td className="px-4 py-3"><button disabled={isCurrentUser} className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${user.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`} aria-label={`${user.is_active ? 'Nonaktifkan' : 'Aktifkan'} ${user.email}`} onClick={() => updateUser(user, { is_active: !user.is_active })}><span className={`h-1.5 w-1.5 rounded-full ${user.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />{user.is_active ? 'Aktif' : 'Nonaktif'}</button></td>
            <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(user.created_at))}</td>
            <td className="px-4 py-3"><div className="flex items-center gap-2">
              <button disabled={isCurrentUser || savingUserId === user.id} onClick={() => { const email = window.prompt('Ubah email pengguna:', user.email); if (email?.trim() && email.trim().toLowerCase() !== user.email.toLowerCase()) void updateUser(user, { email }) }} className="rounded-md border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" aria-label={`Ubah email ${user.email}`}><i className="bi bi-pencil" aria-hidden="true" /> <span className="sr-only">Ubah email</span></button>
              <button disabled={isCurrentUser || savingUserId === user.id} onClick={() => void deleteUser(user)} className="rounded-md border border-rose-200 px-2.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40" aria-label={`Hapus ${user.email}`}><i className="bi bi-trash" aria-hidden="true" /> <span className="sr-only">Hapus</span></button>
            </div></td>
          </tr>
          })}</tbody></table></div>
          {users.length === 0 ? <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Belum ada pengguna terdaftar.</p> : <footer className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>Menampilkan {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, users.length)} dari {users.length} pengguna</span><div className="flex items-center justify-between gap-3 sm:justify-end"><button className="rounded-md border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Sebelumnya</button><span className="tabular-nums">{page} / {pageCount}</span><button className="rounded-md border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Berikutnya</button></div></footer>}
        </>}
        </section>
      </div>
    </MainLayout>
  )
}
