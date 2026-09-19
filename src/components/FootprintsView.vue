<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useStats } from '../composables/stats'
import { useRecordsStore } from '../stores/records'
import { attractionById, attractionsByCity, cities, cityById } from '../data'
import type { TravelRecord } from '../types'

const emit = defineEmits<{ close: [] }>()
const records = useRecordsStore()
const { litAttractions, litCityIds, litProvinces, records: _r } = useStats()

const tab = ref<'stats' | 'wishes' | 'diary'>('stats')

/* ---------- 看板 ---------- */
const provincesWithCities = computed(() => {
  const byProvince = new Map<string, { total: number; lit: number }>()
  for (const c of cities) {
    if (!attractionsByCity.has(c.id)) continue
    const row = byProvince.get(c.province) ?? { total: 0, lit: 0 }
    row.total += 1
    if (litCityIds.value.has(c.id)) row.lit += 1
    byProvince.set(c.province, row)
  }
  return [...byProvince.entries()]
    .map(([name, row]) => ({ name, ...row, pct: row.total ? row.lit / row.total : 0 }))
    .sort((a, b) => b.lit - a.lit || b.pct - a.pct)
})

const totalAttractions = computed(() => {
  let n = 0
  for (const list of attractionsByCity.values()) n += list.length
  return n
})

const headline = computed(() => [
  { icon: '🌟', label: '点亮景点', value: litAttractions.value.size, sub: `共 ${totalAttractions.value} 个` },
  { icon: '🏙️', label: '点亮城市', value: litCityIds.value.size, sub: `共 ${attractionsByCity.size} 城` },
  { icon: '🗺️', label: '走过省份', value: litProvinces.value.size, sub: '全国 31 省区市' },
])

/* ---------- 心愿 ---------- */
const wishes = computed(() => {
  const out: { attractionId: string; record: TravelRecord }[] = []
  for (const r of records.records) {
    if (r.type === 'wish' && attractionById.has(r.attractionId)) {
      out.push({ attractionId: r.attractionId, record: r })
    }
  }
  return out.sort((a, b) => b.record.createdAt - a.record.createdAt)
})

async function fulfillWish(attractionId: string) {
  await records.checkIn({ attractionId, date: new Date().toISOString().slice(0, 10) })
}

/* ---------- 日记 ---------- */
const visits = computed(() => {
  const out: TravelRecord[] = []
  for (const r of records.records) {
    if (r.type === 'visit' && attractionById.has(r.attractionId)) out.push(r)
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt - a.createdAt)
})

const editingId = ref<string | null>(null)
const editNote = ref('')
const editDate = ref('')

function startEdit(r: TravelRecord) {
  editingId.value = r.id
  editNote.value = r.note ?? ''
  editDate.value = r.date ?? ''
}

async function saveEdit(r: TravelRecord) {
  await records.updateRecord(r.id, { note: editNote.value, date: editDate.value })
  editingId.value = null
}

/* 照片预览 URL 管理 */
const photoUrls = ref(new Map<string, string>())
function photoUrl(r: TravelRecord, i: number): string {
  const key = `${r.id}:${i}`
  let url = photoUrls.value.get(key)
  const blob = r.photos?.[i]
  if (!url && blob) {
    url = URL.createObjectURL(blob)
    photoUrls.value.set(key, url)
  }
  return url ?? ''
}
onMounted(() => {
  void records.load()
})
watch(
  () => records.records,
  () => {
    // 记录删除后回收无主的对象 URL
    const alive = new Set<string>()
    for (const r of records.records) {
      r.photos?.forEach((_, i) => alive.add(`${r.id}:${i}`))
    }
    for (const [key, url] of photoUrls.value) {
      if (!alive.has(key)) {
        URL.revokeObjectURL(url)
        photoUrls.value.delete(key)
      }
    }
  },
)

function nameOf(id: string) {
  return attractionById.get(id)?.name ?? id
}
function cityOf(id: string) {
  const a = attractionById.get(id)
  return a ? cityById.get(a.cityId) : undefined
}
</script>

