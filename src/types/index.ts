export interface City {
  id: string
  name: string
  province: string
  adcode: number
  /** [lng, lat] */
  center: [number, number]
}

export interface Attraction {
  id: string
  cityId: string
  name: string
  lng: number
  lat: number
  category: AttractionCategory
  intro: string
}

/** 来自 Wikimedia Commons 的景点真实照片 */
export interface AttractionPhoto {
  /** 800px 缩略图地址 */
  url: string
  /** Commons 文件页（查看原图与作者署名） */
  page: string
  /** File: 文件名 */
  title: string
}

export type AttractionCategory =
  | '历史古迹'
  | '自然风光'
  | '园林'
  | '宗教寺庙'
  | '古镇村落'
  | '博物馆'
  | '城市地标'
  | '主题乐园'
  | '街区'

export type RecordType = 'wish' | 'visit'

export interface TravelRecord {
  id: string
  attractionId: string
  type: RecordType
  /** visit 专有：打卡日期 YYYY-MM-DD，支持补录 */
  date?: string
  note?: string
  photos?: Blob[]
  createdAt: number
}

/** 景点的用户状态：none（未点亮）/ wish（心愿）/ lit（点亮） */
export type AttractionStatus = 'none' | 'wish' | 'lit'

export interface CityProgress {
  cityId: string
  total: number
  lit: number
}

export interface ProvinceProgress {
  province: string
  totalCities: number
  litCities: number
}
