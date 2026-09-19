<script setup lang="ts">
import { computed } from 'vue'
import { ICON_PATHS, type IconName } from './icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    /** 尺寸（px），默认 16 */
    size?: number
    strokeWidth?: number
  }>(),
  { size: 16, strokeWidth: 2 },
)

const inner = computed(() => ICON_PATHS[props.name])
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="inline-block shrink-0 align-[-0.15em]"
    aria-hidden="true"
    v-html="inner"
  />
</template>
