import { io } from 'socket.io-client'
import type { Marker, MarkerChanges, LocationPoint } from '../types/Marker'

export class MarkerApi {
  static BASE_URL = '/admin/marker'

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(MarkerApi.BASE_URL + path, options)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || `Request failed (${response.status})`)
    }
    return response.json()
  }

  json(method: string, body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  }

  list(): Promise<Marker[]> {
    const params = new URLSearchParams({
      south: '-90',
      north: '90',
      west: '-180',
      east: '180',
    })
    return this.request<Marker[]>(`?${params.toString()}`)
  }
  create(data: MarkerChanges): Promise<Marker> {
    return this.request<Marker>('', this.json('POST', data))
  }
  update(id: number, data: MarkerChanges): Promise<Marker> {
    return this.request<Marker>(`/${id}`, this.json('PUT', data))
  }
  remove(id: number): Promise<{ message: string; id: number }> {
    return this.request<{ message: string; id: number }>(`/${id}`, { method: 'DELETE' })
  }
}

export class SocketConnection {
  static BASE_URL = typeof window === 'undefined' ? '' : window.location.origin
  private client: ReturnType<typeof io>
  constructor() {
    this.client = io(SocketConnection.BASE_URL, {
      path: '/admin/socket.io',
      // Next.js route handlers cannot proxy the WebSocket upgrade; connect via
      // HTTP long-polling through the existing route instead.
      transports: ['polling'],
    })
  }
  on(event: string, handler: (...args: any[]) => void): () => void {
    this.client.on(event, handler)
    return () => this.client.off(event, handler)
  }
  emit(event: string, data?: unknown): void {
    this.client.emit(event, data)
  }
  get id() {
    return this.client.id
  }
}
