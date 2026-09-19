import { defineStore } from 'pinia'
import type { AttractionStatus, RecordType, TravelRecord } from '../types'
import { db } from './db'

const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 用户打卡/心愿数据层。所有方法 async——将来接 CloudBase 云同步时
 * 只替换这里的实现（db 调用换成远端 API），UI 层不变。
 */
export const useRecordsStore = defineStore('records', {
  state: () => ({
    records: [] as TravelRecord[],
    loaded: false,
  }),

  getters: {
    /** attractionId -> 该景点的所有记录 */
    recordsByAttraction(state): Map<string, TravelRecord[]> {
      const map = new Map<string, TravelRecord[]>()
      for (const r of state.records) {
        const list = map.get(r.attractionId)
        if (list) list.push(r)
        else map.set(r.attractionId, [r])
      }
      return map
    },

    /** attractionId -> 状态：lit > wish > none */
    statusOf(): (attractionId: string) => AttractionStatus {
      const byA = this.recordsByAttraction
      return (attractionId) => {
        const list = byA.get(attractionId)
        if (!list) return 'none'
        if (list.some((r) => r.type === 'visit')) return 'lit'
        return 'wish'
      }
    },

    litAttractionIds(): Set<string> {
      return new Set(this.records.filter((r) => r.type === 'visit').map((r) => r.attractionId))
    },

    wishAttractionIds(): Set<string> {
      return new Set(this.records.filter((r) => r.type === 'wish').map((r) => r.attractionId))
    },

    /** 每个城市的点亮进度（仅含有景点的城市） */
    cityProgress(): (countOf: (cityId: string) => number) => Map<string, { lit: number; total: number }> {
      return (countOf) => {
        const map = new Map<string, { lit: number; total: number }>()
        for (const r of this.records) {
          if (r.type !== 'visit') continue
          const cityId = r.attractionId.split('-').slice(0, -1).join('-')
          const cur = map.get(cityId) || { lit: 0, total: countOf(cityId) }
          cur.lit += 1
          map.set(cityId, cur)
        }
        return map
      }
    },
  },

  actions: {
    async load() {
      this.records = await db.records.toArray()
      this.loaded = true
    },

    async setWish(attractionId: string, wished: boolean) {
      const existing = await db.records
        .where('attractionId')
        .equals(attractionId)
        .filter((r) => r.type === 'wish')
        .first()
      if (wished && !existing) {
        await db.records.add({
          id: newId(),
          attractionId,
          type: 'wish' as RecordType,
          createdAt: Date.now(),
        })
      } else if (!wished && existing) {
        await db.records.delete(existing.id)
      }
      await this.load()
    },

    async checkIn(input: { attractionId: string; date?: string; note?: string; photos?: Blob[] }) {
      await db.records.add({
        id: newId(),
        attractionId: input.attractionId,
        type: 'visit',
        date: input.date || new Date().toISOString().slice(0, 10),
        note: input.note?.trim() || undefined,
        photos: input.photos,
        createdAt: Date.now(),
      })
      // 打卡后自动移除同景点心愿（心愿达成）
      const wish = await db.records
        .where('attractionId')
        .equals(input.attractionId)
        .filter((r) => r.type === 'wish')
        .first()
      if (wish) await db.records.delete(wish.id)
      await this.load()
    },

    async removeRecord(recordId: string) {
      await db.records.delete(recordId)
      await this.load()
    },

    async updateRecord(recordId: string, patch: Partial<Pick<TravelRecord, 'date' | 'note'>>) {
      await db.records.update(recordId, patch)
      await this.load()
    },
  },
})
