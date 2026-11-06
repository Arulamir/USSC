'use client'

import { Box3, Vector3, type Camera } from 'three'
import { useEffect, useRef, useState } from 'react'
import type { SparkRenderer, SplatMesh, SplatMeshOptions } from '@sparkjsdev/spark'

type Bounds = [[number, number, number], [number, number, number]]
type SplatChunk = {
  id: string
  path: string
  count: number
  bounds: Bounds
}
type SplatManifest = {
  version: 1
  datasetId: string
  format: 'binary_little_endian_ply_gzip'
  previewPath: string
  previewCount: number
  bounds: Bounds
  median: [number, number, number]
  chunks: SplatChunk[]
}

const CHUNK_BASE_URL = '/splat-chunks'
const CHUNK_CACHE_NAME = 'ussc-splat-chunks-v1'
const CHUNK_CACHE_LIMIT_BYTES = 128 * 1024 * 1024
const SCENE_SCALE = 500
const RENDER_DISTANCE = 200
const RENDER_DISTANCE_HYSTERESIS = 20
const MAX_ACTIVE_CHUNKS = 50
const CAMERA_POLL_INTERVAL = 200
let sparkModulePromise: Promise<typeof import('@sparkjsdev/spark')> | null = null

function loadSparkModule(): Promise<typeof import('@sparkjsdev/spark')> {
  if (!sparkModulePromise) {
    sparkModulePromise = import('@sparkjsdev/spark').catch((cause: unknown) => {
      sparkModulePromise = null
      console.error('[DIGITAL TWIN SPLAT] Spark renderer module failed to load.', cause)
      throw new Error('Gagal memuat renderer Spark. Jika terjadi saat hot reload, muat ulang halaman lalu buka viewer kembali.')
    })
  }
  return sparkModulePromise
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBounds(value: unknown): value is Bounds {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))
  )
}

function isSplatManifest(value: unknown): value is SplatManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.datasetId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.datasetId) ||
    value.format !== 'binary_little_endian_ply_gzip'
  ) return false
  if (
    typeof value.previewPath !== 'string' ||
    !Number.isInteger(value.previewCount) ||
    Number(value.previewCount) <= 0 ||
    !isBounds(value.bounds) ||
    !Array.isArray(value.median) ||
    value.median.length !== 3 ||
    !value.median.every(Number.isFinite) ||
    !Array.isArray(value.chunks) ||
    value.chunks.length === 0
  ) {
    return false
  }
  return value.chunks.every(
    (chunk) =>
      isRecord(chunk) &&
      typeof chunk.id === 'string' &&
      typeof chunk.path === 'string' &&
      typeof chunk.count === 'number' &&
      Number.isInteger(chunk.count) &&
      chunk.count > 0 &&
      isBounds(chunk.bounds) &&
      !chunk.path.split('/').includes('..')
  )
}

function getChunkUrl(path: string): string {
  return `${CHUNK_BASE_URL}/${path.split('/').map(encodeURIComponent).join('/')}`
}

function swapYAndZ([x, y, z]: [number, number, number]): [number, number, number] {
  return [x, z, y]
}

function swapBoundsYAndZ(bounds: Bounds): Bounds {
  return [swapYAndZ(bounds[0]), swapYAndZ(bounds[1])]
}

function getScaledBounds(bounds: Bounds, median: Vector3): Bounds {
  const swappedBounds = swapBoundsYAndZ(bounds)
  return swappedBounds.map((point) =>
    point.map((coordinate, axis) => {
      const center = axis === 0 ? median.x : axis === 1 ? median.y : median.z
      return center + (coordinate - center) * SCENE_SCALE
    })
  ) as Bounds
}

