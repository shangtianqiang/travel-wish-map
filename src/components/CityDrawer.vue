<script setup lang="ts">
import { computed } from 'vue'
import { attractionsByCity, cityById } from '../data'
import { useRecordsStore } from '../stores/records'
import { useStats } from '../composables/stats'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ cityId: string | null }>()
defineEmits<{ close: []; focus: [attractionId: string] }>()

const records = useRecordsStore()
const { litAttractions } = useStats()

const city = computed(() => (props.cityId ? cityById.get(props.cityId) : undefined))
const list = computed(() => (props.cityId ? attractionsByCity.get(props.cityId) ?? [] : []))
const litCount = computed(
  () => list.value.filter((a) => litAttractions.value.has(a.id)).length
)
</script>

<template>
  <Transition name="drawer">
    <aside
      v-if="city"
      class="absolute right-0 top-0 bottom-0 w-72 max-w-[80%] z-[1100] flex flex-col
             bg-night-800/95 backdrop-blur-md border-l border-glow-500/20 shadow-2xl"
    >
      <div class="px-4 pt-4 pb-3 border-b border-white/10">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-bold text-glow-300">{{ city.name }}</h2>
          <button class="text-slate-500 hover:text-slate-200 transition" @click="$emit('close')">
            <AppIcon name="x" :size="15" />
          </button>
        </div>
        <p class="text-[11px] text-slate-400 mt-0.5">{{ city.province }} · {{ list.length }} 个精选景点</p>
        <div class="mt-2.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
          <div
            class="h-full rounded-full bg-gradient-to-r from-glow-500 to-glow-300 transition-all duration-500"
            :style="{ width: list.length ? `${(litCount / list.length) * 100}%` : '0%' }"
          />
        </div>
        <p class="text-[11px] text-glow-400 mt-1.5">
          已点亮 {{ litCount }} / {{ list.length }}
        </p>
      </div>

      <div class="flex-1 overflow-y-auto py-2">
        <button
          v-for="a in list"
          :key="a.id"
          class="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-white/5 transition"
          @click="$emit('focus', a.id)"
        >
          <span class="shrink-0 w-4 flex justify-center">
            <AppIcon
              v-if="litAttractions.has(a.id)"
              name="star"
              :size="15"
              class="text-glow-400"
            />
            <AppIcon
              v-else-if="records.statusOf(a.id) === 'wish'"
              name="flag"
              :size="14"
              class="text-wish-400"
            />
            <i v-else class="w-1.5 h-1.5 rounded-full bg-slate-500/60" />
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="block text-[13px] truncate"
              :class="litAttractions.has(a.id) ? 'text-glow-300 font-medium' : 'text-slate-300'"
            >
              {{ a.name }}
            </span>
            <span class="block text-[10px] text-slate-500">{{ a.category }}</span>
          </span>
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
  opacity: 0.6;
}
</style>
