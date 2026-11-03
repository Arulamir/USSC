import { ApiService } from './api'

export type NodeConfig = {
  id: number; node_key: string; name: string; category: string; location: string | null; enabled: number
  metric_id: number | null; metric_key: string | null; metric_name: string | null; mqtt_topic: string | null
  payload_path: string | null; unit: string | null; prefix: string | null; suffix: string | null
  icon: string | null; chart_type: 'none' | 'line' | 'bar' | null; display_order: number | null; metric_enabled: number | null
}
export type DashboardCard = { id: string; nodeKey: string; metricKey: string; title?: string; order: number }
export type MenuItem = { id: string; label: string; path: string; icon: string; order: number; enabled: boolean }
export type MonitoringConfig = { nodes: NodeConfig[]; dashboard: { cards: DashboardCard[] }; menu: { items: MenuItem[] } }
export type Reading = { node_key: string; metric_key: string; value: number; observed_at: string | null; received_at: string; quality: string }

export const NodeManagerApi = {
  getConfig: () => ApiService.request<MonitoringConfig>('/api/monitoring/config'),
  getLatest: () => ApiService.request<{ readings: Reading[] }>('/api/monitoring/latest'),
  getHistory: (nodeKey: string, metricKey: string, limit = 100) =>
    ApiService.request<{ readings: Array<{ value: number; received_at: string; observed_at: string | null }> }>(`/api/monitoring/history/${encodeURIComponent(nodeKey)}/${encodeURIComponent(metricKey)}?limit=${limit}`),
  saveConfig: (key: 'dashboard' | 'menu', body: object, token: string) =>
    ApiService.request(`/api/monitoring/config/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
  createNode: (body: object, token: string) => ApiService.request('/api/monitoring/nodes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }),
  createMetric: (nodeKey: string, body: object, token: string) => ApiService.request(`/api/monitoring/nodes/${encodeURIComponent(nodeKey)}/metrics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }),
}
