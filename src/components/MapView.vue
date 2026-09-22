<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, createApp, type App as VueApp } from 'vue'
import L from 'leaflet'
import {
  attractionsByCity,
  attractionById,
  cities,
  cityBoundaries,
  cityById,
  provinces,
  type ProvinceFeature,
} from '../data'
import { useRecordsStore } from '../stores/records'
import { useThemeStore } from '../stores/theme'
import { useStats } from '../composables/stats'
import { pinia } from '../pinia'
import { centroidOfGeometry, shortProvinceName, PROVINCE_LABEL_OVERRIDE } from '../utils/geo'
import AttractionCard from './AttractionCard.vue'
import CityDrawer from './CityDrawer.vue'
import PosterModal from './PosterModal.vue'
import SearchBox from './SearchBox.vue'
import AppIcon from './AppIcon.vue'
import { ICON_PATHS } from './icons'

const records = useRecordsStore()
const { litCityIds, litProvinces, litAttractions } = useStats()
const themeStore = useThemeStore()

const mapEl = ref<HTMLElement | null>(null)
const drawerCityId = ref<string | null>(null)
const showPoster = ref(false)

let map: L.Map | null = null
let canvasRenderer: L.Canvas | null = null
let popup: L.Popup | null = null
let popupApp: VueApp | null = null
let resizeObserver: ResizeObserver | null = null

const provincePaths = new Map<number, L.Path>()
const cityPaths = new Map<string, L.Polygon>()
const markers = new Map<string, L.CircleMarker>()
const overlayMarkers = new Map<string, L.Marker>()
const cityLabels = new Map<string, L.Marker>()
const cityNameLabels = new Map<string, L.Marker>()

/** 城市名标注在此缩放级别以上显示 */
const CITY_NAME_ZOOM = 5.5

const provinceNameOfAdcode = new Map(provinces.map((p) => [p.adcode, p.name]))

/** 心愿旗帜（Leaflet divIcon 为原生 HTML，需内联 SVG，样式由 .wish-flag 控制） */
const WISH_FLAG_SVG = `<svg class="wish-flag" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS.flag}</svg>`

function focusAttraction(aId: string) {
  const a = attractionById.get(aId)
  if (!a || !map) return
  map.flyTo([a.lat, a.lng], Math.max(map.getZoom(), 8), { duration: 0.8 })
  openAttractionPopup(aId)
}

/** 城市名标注显隐：放大后显示，点亮的城市由进度角标代替 */
function syncCityNameVisibility() {
  const visible = (map?.getZoom() ?? 0) >= CITY_NAME_ZOOM
  for (const [cityId, marker] of cityNameLabels) {
    const el = marker.getElement()
    if (el) el.style.display = visible && !cityProgress.value.has(cityId) ? '' : 'none'
  }
}

/** 地图配色随主题变化；radius/weight 等形状参数与主题无关 */
const S = computed(() => {
  const p = themeStore.palette
  return {
    provinceBase: { color: p.provinceStroke, weight: 0.6, fillColor: p.provinceFill, fillOpacity: 0.85 },
    provinceLit: { color: p.provinceStrokeLit, weight: 1.4, fillColor: p.provinceFill, fillOpacity: 0.85 },
    cityBase: { color: p.cityStroke, weight: 0.9, fillColor: p.cityFill, fillOpacity: 0.9 },
    cityHover: { color: p.cityHoverStroke, weight: 1.4, fillColor: p.cityHoverFill, fillOpacity: 0.9 },
    cityLit: { color: p.cityLitStroke, weight: 1.8, fillColor: p.cityLitFill, fillOpacity: 1 },
    dotNone: { radius: 3, weight: 1, color: p.dotNoneStroke, fillColor: p.dotNoneFill, fillOpacity: 0.95 },
    dotWish: { radius: 4, weight: 1.2, color: p.wishStroke, fillColor: p.wish, fillOpacity: 1 },
    dotLit: { radius: 4.5, weight: 1.5, color: p.litStroke, fillColor: p.litFill, fillOpacity: 1 },
  }
})

