import { computed } from 'vue'
import { useRecordsStore } from '../stores/records'
import { attractionById, cityById } from '../data'

/** 点亮统计：从打卡记录派生的全局只读数据 */
export function useStats() {
  const records = useRecordsStore()

  const litAttractions = computed(() => {
    const set = new Set<string>()
    for (const r of records.records) {
      if (r.type === 'visit') set.add(r.attractionId)
    }
    return set
  })

  const litCityIds = computed(() => {
    const set = new Set<string>()
    for (const id of litAttractions.value) {
      const a = attractionById.get(id)
      if (a) set.add(a.cityId)
    }
    return set
  })

  const litProvinces = computed(() => {
    const set = new Set<string>()
    for (const id of litCityIds.value) {
      const c = cityById.get(id)
      if (c) set.add(c.province)
    }
    return set
  })

  const totalCities = computed(() => new Set(attractionById ? [...new Set([...attractionById.values()].map((a) => a.cityId))] : []).size)

  return {
    records,
    litAttractions,
    litCityIds,
    litProvinces,
    totalCities,
  }
}
