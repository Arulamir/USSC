type MarkerType = MODES

export interface Marker {
  id: number
  name: string
  date: string | Date
  latitude: number
  longitude: number
  photo: string
  photo_360: string
  lux: number | null
  done: number | null
  condition: string
  mode: string
  marker_type: MarkerType
}

export type MarkerChanges = Partial<Omit<Marker, 'id'>>
export type MarkerField = 'photo' | 'photo_360'
export type MarkerUpdate = (id: number, changes: MarkerChanges) => void | Promise<void>

export interface LocationPoint {
  id: string
  lat: number
  lng: number
  lux?: number
  timestamp?: number
}

export interface MarkerViewerImage {
  type: 'photo' | '360'
  image: string
}

export type ViewerImage = MarkerViewerImage

export enum MODES {
  PJU = 'pju',
  KWH = 'kwh',
  INDOOR = 'indoor',
  TREE = 'tree',
  PJU_LUAR = 'pju_luar',
}

export const MODES_FORMAT = {
  kwh: { label: 'kWH Meter' },
  indoor: { label: 'Titik Lampu Indoor' },
  tree: { label: 'Tanaman Hutan' },
  pju: { label: 'PJU Hutan', lux: true },
  pju_luar: { label: 'PJU Luar', lux: true },
}

export enum CONDITIONS {
  GELAP = 'Gelap',
  REDUP = 'Redup',
  TERANG = 'Terang',
}

export const CONDITION_COLORS = {
  Gelap: ['#ef4444', '#b91c1c'],
  Redup: ['#eab308', '#a16207'],
  Terang: ['#22c55e', '#15803d'],
}