const cityProgress = computed(() => {
  const out = new Map<string, { lit: number; total: number }>()
  for (const [cityId, list] of attractionsByCity) {
    let lit = 0
    for (const a of list) if (litAttractions.value.has(a.id)) lit += 1
    if (lit > 0) out.set(cityId, { lit, total: list.length })
  }
  return out
})

function provinceFeatureCollection() {
  return {
    type: 'FeatureCollection' as const,
    features: provinces.map((p: ProvinceFeature) => ({
      type: 'Feature' as const,
      properties: { name: p.name, adcode: p.adcode },
      geometry: p.geometry,
    })),
  }
}

function applyDotStyle(aId: string) {
  const marker = markers.get(aId)
  if (!marker) return
  const status = records.statusOf(aId)
  if (status === 'lit') marker.setStyle({ ...S.value.dotLit })
  else if (status === 'wish') marker.setStyle({ ...S.value.dotWish })
  else marker.setStyle({ ...S.value.dotNone })
}

function syncOverlays() {
  for (const [cityId, progress] of cityProgress.value) {
    // 城市边界点亮（无条件重涂，保证主题切换后颜色同步）
    const path = cityPaths.get(cityId)
    if (path) {
      path.setStyle({ ...S.value.cityLit })
      ;(path as unknown as { isLit?: boolean }).isLit = true
      path.getElement()?.classList.add('city-lit')
    }
    // 进度标签
    if (!cityLabels.has(cityId)) {
      const city = cityById.get(cityId)
      if (!city) continue
      const label = L.marker([city.center[1], city.center[0]], {
        icon: L.divIcon({
          className: '',
          html: `<div class="city-label">${city.name} <b>${progress.lit}/${progress.total}</b></div>`,
          iconSize: [0, 0],
        }),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(map!)
      cityLabels.set(cityId, label)
    } else {
      const city = cityById.get(cityId)!
      const el = cityLabels.get(cityId)!.getElement()
      if (el) el.innerHTML = `<div class="city-label">${city.name} <b>${progress.lit}/${progress.total}</b></div>`
    }
  }

  // 未点亮的城市：恢复底色 + 移除标签
  for (const [cityId, path] of cityPaths) {
    const el = path.getElement()
    const lit = cityProgress.value.has(cityId)
    if (el) el.classList.toggle('city-lit', lit)
    if (!lit) {
      path.setStyle({ ...S.value.cityBase })
      ;(path as unknown as { isLit?: boolean }).isLit = false
    }
  }
  for (const [cityId, label] of cityLabels) {
    if (!cityProgress.value.has(cityId)) {
      label.remove()
      cityLabels.delete(cityId)
    }
  }

  // 省描边点亮（省界特征名为全称如"浙江省"，与城市数据的简称做前缀匹配）
  for (const [adcode, path] of provincePaths) {
    const fullName = provinceNameOfAdcode.get(adcode)
    const lit = fullName ? [...litProvinces.value].some((p) => fullName.startsWith(p)) : false
    path.setStyle(lit ? { ...S.value.provinceLit } : { ...S.value.provinceBase })
    const el = path.getElement()
    if (el) el.classList.toggle('province-lit', lit)
  }

  // 景点点样式 + 光晕/旗帜覆盖层
  // 景点点样式 + 光晕/旗帜覆盖层
  for (const aId of markers.keys()) applyDotStyle(aId)
  const wishIds = records.wishAttractionIds
  for (const [aId, marker] of overlayMarkers) {
    const still =
      (litAttractions.value.has(aId) && marker.options.icon?.options.className === 'glow-wrap') ||
      (wishIds.has(aId) && !litAttractions.value.has(aId) && marker.options.icon?.options.className === 'wish-wrap')
    if (!still) {
      marker.remove()
      overlayMarkers.delete(aId)
    }
  }
  for (const aId of litAttractions.value) {
    if (overlayMarkers.has(aId)) continue
    const a = attractionById.get(aId)
    if (!a) continue
    const m = L.marker([a.lat, a.lng], {
      icon: L.divIcon({ className: 'glow-wrap', html: '<span class="glow-dot"><i></i></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
      zIndexOffset: 800,
    }).addTo(map!)
    overlayMarkers.set(aId, m)
  }
  for (const aId of wishIds) {
    if (litAttractions.value.has(aId) || overlayMarkers.has(aId)) continue
    const a = attractionById.get(aId)
    if (!a) continue
    const m = L.marker([a.lat, a.lng], {
      icon: L.divIcon({ className: 'wish-wrap', html: WISH_FLAG_SVG, iconSize: [16, 16], iconAnchor: [8, 16] }),
      interactive: false,
      zIndexOffset: 600,
    }).addTo(map!)
    overlayMarkers.set(aId, m)
  }

  // 点亮状态变化会影响城市名标注的显隐（点亮城市由进度角标代替）
  syncCityNameVisibility()
}

function openAttractionPopup(aId: string) {
  const a = attractionById.get(aId)
  if (!a || !map) return
  popupApp?.unmount()
  const host = document.createElement('div')
  popupApp = createApp(AttractionCard, {
    attractionId: aId,
    onFlyTo: () => {
      map!.flyTo([a.lat, a.lng], Math.max(map!.getZoom(), 8), { duration: 0.8 })
    },
  })
  popupApp.use(pinia)
  popupApp.mount(host)

  popup ??= L.popup({
    className: 'attraction-popup',
    closeButton: true,
    autoPan: true,
    offset: L.point(0, -6),
    maxWidth: 280,
  })
    .on('add', () => {
      // Leaflet 1.9 只在弹窗容器上拦截 mousedown，click 靠 e.target 祖先链上的
      // _leaflet_disable_click 标记屏蔽。Vue 在可信点击的监听器间隙会刷新微任务、
      // 同步替换弹窗内容（如展开打卡表单），此时 e.target 已脱离文档，祖先链判定
      // 失效，地图会收到 preclick 把弹窗误关。容器本身不会被替换，在容器上显式
      // 阻止 click/mouseup 冒泡即可与内容重渲染无关地屏蔽地图点击。
      const el = popup?.getElement()
      if (el) L.DomEvent.on(el, 'click mouseup', L.DomEvent.stopPropagation)
    })
    .on('remove', () => {
      popupApp?.unmount()
      popupApp = null
    })

  popup.setContent(host).setLatLng([a.lat, a.lng]).openOn(map)
}

function openCity(cityId: string) {
  drawerCityId.value = cityId
  const path = cityPaths.get(cityId)
  if (path && map) {
    map.flyToBounds(path.getBounds(), { padding: [60, 60], maxZoom: 7.5, duration: 0.8 })
  }
}

onMounted(() => {
  if (!mapEl.value) return
  map = L.map(mapEl.value, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 4,
    maxZoom: 10,
    zoomSnap: 0.25,
    maxBounds: L.latLngBounds([15, 72], [54, 136]),
    maxBoundsViscosity: 0.9,
  })
  map.setView([35.2, 104.5], window.innerWidth < 640 ? 3.25 : 4.5)
  canvasRenderer = L.canvas({ padding: 0.5 })

  L.geoJSON(provinceFeatureCollection(), {
    style: () => ({ ...S.value.provinceBase }),
    onEachFeature: (feature, layer) => {
      provincePaths.set(feature.properties.adcode, layer as L.Path)
    },
  }).addTo(map)

  for (const city of cities) {
    const list = attractionsByCity.get(city.id)
    if (!list || !cityBoundaries[city.adcode]) continue
    const feature = {
      type: 'Feature' as const,
      properties: { cityId: city.id },
      geometry: cityBoundaries[city.adcode],
    }
    const layer = L.geoJSON(feature, {
      style: () => ({ ...S.value.cityBase }),
      onEachFeature: (_f, l) => {
        const path = l as L.Polygon
        path.on('click', () => openCity(city.id))
        path.on('mouseover', () => {
          if (!(path as unknown as { isLit?: boolean }).isLit) path.setStyle({ ...S.value.cityHover })
        })
        path.on('mouseout', () => {
          if (!(path as unknown as { isLit?: boolean }).isLit) path.setStyle({ ...S.value.cityBase })
        })
      },
    }).addTo(map)
    const inner = layer.getLayers()[0]
    if (inner) cityPaths.set(city.id, inner as L.Polygon)
  }

  for (const [, list] of attractionsByCity) {
    for (const a of list) {
      const marker = L.circleMarker([a.lat, a.lng], {
        ...S.value.dotNone,
        renderer: canvasRenderer,
      }).addTo(map)
      marker.on('click', () => openAttractionPopup(a.id))
      markers.set(a.id, marker)
    }
  }

  // 省名标注（常驻，取省界质心，个别省份手工修正）
  for (const p of provinces) {
    const [lng, lat] = PROVINCE_LABEL_OVERRIDE[p.adcode] ?? centroidOfGeometry(p.geometry)
    L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="province-label">${shortProvinceName(p.name)}</div>`,
        iconSize: [0, 0],
      }),
      interactive: false,
      zIndexOffset: -200,
    }).addTo(map)
  }

  // 城市名标注（放大后显示；直辖市与省名重叠，跳过）
  for (const city of cities) {
    if (!attractionsByCity.has(city.id)) continue
    if (city.adcode % 10000 === 0) continue
    const geom = cityBoundaries[city.adcode]
    const [lng, lat] = geom ? centroidOfGeometry(geom) : city.center
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="city-name-label">${city.name}</div>`,
        iconSize: [0, 0],
      }),
      interactive: false,
      zIndexOffset: -100,
    }).addTo(map)
    cityNameLabels.set(city.id, marker)
  }
  syncCityNameVisibility()
  map.on('zoomend', syncCityNameVisibility)

  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)

  // 供自动化测试与控制台调试使用
  ;(window as unknown as Record<string, unknown>).__twm = {
    map,
    openAttractionPopup,
    openCity,
    markers,
    records,
  }

  void records.load().then(syncOverlays)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  popupApp?.unmount()
  map?.remove()
})

