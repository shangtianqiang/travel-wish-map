import type { Attraction, AttractionPhoto, City } from '../types'
import citiesJson from './cities.json'
import provincesGeo from './geo/china-provinces.json'
import cityBoundariesGeo from './geo/city-boundaries.json'
import photosJson from './attraction-photos.json'

export const cities = (citiesJson as { cities: City[] }).cities

export const cityById = new Map(cities.map((c) => [c.id, c]))

export const provinces = provincesGeo as ProvinceFeature[]

export interface ProvinceFeature {
  adcode: number
  name: string
  geometry: GeoJsonGeometry
}

export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

/** adcode -> 城市边界几何；没有边界文件的城市（如直辖市与省界重合）回退省界 */
export const cityBoundaries = cityBoundariesGeo as Record<string, GeoJsonGeometry>

const modules = import.meta.glob('./attractions/*.json', { eager: true }) as Record<
  string,
  { attractions: Attraction[] }
>

export const attractions: Attraction[] = Object.values(modules)
  .flatMap((m) => m.attractions)
  .sort((a, b) => a.id.localeCompare(b.id))

export const attractionsByCity = new Map<string, Attraction[]>()
for (const a of attractions) {
  const list = attractionsByCity.get(a.cityId)
  if (list) list.push(a)
  else attractionsByCity.set(a.cityId, [a])
}

export const attractionById = new Map(attractions.map((a) => [a.id, a]))

/** attractionId -> Wikimedia Commons 真实照片（1-3 张），无照片的景点不在此映射中 */
export const attractionPhotos = new Map<string, AttractionPhoto[]>(
  Object.entries(photosJson as Record<string, AttractionPhoto[]>).filter(
    ([, photos]) => photos && photos.length > 0
  )
)
