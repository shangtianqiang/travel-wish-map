<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { THEMES, type ThemeId } from '../themes'
import { useThemeStore } from '../stores/theme'

const themeStore = useThemeStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function pick(id: ThemeId) {
  themeStore.setTheme(id)
  open.value = false
}

function onOutside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', onOutside))
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm transition
             bg-white/5 border border-white/10 hover:border-glow-500/50"
      title="切换主题"
      @click="open = !open"
    >
      {{ THEMES.find((t) => t.id === themeStore.theme)?.emoji }}
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="open"
        class="absolute right-0 top-10 w-56 rounded-xl overflow-hidden z-[1400]
               bg-night-800 border border-white/10 shadow-2xl backdrop-blur"
      >
        <p class="px-3.5 pt-2.5 pb-1.5 text-[10px] text-slate-500">选择主题</p>
        <button
          v-for="t in THEMES"
          :key="t.id"
          class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition"
          :class="t.id === themeStore.theme ? 'bg-glow-500/10' : 'hover:bg-white/5'"
          @click="pick(t.id)"
        >
          <span class="flex -space-x-1 shrink-0">
            <i
              v-for="c in t.swatch"
              :key="c"
              class="w-4 h-4 rounded-full border border-white/20"
              :style="{ background: c }"
            />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[13px] font-medium" :class="t.id === themeStore.theme ? 'text-glow-300' : 'text-slate-200'">
              {{ t.emoji }} {{ t.name }}
            </span>
            <span class="block text-[10px] text-slate-500">{{ t.desc }}</span>
          </span>
          <span v-if="t.id === themeStore.theme" class="text-glow-400 text-xs shrink-0">✓</span>
        </button>
      </div>
    </Transition>
  </div>
</template>
