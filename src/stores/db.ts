import Dexie, { type Table } from 'dexie'
import type { TravelRecord } from '../types'

export class TravelDB extends Dexie {
  records!: Table<TravelRecord, string>

  constructor() {
    super('travel-wish-map')
    this.version(1).stores({
      records: 'id, attractionId, type, date, createdAt',
    })
  }
}

export const db = new TravelDB()
