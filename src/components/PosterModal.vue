<script setup lang="ts">
import { ref, watch } from 'vue'
import { renderPoster } from '../utils/poster'

const props = defineProps<{
  open: boolean
  litCityIds: Set<string>
  litProvinces: Set<string>
  litAttractionIds: Set<string>
}>()
const emit = defineEmits<{ close: [] }>()

const dataUrl = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const canvas = renderPoster({
      litCityIds: props.litCityIds,
      litProvinces: props.litProvinces,
      litAttractionIds: props.litAttractionIds,
    })
    dataUrl.value = canvas.toDataURL('image/png')
  },
)

function download() {
  const a = document.createElement('a')
  a.href = dataUrl.value
  a.download = `旅游心愿地图-${new Date().toISOString().slice(0, 10)}.png`
  a.click()
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="open"
      class="absolute inset-0 z-[1300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="emit('close')"
    >
      <div class="max-h-full flex flex-col items-center gap-3">
        <img
          v-if="dataUrl"
          :src="dataUrl"
          alt="点亮海报"
          class="max-h-[75vh] max-w-full rounded-xl border border-glow-500/30 shadow-[0_0_60px_rgba(246,196,83,0.15)]"
        />
        <div class="flex gap-2">
          <button
            class="px-5 py-2 rounded-xl bg-glow-500 text-night-900 text-sm font-bold hover:bg-glow-400 transition"
            @click="download"
          >
            ⬇️ 保存海报
          </button>
          <button
            class="px-5 py-2 rounded-xl bg-white/8 border border-white/15 text-sm text-slate-300 hover:text-slate-100 transition"
            @click="emit('close')"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
