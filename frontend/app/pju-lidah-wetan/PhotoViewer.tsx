'use client'

import { useEffect, useRef, useState } from 'react'

export type PhotoViewerState = {
  image: string
  type: 'photo' | '360'
  title: string
} | null

declare global {
  interface Window {
    pannellum?: {
      viewer: (target: HTMLElement, config: Record<string, unknown>) => { destroy: () => void }
    }
  }
}

const toProxiedImageUrl = (value: string, base: string | URL): string => {
  const url = new URL(value, base)
  if (url.pathname.startsWith('/admin/img/')) {
    return `${url.pathname}${url.search}${url.hash}`
  }
  if (url.pathname.startsWith('/img/')) {
    url.pathname = `/admin${url.pathname}`
    return `${url.pathname}${url.search}${url.hash}`
  }
  return url.toString()
}

export default function PhotoViewer({ viewer, onClose }: { viewer: PhotoViewerState; onClose: () => void }) {
  const panoramaTarget = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!viewer) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewer, onClose])

  useEffect(() => {
    if (viewer?.type !== '360' || !panoramaTarget.current) return

    const controller = new AbortController()
    let cancelled = false
    let panorama: { destroy: () => void } | undefined

    const initialize = async () => {
      try {
        await import('pannellum')
        const imageUrl = new URL(viewer.image, window.location.href)
        const configUrl = imageUrl.pathname.toLowerCase().endsWith('.json')
          ? imageUrl
          : new URL(`${imageUrl.pathname.split('.').slice(0, -1).join('.')}/config.json`, imageUrl.origin)
        const proxiedConfigUrl = toProxiedImageUrl(configUrl.toString(), configUrl)
        let config: Record<string, unknown> | null = null

        try {
          const response = await fetch(proxiedConfigUrl, { signal: controller.signal })
          if (response.ok) config = (await response.json()) as Record<string, unknown>
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
        }

        if (!config) {
          config = {
            type: 'equirectangular',
            panorama: toProxiedImageUrl(imageUrl.toString(), imageUrl),
            autoLoad: true,
            showControls: true,
            compass: true,
          }
        }

        if (typeof config.panorama === 'string') {
          const panoramaUrl = new URL(config.panorama, configUrl)
          config.panorama = toProxiedImageUrl(panoramaUrl.toString(), configUrl)
        }

        const multiRes = config.multiRes
        if (multiRes && typeof multiRes === 'object') {
          const paths = multiRes as Record<string, unknown>
          for (const key of ['path', 'fallbackPath']) {
            if (typeof paths[key] === 'string') {
              const imagePath = new URL(paths[key], configUrl)
              paths[key] = toProxiedImageUrl(imagePath.toString(), configUrl)
            }
          }
        }

        if (cancelled || !panoramaTarget.current || !window.pannellum) return
        panorama = window.pannellum.viewer(panoramaTarget.current, config)
      } catch (cause) {
        console.error(cause)
        if (!cancelled && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Gagal memuat panorama.')
        }
      }
    }

    setError('')
    void initialize()
    return () => {
      cancelled = true
      controller.abort()
      panorama?.destroy()
    }
  }, [viewer])

  if (!viewer) return null

  return (
    <div
      className="pju-lidah-wetan-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={viewer.title}
      onClick={onClose}
    >
      <header className="pju-lidah-wetan-viewer-header">
        <strong>{viewer.title}</strong>
        <button type="button" onClick={onClose} aria-label="Tutup penampil" title="Tutup penampil">
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>
      {viewer.type === '360' ? (
        <>
          <div ref={panoramaTarget} className="pju-lidah-wetan-panorama" onClick={(event) => event.stopPropagation()} />
          {error && <p className="pju-lidah-wetan-viewer-error" role="alert">{error}</p>}
        </>
      ) : (
        <img
          className="pju-lidah-wetan-viewer-photo"
          src={viewer.image}
          alt={viewer.title}
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  )
}