function selectChunksInRenderDistance(
  manifest: SplatManifest,
  camera: Camera,
  loadedChunkIds: ReadonlySet<string>
): SplatChunk[] {
  const median = new Vector3(...swapYAndZ(manifest.median))

  const rankedChunks = manifest.chunks
    .map((chunk) => {
      const scaledBounds = getScaledBounds(chunk.bounds, median)
      const center = new Box3(new Vector3(...scaledBounds[0]), new Vector3(...scaledBounds[1])).getCenter(new Vector3())
      const distance = center.distanceTo(camera.position)
      const maxDistance = RENDER_DISTANCE + (loadedChunkIds.has(chunk.id) ? RENDER_DISTANCE_HYSTERESIS : 0)
      return {
        chunk,
        distance,
        inRange: distance <= maxDistance,
      }
    })
    .filter(({ inRange }) => inRange)
    .sort((left, right) => left.distance - right.distance)

  return rankedChunks.slice(0, MAX_ACTIVE_CHUNKS).map(({ chunk }) => chunk)
}

async function downloadAndDecompress(
  path: string,
  datasetId: string,
  signal: AbortSignal,
  onProgress: (progress: number | null) => void
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser ini tidak mendukung dekompresi gzip untuk splat. Gunakan browser versi terbaru.')
  }

  const request = new Request(`${getChunkUrl(path)}?v=${datasetId}`)
  const cache = 'caches' in globalThis
    ? await caches.open(CHUNK_CACHE_NAME).catch((cause: unknown) => {
        console.warn('[DIGITAL TWIN SPLAT] Cache storage unavailable; loading chunk from network.', cause)
        return null
      })
    : null
  if (!('caches' in globalThis)) {
    console.warn('[DIGITAL TWIN SPLAT] Cache storage is unsupported; loading chunks from network.')
  }
  let compressedBytes: Uint8Array
  const cachedResponse = await cache?.match(request).catch((cause: unknown) => {
    console.warn('[DIGITAL TWIN SPLAT] Could not read cached chunk; loading from network.', cause)
    return undefined
  })

  if (cachedResponse) {
    compressedBytes = new Uint8Array(await cachedResponse.arrayBuffer())
    onProgress(1)
    const refreshedHeaders = new Headers(cachedResponse.headers)
    refreshedHeaders.set('x-splat-cache-accessed', String(Date.now()))
    void cache?.put(request, new Response(compressedBytes.slice(), { headers: refreshedHeaders })).catch((cause: unknown) => {
      console.warn('[DIGITAL TWIN SPLAT] Could not update cached chunk access time.', cause)
    })
  } else {
    const response = await fetch(request, { signal })
    if (!response.ok) {
      throw new Error(`Gagal mengunduh potongan splat (${response.status} ${response.statusText}).`)
    }
    if (!response.body) throw new Error('Browser tidak menyediakan stream unduhan untuk potongan splat.')

    const expectedSize = Number(response.headers.get('content-length')) || 0
    let downloaded = 0
    const compressedParts: Uint8Array[] = []
    const reader = response.body.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        compressedParts.push(value)
        downloaded += value.byteLength
        onProgress(expectedSize > 0 ? Math.min(1, downloaded / expectedSize) : null)
      }
    } finally {
      reader.releaseLock()
    }

    compressedBytes = new Uint8Array(downloaded)
    let offset = 0
    for (const part of compressedParts) {
      compressedBytes.set(part, offset)
      offset += part.byteLength
    }

    if (cache && compressedBytes.byteLength <= CHUNK_CACHE_LIMIT_BYTES) {
      const cacheHeaders = new Headers({
        'content-type': 'application/gzip',
        'x-splat-cache-size': String(compressedBytes.byteLength),
        'x-splat-cache-accessed': String(Date.now()),
      })
      try {
        const keys = await cache.keys()
        const entries = await Promise.all(
          keys.map(async (key) => {
            const cached = await cache.match(key)
            return {
              key,
              size: Number(cached?.headers.get('x-splat-cache-size')) || 0,
              accessed: Number(cached?.headers.get('x-splat-cache-accessed')) || 0,
            }
          })
        )
        let cachedBytes = entries.reduce((total, entry) => total + entry.size, 0)
        for (const entry of entries.sort((left, right) => left.accessed - right.accessed)) {
          if (cachedBytes + compressedBytes.byteLength <= CHUNK_CACHE_LIMIT_BYTES) break
          await cache.delete(entry.key)
          cachedBytes -= entry.size
        }
        await cache.put(request, new Response(compressedBytes.slice(), { headers: cacheHeaders }))
      } catch (cause) {
        console.warn('[DIGITAL TWIN SPLAT] Could not persist chunk cache; keeping this load in memory.', cause)
      }
    }
  }

  const compressedBuffer = new ArrayBuffer(compressedBytes.byteLength)
  new Uint8Array(compressedBuffer).set(compressedBytes)
  const compressedBlob = new Blob([compressedBuffer])
  const decompressed = await new Response(
    compressedBlob.stream().pipeThrough(new DecompressionStream('gzip'))
  ).arrayBuffer()
  onProgress(1)
  return new Uint8Array(decompressed)
}

