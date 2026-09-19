<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MapView from './components/MapView.vue'
import FootprintsView from './components/FootprintsView.vue'
import ThemeSwitcher from './components/ThemeSwitcher.vue'
import AppIcon from './components/AppIcon.vue'
import type { IconName } from './components/icons'
import { useStats } from './composables/stats'
import { useRecordsStore } from './stores/records'

const records = useRecordsStore()
const { litCityIds, litAttractions, litProvinces } = useStats()
const view = ref<'map' | 'footprints'>('map')

onMounted(() => {
  void records.load()
})

const stats = computed(() => [
  { icon: 'building' as IconName, label: '点亮城市', value: litCityIds.value.size },
  { icon: 'star' as IconName, label: '点亮景点', value: litAttractions.value.size },
  { icon: 'globe' as IconName, label: '走过省份', value: litProvinces.value.size },
])
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <header
      class="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-white/5 bg-night-800/90 backdrop-blur z-[1200]"
    >
      <h1 class="flex items-center gap-1.5 font-bold tracking-wide text-glow-400 text-sm sm:text-lg whitespace-nowrap">
        <AppIcon name="map" :size="18" class="sm:hidden" />
        <span class="hidden sm:inline flex items-center gap-1.5"><AppIcon name="map" :size="20" />旅游心愿地图</span>
        <span class="sm:hidden">心愿地图</span>
      </h1>

      <div class="flex-1 flex items-center justify-center gap-2 sm:gap-4 min-w-0 overflow-x-auto">
        <div
          v-for="s in stats"
          :key="s.label"
          class="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-white/5 border border-white/10 whitespace-nowrap"
        >
          <AppIcon :name="s.icon" :size="14" class="text-glow-400" />
          <span class="text-glow-400 font-bold text-sm sm:text-base tabular-nums">{{ s.value }}</span>
          <span class="hidden sm:inline text-[10px] sm:text-xs text-slate-400">{{ s.label }}</span>
        </div>
      </div>

      <ThemeSwitcher />

      <button
        class="shrink-0 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition
               bg-glow-500/10 text-glow-300 border border-glow-500/30 hover:bg-glow-500/20"
        @click="view = view === 'map' ? 'footprints' : 'map'"
      >
        {{ view === 'map' ? '我的足迹' : '返回地图' }}
      </button>
    </header>

    <main class="flex-1 relative min-h-0">
      <MapView />
      <FootprintsView v-if="view === 'footprints'" @close="view = 'map'" />
    </main>
  </div>
</template>