watch(
  () => records.records,
  () => syncOverlays(),
)

// 主题切换：地图层按新配色重涂（发光滤镜等 CSS 部分由变量自动生效）
watch(
  () => themeStore.theme,
  () => syncOverlays(),
)
</script>

<template>
  <div class="absolute inset-0">
    <div ref="mapEl" class="h-full w-full" />

    <SearchBox @pick-attraction="focusAttraction" @pick-city="openCity" />

    <!-- 图例 -->
    <div
      class="absolute left-3 bottom-3 z-[1000] flex flex-col gap-1.5 px-3 py-2.5 rounded-xl
             bg-night-800/85 backdrop-blur border border-white/10 text-[11px] text-slate-300 pointer-events-none"
    >
      <span class="flex items-center gap-2"><i class="dot dot-none" />未点亮</span>
      <span class="flex items-center gap-2"><i class="dot dot-wish" /><AppIcon name="flag" :size="10" class="text-wish-400" />心愿</span>
      <span class="flex items-center gap-2"><i class="dot dot-lit" />已点亮</span>
    </div>

    <!-- 海报按钮 -->
    <button
      class="absolute right-3 bottom-3 z-[1000] px-3.5 py-2 rounded-xl text-xs font-medium transition inline-flex items-center gap-1.5
             bg-glow-500/15 text-glow-300 border border-glow-500/40 backdrop-blur hover:bg-glow-500/30"
      @click="showPoster = true"
    >
      <AppIcon name="image" :size="14" />
      生成点亮海报
    </button>

    <CityDrawer :city-id="drawerCityId" @close="drawerCityId = null" @focus="focusAttraction" />
    <PosterModal
      :open="showPoster"
      :lit-city-ids="litCityIds"
      :lit-provinces="litProvinces"
      :lit-attraction-ids="litAttractions"
      @close="showPoster = false"
    />
  </div>
</template>

<style scoped>
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.dot-none {
  background: var(--c-dot-none);
}
.dot-wish {
  background: var(--c-dot-wish);
}
.dot-lit {
  background: var(--c-dot-lit);
  box-shadow: 0 0 6px var(--c-glow-shadow);
}
</style>
