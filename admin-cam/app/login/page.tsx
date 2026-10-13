
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type LoginResponse = {
  success?: boolean
  error?: string
  user?: {
    username: string
    display_name: string
    role: string
  }
}

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true

    fetch('/api/cctv/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((response) => {
        if (active && response.ok) router.replace('/')
      })
      .catch(() => {
        // Jika backend belum dapat dijangkau,
        // pengguna tetap dapat melihat form login.
      })
      .finally(() => {
        if (active) setChecking(false)
      })

    return () => {
      active = false
    }
  }, [router])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/cctv/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
        cache: 'no-store',
      })

      const data: LoginResponse = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Login gagal. Periksa koneksi server.')
      }

      // Sesi disimpan oleh backend melalui cookie HttpOnly.
      // Jangan menyimpan token sesi di localStorage atau cookie JS.
      router.replace('/')
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Tidak dapat terhubung ke server.'
      )
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600">Memeriksa sesi...</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-900 text-2xl font-bold text-white">
            U
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            USSC
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            UNESA Smart Sustainability Campus
          </p>
          
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="username" className="mb-2 block text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              maxLength={100}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              placeholder="Masukkan username"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={1024}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              placeholder="Masukkan password"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-900 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Memproses...' : 'Masuk'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          © 2026 Smart Sustainability Campus
        </p>
      </section>
    </main>
  )
}
