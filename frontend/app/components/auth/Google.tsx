'use client'

import { useState, useEffect, useRef } from 'react'
import type { CredentialResponse } from '@react-oauth/google'
import { useRouter } from 'next/navigation'
import { useTheme } from '../layout/Theme'
import Cookies from 'js-cookie'

const apiBaseUrl = '/api/admin'
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

function sharedSessionCookieOptions() {
  return {
    path: '/',
    secure: window.location.protocol === 'https:',
    sameSite: 'strict' as const,
    ...(window.location.hostname.endsWith('.nurutomo.my.id') ? { domain: '.nurutomo.my.id' } : {}),
  }
}

type GoogleIdentityCredential = { credential?: string }

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: GoogleIdentityCredential) => void }) => void
          renderButton: (element: HTMLElement, options: { theme: 'outline' | 'filled_black'; shape: 'circle' }) => void
        }
      }
    }
    __usscGoogleScriptPromise?: Promise<void>
    __usscGoogleInitialized?: boolean
    __usscGoogleCredentialHandler?: (response: GoogleIdentityCredential) => void
  }
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (window.__usscGoogleScriptPromise) return window.__usscGoogleScriptPromise

  window.__usscGoogleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    const script = existingScript ?? document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      window.__usscGoogleScriptPromise = undefined
      reject(new Error('Library Google Sign-In gagal dimuat.'))
    }
    if (!existingScript) document.head.appendChild(script)
  })

  return window.__usscGoogleScriptPromise
}

interface UserSession {
  uid: string
  name: string
  email: string
  picture: string
  role: 'mahasiswa' | 'dosen'
}

interface BackendResponse {
  message: string
  token: string
  user: UserSession
  error?: string
}

interface GoogleLoginButtonProps {
  onLoginSuccess?: (user: UserSession) => void
  onLoginFailure?: (errorMessage: string) => void
}

export function isLoggedIn(): boolean {
  return Boolean(Cookies.get('unesa_session') && Cookies.get('unesa_user'))
}

export function getLoginSession(): UserSession | null {
  const userData = Cookies.get('unesa_user')
  if (!Cookies.get('unesa_session') || !userData) return null

  try {
    return JSON.parse(userData) as UserSession
  } catch {
    return null
  }
}

export async function logout() {
  const cookieOptions = sharedSessionCookieOptions()
  Cookies.remove('unesa_session', cookieOptions)
  Cookies.remove('unesa_user', cookieOptions)
  Cookies.remove('unesa_session', { path: '/' })
  Cookies.remove('unesa_user', { path: '/' })
  window.dispatchEvent(new Event('unesa-auth-changed'))
  const response = await fetch(`${apiBaseUrl}/auth/logout`)
  return response.json()
}

export default function GoogleLoginButton({ onLoginSuccess, onLoginFailure }: GoogleLoginButtonProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const buttonContainer = useRef<HTMLDivElement>(null)
  const credentialHandler = useRef<(response: CredentialResponse) => void>(() => undefined)
  const failureHandler = useRef(onLoginFailure)
  const { theme } = useTheme()
  const router = useRouter()

  const handleLoginSuccess = async (credentialResponse: CredentialResponse) => {
    setError(null)
    setLoading(true)

    const idToken = credentialResponse.credential

    if (!idToken) {
      const msg = 'Token Google tidak ditemukan.'
      setError(msg)
      if (onLoginFailure) onLoginFailure(msg)
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${apiBaseUrl}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: idToken }),
      })

      const data: BackendResponse = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Terjadi kesalahan autentikasi.')
      }

      const cookieOptions = { ...sharedSessionCookieOptions(), expires: 1 }
      Cookies.remove('unesa_session', { path: '/' })
      Cookies.remove('unesa_user', { path: '/' })
      Cookies.set('unesa_session', data.token, cookieOptions)
      Cookies.set('unesa_user', JSON.stringify(data.user), cookieOptions)
      window.dispatchEvent(new Event('unesa-auth-changed'))

      if (onLoginSuccess) onLoginSuccess(data.user)
      router.push(window.location.pathname) // Refresh halaman saat ini
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Terjadi kesalahan sistem.'
      setError(errMsg)
      if (onLoginFailure) onLoginFailure(errMsg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    credentialHandler.current = handleLoginSuccess
    failureHandler.current = onLoginFailure
  })

  useEffect(() => {
    let cancelled = false
    const container = buttonContainer.current;

    (googleClientId ? loadGoogleIdentityScript() : Promise.reject(new Error('Konfigurasi Google Sign-In belum tersedia.')))
      .then(() => {
        if (cancelled || !container) return

        const googleIdentity = window.google?.accounts?.id
        if (!googleIdentity) throw new Error('Library Google Sign-In tidak tersedia.')

        window.__usscGoogleCredentialHandler = (response) => {
          if (response.credential) {
            void credentialHandler.current({ credential: response.credential })
          } else {
            setError('Token Google tidak ditemukan.')
            failureHandler.current?.('Token Google tidak ditemukan.')
          }
        }

        if (!window.__usscGoogleInitialized) {
          googleIdentity.initialize({
            client_id: googleClientId,
            callback: (response) => window.__usscGoogleCredentialHandler?.(response),
          })
          window.__usscGoogleInitialized = true
        }

        googleIdentity.renderButton(container, {
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          shape: 'circle',
        })
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        const message = loadError instanceof Error ? loadError.message : 'Koneksi ke Google gagal.'
        setError(message)
        failureHandler.current?.(message)
      })

    return () => {
      cancelled = true
      if (window.__usscGoogleCredentialHandler) window.__usscGoogleCredentialHandler = undefined
      container?.replaceChildren()
    }
  }, [theme])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      {error && (
        <div
          style={{
            color: '#721c24',
            backgroundColor: '#f8d7da',
            padding: '10px',
            borderRadius: '4px',
            marginBottom: '15px',
            fontSize: '13px',
            textAlign: 'left',
          }}
        >
          {error}
        </div>
      )}

      {!error && (
        <>
          <div
            ref={buttonContainer}
            style={{ display: loading ? 'none' : 'flex', justifyContent: 'center', width: '100%' }}
          />
          {loading && <p style={{ fontSize: '14px', color: '#666' }}>Memproses akun Unesa...</p>}
        </>
      )}
    </div>
  )
}
