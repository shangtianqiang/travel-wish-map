<script setup lang="ts">
import { computed, ref } from 'vue'
import { attractionById, cityById } from '../data'
import { useRecordsStore } from '../stores/records'

const props = defineProps<{
  attractionId: string
  onFlyTo?: () => void
}>()

const records = useRecordsStore()

const attraction = computed(() => attractionById.get(props.attractionId))
const city = computed(() => {
  const a = attraction.value
  return a ? cityById.get(a.cityId) : undefined
})

const status = computed(() => records.statusOf(props.attractionId))
const visits = computed(() =>
  records.recordsByAttraction
    .get(props.attractionId)
    ?.filter((r) => r.type === 'visit') ?? []
)

const showForm = ref(false)
const formDate = ref(new Date().toISOString().slice(0, 10))
const formNote = ref('')
const formPhotos = ref<Blob[]>([])

function today() {
  formDate.value = new Date().toISOString().slice(0, 10)
}

function onPhotosPicked(e: Event) {
  const input = e.target as HTMLInputElement
  for (const file of input.files ?? []) {
    if (file.type.startsWith('image/')) formPhotos.value.push(file)
  }
  input.value = ''
}

function removePhoto(i: number) {
  formPhotos.value.splice(i, 1)
}

async function submitCheckIn() {
  await records.checkIn({
    attractionId: props.attractionId,
    date: formDate.value,
    note: formNote.value,
    photos: formPhotos.value.length ? formPhotos.value : undefined,
  })
  showForm.value = false
  formNote.value = ''
  formPhotos.value = []
  today()
}

function toggleWish() {
  void records.setWish(props.attractionId, status.value !== 'wish')
}

async function removeVisit(recordId: string) {
  await records.removeRecord(recordId)
}
</script>

<template>
  <div v-if="attraction" class="attraction-card p-3.5 pt-8">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="font-bold text-[15px] text-glow-300 leading-snug">
          <span v-if="status === 'lit'">🌟</span>
          <span v-else-if="status === 'wish'">⚑</span>
          {{ attraction.name }}
        </h3>
        <p class="text-[11px] text-slate-400 mt-0.5">
          {{ city?.name }} · {{ city?.province }} · {{ attraction.category }}
        </p>
      </div>
      <button
        v-if="onFlyTo"
        class="shrink-0 text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 hover:text-glow-300 hover:border-glow-500/40 transition"
        @click="onFlyTo()"
      >
        定位
      </button>
    </div>

    <p class="text-xs text-slate-300/90 leading-relaxed mt-2">{{ attraction.intro }}</p>

    <!-- 已有打卡记录 -->
    <div v-if="visits.length" class="mt-3 space-y-1.5">
      <div
        v-for="v in visits"
        :key="v.id"
        class="flex items-start gap-2 text-[11px] px-2.5 py-1.5 rounded-lg bg-glow-500/8 border border-glow-500/20"
      >
        <span class="text-glow-400 font-mono tabular-nums shrink-0">{{ v.date }}</span>
        <span class="text-slate-300 min-w-0 break-words">{{ v.note || '已点亮 ✨' }}</span>
        <button
          class="ml-auto shrink-0 text-slate-500 hover:text-red-400 transition"
          title="删除打卡"
          @click="removeVisit(v.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 打卡表单 -->
    <div v-if="showForm" class="mt-3 space-y-2">
      <div class="flex items-center gap-2">
        <label class="text-[11px] text-slate-400 shrink-0">日期</label>
        <input
          v-model="formDate"
          type="date"
          class="flex-1 min-w-0 px-2 py-1 rounded-md bg-night-700 border border-white/10 text-xs text-slate-200 outline-none focus:border-glow-500/60"
        />
      </div>
      <textarea
        v-model="formNote"
        rows="2"
        placeholder="写下此刻的感受（可选）…"
        class="w-full px-2 py-1.5 rounded-md bg-night-700 border border-white/10 text-xs text-slate-200 outline-none resize-none focus:border-glow-500/60"
      />
      <div v-if="formPhotos.length" class="flex flex-wrap gap-1.5">
        <span
          v-for="i in formPhotos.length"
          :key="i"
          class="relative text-[10px] px-2 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300"
        >
          照片{{ i + 1 }}
          <button class="ml-1 text-slate-500 hover:text-red-400" @click="removePhoto(i)">✕</button>
        </span>
      </div>
      <label class="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-glow-300 transition cursor-pointer">
        📷 添加照片
        <input type="file" accept="image/*" multiple class="hidden" @change="onPhotosPicked" />
      </label>
      <div class="flex gap-2">
        <button
          class="flex-1 py-1.5 rounded-lg bg-glow-500 text-[var(--c-on-accent)] text-xs font-bold hover:bg-glow-400 transition"
          @click="submitCheckIn"
        >
          ✨ 确认点亮
        </button>
        <button
          class="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:text-slate-200 transition"
          @click="showForm = false"
        >
          取消
        </button>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div v-else class="flex gap-2 mt-3">
      <button
        v-if="status !== 'lit'"
        class="flex-1 py-1.5 rounded-lg text-xs font-medium transition border"
        :class="
          status === 'wish'
            ? 'bg-wish-400/15 text-wish-400 border-wish-400/40 hover:bg-wish-400/25'
            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
        "
        @click="toggleWish"
      >
        {{ status === 'wish' ? '取消心愿' : '⭐ 我想去' }}
      </button>
      <button
        class="flex-1 py-1.5 rounded-lg bg-glow-500/90 text-[var(--c-on-accent)] text-xs font-bold hover:bg-glow-400 transition"
        @click="showForm = true"
      >
        {{ status === 'lit' ? '再打卡一次' : '🌟 打卡点亮' }}
      </button>
    </div>
  </div>
</template>
