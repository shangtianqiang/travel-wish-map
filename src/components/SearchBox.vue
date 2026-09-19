<script setup lang="ts">
import { computed, ref } from 'vue'
import { attractions, cities } from '../data'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{
  pickAttraction: [attractionId: string]
  pickCity: [cityId: string]
}>()

const query = ref('')
const focused = ref(false)

interface Hit {
  type: 'city' | 'attraction'
  id: string
  title: string
  subtitle: string
}

const hits = computed<Hit[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  const out: Hit[] = []
  for (const c of cities) {
    if (c.name.toLowerCase().includes(q) || c.province.toLowerCase().includes(q)) {
      out.push({ type: 'city', id: c.id, title: c.name, subtitle: `${c.province} · 全部景点` })
    }
  }
  for (const a of attractions) {
    if (a.name.toLowerCase().includes(q)) {
      const city = cities.find((c) => c.id === a.cityId)
      out.push({ type: 'attraction', id: a.id, title: a.name, subtitle: `${city?.name ?? ''} · ${a.category}` })
    }
  }
  return out.slice(0, 9)
})

function pick(hit: Hit) {
  query.value = ''
  focused.value = false
  if (hit.type === 'city') emit('pickCity', hit.id)
  else emit('pickAttraction', hit.id)
}
</script>

<template>
  <div class="absolute left-3 top-3 z-[1050] w-64">
    <input
      v-model="query"
      type="text"
      autocomplete="off"
      placeholder="搜索城市或景点…"
      class="w-full px-3.5 py-2 rounded-xl text-sm bg-night-800/90 backdrop-blur border border-white/15
             text-slate-100 placeholder:text-slate-500 outline-none focus:border-glow-500/60 transition"
      @focus="focused = true"
      @blur="focused = false"
    />
    <ul
      v-if="focused && hits.length"
      class="mt-1.5 overflow-hidden rounded-xl bg-night-800/95 backdrop-blur border border-white/15 shadow-2xl"
    >
      <li v-for="hit in hits" :key="hit.type + hit.id">
        <button
          class="w-full text-left px-3.5 py-2 hover:bg-glow-500/10 transition"
          @mousedown.prevent="pick(hit)"
        >
          <span class="block text-[13px] text-slate-200">
            <span
              class="inline-flex items-center gap-1"
              :class="hit.type === 'city' ? 'text-glow-400' : ''"
            >
              <AppIcon :name="hit.type === 'city' ? 'building' : 'star'" :size="12" />
            </span>
            {{ hit.title }}
          </span>
          <span class="block text-[10px] text-slate-500">{{ hit.subtitle }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
