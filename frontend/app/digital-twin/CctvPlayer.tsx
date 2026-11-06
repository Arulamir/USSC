'use client'

import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

export default function CctvPlayer({ streamPath }: { streamPath: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'loading' | 'playing' | 'tap' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !['lidah_h264', 'ketintang_h264'].includes(streamPath)) return
    let cancelled = false
    let transport: 'webrtc' | 'native' | 'hls' = 'webrtc'
    let pc: RTCPeerConnection | null = null
    let hls: Hls | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let networkRetries = 0
    let mediaRetries = 0
    const controller = new AbortController()
    const hlsUrl = `/api/cctv/hls/${encodeURIComponent(streamPath)}/index.m3u8`

    const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined }
    const fail = () => { if (!cancelled) { clearTimer(); setStatus('error') } }
    const play = async () => {
      try { await video.play() }
      catch (error) {
        if (cancelled) return
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          clearTimer()
          setStatus('tap')
        }
        // AbortError can occur while switching sources; media errors are
        // handled below so they can trigger the HTTP playback fallback.
      }
    }
    const resetVideo = () => {
      video.pause()
      video.srcObject = null
      video.removeAttribute('src')
      video.load()
    }
    const deadline = (callback: () => void, delay: number) => {
      clearTimer()
      timer = setTimeout(() => { if (!cancelled) callback() }, delay)
    }
    const startHls = (forceLibrary = false) => {
      if (cancelled) return
      pc?.close()
      pc = null
      hls?.destroy()
      hls = null
      transport = 'hls'
      resetVideo()
      setStatus('loading')
      deadline(fail, 25000)
      if (!forceLibrary && !Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
        transport = 'native'
        video.src = hlsUrl
        video.load()
        void play()
      } else if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: false, maxBufferLength: 15, backBufferLength: 15 })
        hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!cancelled) void play() })
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || cancelled) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) hls?.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 1) hls?.recoverMediaError()
          else fail()
        })
        hls.loadSource(hlsUrl)
        hls.attachMedia(video)
      } else fail()
    }

    const onPlaying = () => { if (!cancelled) { clearTimer(); setStatus('playing') } }
    const onError = () => {
      if (cancelled) return
      if (transport === 'webrtc') startHls()
      else if (transport === 'native' && Hls.isSupported()) startHls(true)
      else fail()
    }
    const onWaiting = () => {
      if (!cancelled) deadline(() => { if (transport === 'webrtc') startHls(); else fail() }, 15000)
    }
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)
    video.addEventListener('waiting', onWaiting)
    video.muted = true
    video.playsInline = true
    // Required for ManagedMediaSource playback on newer iOS browsers.
    video.disableRemotePlayback = true

    const start = async () => {
      // Older iOS uses native HLS; MSE/MMS browsers use hls.js for HTTP playback.
      await Promise.resolve()
      if (cancelled) return
      if ((!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) || typeof RTCPeerConnection === 'undefined') {
        startHls()
        return
      }
      try {
        pc = new RTCPeerConnection({ iceServers: [] })
        const peer = pc
        peer.addTransceiver('video', { direction: 'recvonly' })
        deadline(() => startHls(), 12000)
        peer.ontrack = event => {
          if (cancelled || transport !== 'webrtc') return
          // Some browsers provide a streamless video track in the WHEP answer.
          video.srcObject = event.streams[0] ?? new MediaStream([event.track])
          void play()
        }
        peer.onconnectionstatechange = () => {
          if (!cancelled && transport === 'webrtc' && peer.connectionState === 'failed') startHls()
          else if (!cancelled && transport === 'webrtc' && peer.connectionState === 'disconnected') onWaiting()
        }
        await peer.setLocalDescription(await peer.createOffer())
        if (peer.iceGatheringState !== 'complete') {
          await new Promise<void>(resolve => {
            const finish = () => {
              clearTimeout(iceTimeout)
              peer.removeEventListener('icegatheringstatechange', changed)
              controller.signal.removeEventListener('abort', finish)
              resolve()
            }
            const changed = () => { if (peer.iceGatheringState === 'complete') finish() }
            const iceTimeout = setTimeout(finish, 5000)
            peer.addEventListener('icegatheringstatechange', changed)
            controller.signal.addEventListener('abort', finish, { once: true })
            changed()
          })
        }
        if (cancelled || transport !== 'webrtc' || !peer.localDescription?.sdp) return
        const response = await fetch(`/api/cctv/whep/${encodeURIComponent(streamPath)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/sdp' },
          body: peer.localDescription.sdp, cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) throw new Error('Stream negotiation failed')
        const answer = await response.text()
        if (cancelled || transport !== 'webrtc') return
        await peer.setRemoteDescription({ type: 'answer', sdp: answer })
      } catch {
        if (!cancelled && transport === 'webrtc') startHls()
      }
    }
    void start()
    return () => {
      cancelled = true
      clearTimer()
      controller.abort()
      pc?.close()
      hls?.destroy()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
      video.removeEventListener('waiting', onWaiting)
      resetVideo()
    }
  }, [streamPath, attempt])

  return <div className="dt-cctv-player">
    <video ref={videoRef} autoPlay muted playsInline controls className="dt-cctv-video" />
    {status === 'playing' && <div className="dt-cctv-live-tag"><span className="dt-cctv-live-dot" /> LIVE</div>}
    {status !== 'playing' && <div className="dt-cctv-player-status" role="status">
      <span>{status === 'loading' ? 'Menghubungkan siaran CCTV...'
        : status === 'tap' ? 'Ketuk untuk memutar siaran CCTV.' : 'Siaran CCTV belum dapat diputar.'}</span>
      {status === 'tap' && <button type="button" onClick={() => {
        void videoRef.current?.play().catch(() => setStatus('error'))
      }}>Putar video</button>}
      {status === 'error' && <button type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}>Coba lagi</button>}
    </div>}
  </div>
}