<template>
  <div class="absolute inset-0 z-[1150] bg-night-900 overflow-hidden flex flex-col">
    <div class="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/8">
      <button
        class="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:text-glow-300 transition"
        @click="emit('close')"
      >
        ← 返回地图
      </button>
      <div class="flex gap-1">
        <button
          v-for="t in [
            { key: 'stats', label: '📊 看板' },
            { key: 'wishes', label: '⚑ 心愿' },
            { key: 'diary', label: '📖 日记' },
          ]"
          :key="t.key"
          class="px-3.5 py-1.5 rounded-lg text-xs font-medium transition"
          :class="tab === t.key ? 'bg-glow-500/15 text-glow-300 border border-glow-500/40' : 'text-slate-400 hover:text-slate-200'"
          @click="tab = t.key as typeof tab"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-4">
      <!-- ============ 看板 ============ -->
      <div v-if="tab === 'stats'" class="max-w-3xl mx-auto space-y-5">
        <div class="grid grid-cols-3 gap-3">
          <div
            v-for="h in headline"
            :key="h.label"
            class="rounded-2xl p-4 bg-gradient-to-b from-night-700/80 to-night-800 border border-glow-500/15 text-center"
          >
            <div class="text-xl">{{ h.icon }}</div>
            <div class="text-2xl sm:text-3xl font-black text-glow-300 tabular-nums mt-1">{{ h.value }}</div>
            <div class="text-xs text-slate-300 mt-0.5">{{ h.label }}</div>
            <div class="text-[10px] text-slate-500">{{ h.sub }}</div>
          </div>
        </div>

        <div class="rounded-2xl bg-night-800 border border-white/8 p-4">
          <h3 class="text-sm font-bold text-slate-200 mb-3">省份点亮进度</h3>
          <div class="space-y-2.5">
            <div v-for="p in provincesWithCities" :key="p.name" class="flex items-center gap-3">
              <span class="w-16 shrink-0 text-xs" :class="p.lit ? 'text-glow-300' : 'text-slate-500'">{{ p.name }}</span>
              <div class="flex-1 h-2 rounded-full bg-white/6 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="p.lit ? 'bg-gradient-to-r from-glow-500 to-glow-300' : ''"
                  :style="{ width: `${p.pct * 100}%` }"
                />
              </div>
              <span class="w-12 shrink-0 text-right text-[11px] tabular-nums" :class="p.lit ? 'text-slate-300' : 'text-slate-600'">
                {{ p.lit }}/{{ p.total }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ 心愿清单 ============ -->
      <div v-else-if="tab === 'wishes'" class="max-w-2xl mx-auto">
        <div v-if="!wishes.length" class="text-center py-16 text-slate-500 text-sm">
          <div class="text-3xl mb-2">⚑</div>
          还没有心愿。在地图上点击任意景点，点「我想去」加入心愿清单。
        </div>
        <div v-else class="space-y-2.5">
          <div
            v-for="w in wishes"
            :key="w.record.id"
            class="flex items-center gap-3 px-4 py-3 rounded-xl bg-night-800 border border-wish-400/20"
          >
            <span class="text-lg">⚑</span>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-slate-200 truncate">{{ nameOf(w.attractionId) }}</div>
              <div class="text-[11px] text-slate-500 truncate">
                {{ cityOf(w.attractionId)?.name }} · {{ cityOf(w.attractionId)?.province }}
              </div>
            </div>
            <button
              class="shrink-0 px-2.5 py-1 rounded-lg bg-glow-500/15 text-glow-300 text-[11px] border border-glow-500/30 hover:bg-glow-500/25 transition"
              @click="fulfillWish(w.attractionId)"
            >
              ✓ 已打卡
            </button>
            <button
              class="shrink-0 text-slate-500 hover:text-red-400 text-xs transition"
              title="移除心愿"
              @click="records.removeRecord(w.record.id)"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <!-- ============ 打卡日记 ============ -->
      <div v-else class="max-w-2xl mx-auto">
        <div v-if="!visits.length" class="text-center py-16 text-slate-500 text-sm">
          <div class="text-3xl mb-2">🌟</div>
          还没有打卡记录。去地图点亮第一个地方吧！
        </div>
        <div v-else class="relative pl-6">
          <div class="absolute left-2 top-1 bottom-1 w-px bg-gradient-to-b from-glow-500/50 via-white/10 to-transparent" />
          <div v-for="v in visits" :key="v.id" class="relative pb-6">
            <span class="absolute -left-[18px] top-1.5 w-2.5 h-2.5 rounded-full bg-glow-400 shadow-[0_0_8px_rgba(246,196,83,0.9)]" />
            <div class="rounded-xl bg-night-800 border border-white/8 p-3.5">
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono text-glow-400 tabular-nums">{{ v.date }}</span>
                <span class="text-sm font-bold text-slate-200 truncate">{{ nameOf(v.attractionId) }}</span>
                <span class="text-[10px] text-slate-500 shrink-0">{{ cityOf(v.attractionId)?.name }}</span>
                <div class="ml-auto flex gap-1.5 shrink-0">
                  <button class="text-[11px] text-slate-500 hover:text-glow-300 transition" @click="startEdit(v)">编辑</button>
                  <button class="text-[11px] text-slate-500 hover:text-red-400 transition" @click="records.removeRecord(v.id)">删除</button>
                </div>
              </div>

              <p v-if="editingId !== v.id" class="text-xs text-slate-300/90 mt-1.5 whitespace-pre-wrap">
                {{ v.note || '（无感想）' }}
              </p>
              <div v-else class="mt-2 space-y-2">
                <input
                  v-model="editDate"
                  type="date"
                  class="w-40 px-2 py-1 rounded-md bg-night-700 border border-white/10 text-xs outline-none focus:border-glow-500/60"
                />
                <textarea
                  v-model="editNote"
                  rows="3"
                  class="w-full px-2 py-1.5 rounded-md bg-night-700 border border-white/10 text-xs outline-none resize-none focus:border-glow-500/60"
                />
                <div class="flex gap-2">
                  <button
                    class="px-3 py-1 rounded-lg bg-glow-500 text-night-900 text-xs font-bold"
                    @click="saveEdit(v)"
                  >
                    保存
                  </button>
                  <button
                    class="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400"
                    @click="editingId = null"
                  >
                    取消
                  </button>
                </div>
              </div>

              <div v-if="v.photos?.length" class="flex gap-1.5 mt-2">
                <img
                  v-for="i in v.photos.length"
                  :key="i"
                  :src="photoUrl(v, i)"
                  class="w-16 h-16 object-cover rounded-lg border border-white/10"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