export default function GaussianSplatViewer({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const movementPadRef = useRef<HTMLDivElement>(null)
  const movementKnobRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Menyiapkan viewer...')
  const [progress, setProgress] = useState<number | null>(null)
  const [loadedChunks, setLoadedChunks] = useState(0)
  const [targetChunks, setTargetChunks] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const canvas = hostRef.current?.querySelector('canvas')
        if (canvas && document.pointerLockElement === canvas) {
          document.exitPointerLock()
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const movementPad = movementPadRef.current
    const movementKnob = movementKnobRef.current

    const abortController = new AbortController()
    const loadedMeshes = new Map<string, SplatMesh>()
    let sparkModule: typeof import('@sparkjsdev/spark') | null = null
    let scene: import('three').Scene | null = null
    let splatRoot: import('three').Group | null = null
    let camera: import('three').PerspectiveCamera | null = null
    let renderer: import('three').WebGLRenderer | null = null
    let spark: SparkRenderer | null = null
    let manifest: SplatManifest | null = null
    let animationStarted = false
    let cancelled = false
    let syncRunning = false
    let desiredChunks: SplatChunk[] = []
    let desiredSignature = ''
    let failedSignature = '\0'
    let pollingTimer: number | undefined
    let resizeObserver: ResizeObserver | undefined
    let yaw = 0
    let pitch = 0
    const moveSpeed = 5
    let lookPointerId: number | null = null
    let joystickPointerId: number | null = null
    let joystickX = 0
    let joystickY = 0
    let lastFrameTime = 0
    const pressedKeys = new Set<string>()

    const setFailure = (cause: unknown) => {
      if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return
      console.error('[DIGITAL TWIN SPLAT]', cause)
      setError(cause instanceof Error ? cause.message : 'Gagal memuat Gaussian splat.')
      setStatus('Terjadi kesalahan saat memuat scene.')
      setProgress(null)
    }

    const updateCameraRotation = () => {
      if (!camera) return
      camera.rotation.set(pitch, yaw, 0, 'YXZ')
    }

    const updateLook = (deltaX: number, deltaY: number) => {
      yaw -= deltaX * 0.0028
      pitch = Math.max(-1.48, Math.min(1.48, pitch - deltaY * 0.0028))
      updateCameraRotation()
    }

    const resetJoystick = () => {
      joystickPointerId = null
      joystickX = 0
      joystickY = 0
      if (movementKnob) {
        movementKnob.style.setProperty('--joystick-x', '0px')
        movementKnob.style.setProperty('--joystick-y', '0px')
      }
    }

    const updateJoystick = (event: PointerEvent) => {
      if (!movementPad || !movementKnob) return
      const bounds = movementPad.getBoundingClientRect()
      const maxRadius = bounds.width * 0.34
      const deltaX = event.clientX - (bounds.left + bounds.width / 2)
      const deltaY = event.clientY - (bounds.top + bounds.height / 2)
      const length = Math.hypot(deltaX, deltaY)
      const scale = length > maxRadius ? maxRadius / length : 1
      const knobX = deltaX * scale
      const knobY = deltaY * scale
      joystickX = knobX / maxRadius
      joystickY = knobY / maxRadius
      movementKnob.style.setProperty('--joystick-x', `${knobX}px`)
      movementKnob.style.setProperty('--joystick-y', `${knobY}px`)
    }

    const handlePadPointerDown = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      joystickPointerId = event.pointerId
      movementPad?.setPointerCapture(event.pointerId)
      updateJoystick(event)
    }
    const handlePadPointerMove = (event: PointerEvent) => {
      if (event.pointerId === joystickPointerId) updateJoystick(event)
    }
    const handlePadPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === joystickPointerId) resetJoystick()
    }

    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        lookPointerId = event.pointerId
        lastLookX = event.clientX
        lastLookY = event.clientY
        renderer?.domElement.setPointerCapture(event.pointerId)
      } else if (event.pointerType === 'mouse') {
        const canvas = renderer?.domElement
        if (canvas?.requestPointerLock) {
          void canvas.requestPointerLock()
        } else {
          lookPointerId = event.pointerId
          canvas?.setPointerCapture(event.pointerId)
        }
      }
    }
    const handleCanvasPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== lookPointerId) return
      updateLook(event.movementX || event.clientX - lastLookX, event.movementY || event.clientY - lastLookY)
      lastLookX = event.clientX
      lastLookY = event.clientY
    }
    const handleCanvasPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === lookPointerId) lookPointerId = null
    }
    let lastLookX = 0
    let lastLookY = 0
    const handleMouseMove = (event: MouseEvent) => {
      if (!renderer || document.pointerLockElement !== renderer.domElement) return
      updateLook(event.movementX, event.movementY)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        ![
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'KeyQ',
          'KeyE',
          'KeyZ',
          'KeyC',
          'ShiftLeft',
          'ShiftRight',
        ].includes(event.code)
      ) return
      event.preventDefault()
      pressedKeys.add(event.code)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code)
    }
    const clearMovement = () => {
      pressedKeys.clear()
      resetJoystick()
    }

    const moveCamera = (deltaTime: number) => {
      if (!camera) return
      const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
      const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      const movement = new Vector3()
      const forwardInput =
        (pressedKeys.has('KeyW') ? 1 : 0) -
        (pressedKeys.has('KeyS') ? 1 : 0) -
        joystickY
      const sideInput =
        (pressedKeys.has('KeyD') ? 1 : 0) -
        (pressedKeys.has('KeyA') ? 1 : 0) +
        joystickX
      const verticalInput = (pressedKeys.has('KeyE') ? 1 : 0) - (pressedKeys.has('KeyQ') ? 1 : 0)
      const tiltInput = (pressedKeys.has('KeyC') ? 1 : 0) - (pressedKeys.has('KeyZ') ? 1 : 0)
      movement.addScaledVector(forward, forwardInput).addScaledVector(right, sideInput)
      const sprinting = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight')
      const speed = moveSpeed * deltaTime * (sprinting ? 3 : 1)
      if (movement.lengthSq() > 0) {
        movement.normalize()
        camera.position.addScaledVector(movement, speed)
      }
      if (verticalInput !== 0) camera.position.y += verticalInput * speed
      if (tiltInput !== 0) {
        pitch = Math.max(-1.48, Math.min(1.48, pitch + tiltInput * deltaTime * 0.9))
        updateCameraRotation()
      }
    }

    const removeMeshes = (ids: string[]) => {
      if (!splatRoot) return
      for (const id of ids) {
        const mesh = loadedMeshes.get(id)
        if (!mesh) continue
        splatRoot.remove(mesh)
        mesh.dispose()
        loadedMeshes.delete(id)
      }
      setLoadedChunks(loadedMeshes.size)
    }

    const loadMesh = async (id: string, path: string, count: number) => {
      if (!scene || !splatRoot || cancelled) return
      setStatus(`Mengunduh potongan ${id} (${count.toLocaleString()} splat)...`)
      const fileBytes = await downloadAndDecompress(path, manifest!.datasetId, abortController.signal, (downloadProgress) => {
        if (cancelled) return
        setProgress(downloadProgress)
      })
      if (cancelled || !scene || !splatRoot) return

      setStatus(`Merender potongan ${id}...`)
      if (!sparkModule) throw new Error('Renderer Spark belum siap. Muat ulang halaman Digital Twin.')
      const { SplatFileType, SplatMesh: SplatMeshClass } = sparkModule
      const options: SplatMeshOptions = {
        fileBytes,
        fileType: SplatFileType.PLY,
        onProgress: (event) => {
          if (!cancelled && event.lengthComputable) {
            setProgress(Math.max(0, Math.min(1, event.loaded / event.total)))
          }
        },
      }
      const mesh = new SplatMeshClass(options)
      try {
        await mesh.initialized
        if (cancelled || !scene || !splatRoot) {
          mesh.dispose()
          return
        }
        splatRoot.add(mesh)
        loadedMeshes.set(id, mesh)
        setLoadedChunks(loadedMeshes.size)
        setProgress(null)
        if (!animationStarted && renderer && camera && scene) {
          lastFrameTime = performance.now()
          renderer.setAnimationLoop((time) => {
            const deltaTime = Math.min(0.1, Math.max(0, (time - lastFrameTime) / 1000))
            lastFrameTime = time
            moveCamera(deltaTime)
            renderer?.render(scene!, camera!)
          })
          animationStarted = true
        }
      } catch (cause) {
        mesh.dispose()
        throw cause
      }
    }

    const synchronizeVisibleChunks = async () => {
      if (syncRunning || !manifest || !scene || cancelled || failedSignature === desiredSignature) return
      syncRunning = true
      try {
        while (!cancelled) {
          const desired = desiredChunks
          const desiredIds = new Set(desired.map((chunk) => chunk.id))
          const stale = Array.from(loadedMeshes.keys()).filter((id) => !desiredIds.has(id))
          if (stale.length > 0) {
            removeMeshes(stale)
            continue
          }

          if (desired.length === 0) {
            break
          }

          const missing = desired.find((chunk) => !loadedMeshes.has(chunk.id))
          if (missing) {
            await loadMesh(missing.id, missing.path, missing.count)
            continue
          }
          break
        }
        if (!cancelled) {
          setStatus(
            desiredChunks.length > 0
              ? `Scene siap. Render distance ${RENDER_DISTANCE} unit.`
              : 'Tidak ada splat dalam render distance. Bergerak lebih dekat ke scene.'
          )
        }
      } catch (cause) {
        failedSignature = desiredSignature
        setFailure(cause)
      } finally {
        syncRunning = false
      }
    }

    const initialize = async () => {
      try {
        setStatus('Memuat indeks potongan...')
        const manifestResponse = await fetch(`${CHUNK_BASE_URL}/manifest.json`, { signal: abortController.signal })
        if (!manifestResponse.ok) {
          throw new Error(
            `Dataset splat belum tersedia (${manifestResponse.status}). Jalankan "npm run prepare:splat" di frontend dan deploy frontend/public/splat-chunks/.`
          )
        }
        const manifestValue: unknown = await manifestResponse.json()
        if (!isSplatManifest(manifestValue)) throw new Error('Manifest splat tidak valid atau tidak kompatibel.')
        manifest = manifestValue

        const [threeModule, loadedSparkModule] = await Promise.all([import('three'), loadSparkModule()])
        if (cancelled) return

        sparkModule = loadedSparkModule
        const { Scene, PerspectiveCamera, WebGLRenderer, Color } = threeModule
        const { SparkRenderer } = loadedSparkModule
        const center = new Vector3(...swapYAndZ(manifest.median))
        scene = new Scene()
        scene.background = new Color('#0f172a')
        splatRoot = new threeModule.Group()
        splatRoot.rotation.x = -Math.PI / 2
        splatRoot.scale.set(SCENE_SCALE, -SCENE_SCALE, SCENE_SCALE)
        splatRoot.position.copy(center).multiplyScalar(1 - SCENE_SCALE)
        scene.add(splatRoot)
        camera = new PerspectiveCamera(75, 1, 0.01, RENDER_DISTANCE * 2)
        camera.position.copy(center)
        yaw = 0
        pitch = 0
        camera.rotation.order = 'YXZ'
        updateCameraRotation()
        renderer = new WebGLRenderer({ antialias: false, alpha: false })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setClearColor(0x0f172a, 1)
        host.replaceChildren(renderer.domElement)
        spark = new SparkRenderer({ renderer })
        scene.add(spark)
        const canvas = renderer.domElement
        canvas.addEventListener('pointerdown', handleCanvasPointerDown)
        canvas.addEventListener('pointermove', handleCanvasPointerMove)
        canvas.addEventListener('pointerup', handleCanvasPointerEnd)
        canvas.addEventListener('pointercancel', handleCanvasPointerEnd)
        document.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        window.addEventListener('blur', clearMovement)
        movementPad?.addEventListener('pointerdown', handlePadPointerDown)
        movementPad?.addEventListener('pointermove', handlePadPointerMove)
        movementPad?.addEventListener('pointerup', handlePadPointerEnd)
        movementPad?.addEventListener('pointercancel', handlePadPointerEnd)

        const resize = () => {
          if (!host || !renderer || !camera) return
          const { width, height } = host.getBoundingClientRect()
          if (width <= 0 || height <= 0) return
          renderer.setSize(width, height, false)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
        }
        resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(host)
        resize()

        const updateVisibleChunks = () => {
          if (cancelled || !manifest || !camera) return
          const loadedChunkIds = new Set(loadedMeshes.keys())
          const visible = selectChunksInRenderDistance(manifest, camera, loadedChunkIds)
          const signature = visible.map((chunk) => chunk.id).join(',')
          if (signature !== desiredSignature) {
            desiredChunks = visible
            desiredSignature = signature
            failedSignature = ''
            setTargetChunks(visible.length)
            setError('')
          }
          void synchronizeVisibleChunks()
        }
        pollingTimer = window.setInterval(updateVisibleChunks, CAMERA_POLL_INTERVAL)
        updateVisibleChunks()
      } catch (cause) {
        setFailure(cause)
      }
    }

    void initialize()

    return () => {
      cancelled = true
      abortController.abort()
      if (pollingTimer !== undefined) window.clearInterval(pollingTimer)
      resizeObserver?.disconnect()
      renderer?.setAnimationLoop(null)
      if (renderer) {
        renderer.domElement.removeEventListener('pointerdown', handleCanvasPointerDown)
        renderer.domElement.removeEventListener('pointermove', handleCanvasPointerMove)
        renderer.domElement.removeEventListener('pointerup', handleCanvasPointerEnd)
        renderer.domElement.removeEventListener('pointercancel', handleCanvasPointerEnd)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearMovement)
      movementPad?.removeEventListener('pointerdown', handlePadPointerDown)
      movementPad?.removeEventListener('pointermove', handlePadPointerMove)
      movementPad?.removeEventListener('pointerup', handlePadPointerEnd)
      movementPad?.removeEventListener('pointercancel', handlePadPointerEnd)
      if (renderer && document.pointerLockElement === renderer.domElement) document.exitPointerLock()
      removeMeshes(Array.from(loadedMeshes.keys()))
      spark?.dispose()
      renderer?.dispose()
      host.replaceChildren()
    }
  }, [])

  return (
    <div className="dt-splat-overlay" role="dialog" aria-modal="true" aria-label="Gaussian splat Digital Twin">
      <section className="dt-splat-window">
        <header className="dt-splat-header">
          <div>
            <strong>Gaussian Splat</strong>
            <span>
              {loadedChunks}/{targetChunks} potongan detail aktif
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup viewer splat" title="Kembali ke peta">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </header>
        <div ref={hostRef} className="dt-splat-canvas" />
        <div
          ref={movementPadRef}
          className="dt-splat-movement-pad"
          role="application"
          aria-label="Joystick untuk bergerak di scene"
        >
          <div className="dt-splat-movement-ring">
            <div ref={movementKnobRef} className="dt-splat-movement-knob" />
          </div>
          <span>GERAK</span>
        </div>
        <div className="dt-splat-status" role={error ? 'alert' : 'status'} aria-live="polite">
          {error ? (
            <span>{error}</span>
          ) : (
            <>
              <span>{status}</span>
              {progress !== null && <progress max={1} value={progress} aria-label="Progres pemuatan potongan" />}
            </>
          )}
          <span className="dt-splat-controls-hint">
            Render distance {RENDER_DISTANCE} · WASD bergerak · Q/E naik/turun · Z/C tilt · klik dan seret · Shift berlari
          </span>
          <small>Lokasi scene belum terkalibrasi terhadap koordinat peta.</small>
        </div>
      </section>
    </div>
  )
}
