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
import { useStats } from '../composables/stats'
import { pinia } from '../pinia'
import AttractionCard from './AttractionCard.vue'
import CityDrawer from './CityDrawer.vue'
import PosterModal from './PosterModal.vue'
import SearchBox from './SearchBox.vue'

const records = useRecordsStore()
const { litCityIds, litProvinces, litAttractions } = useStats()

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

const provinceOfAdcode = new Map(cities.map((c) => [c.adcode, c.province]))

function focusAttraction(aId: string) {
  const a = attractionById.get(aId)
  if (!a || !map) return
  map.flyTo([a.lat, a.lng], Math.max(map.getZoom(), 8), { duration: 0.8 })
  openAttractionPopup(aId)
}

const STYLE = {
  provinceBase: { color: 'rgba(105,128,170,0.35)', weight: 0.6, fillColor: '#101a2e', fillOpacity: 0.85 },
  provinceLit: { color: 'rgba(246,196,83,0.6)', weight: 1.4, fillColor: '#101a2e', fillOpacity: 0.85 },
  cityBase: { color: 'rgba(125,146,185,0.5)', weight: 0.9, fillColor: '#16233c', fillOpacity: 0.9 },
  cityHover: { color: 'rgba(180,200,235,0.8)', weight: 1.4, fillColor: '#22345a', fillOpacity: 0.9 },
  cityLit: { color: '#f6c453', weight: 1.8, fillColor: '#f6c453', fillOpacity: 0.22 },
  dotNone: { radius: 3, weight: 1, color: '#93a8cc', fillColor: '#6d84ab', fillOpacity: 0.95 },
  dotWish: { radius: 4, weight: 1.2, color: '#ffd7a8', fillColor: '#f0a35e', fillOpacity: 1 },
  dotLit: { radius: 4.5, weight: 1.5, color: '#fff3cf', fillColor: '#f6c453', fillOpacity: 1 },
} as const

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
  if (status === 'lit') marker.setStyle({ ...STYLE.dotLit })
  else if (status === 'wish') marker.setStyle({ ...STYLE.dotWish })
  else marker.setStyle({ ...STYLE.dotNone })
}

function syncOverlays() {
  for (const [cityId, progress] of cityProgress.value) {
    // 城市边界点亮
    const path = cityPaths.get(cityId)
    if (path && !(path as unknown as { isLit?: boolean }).isLit) {
      path.setStyle({ ...STYLE.cityLit })
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
      path.setStyle({ ...STYLE.cityBase })
      ;(path as unknown as { isLit?: boolean }).isLit = false
    }
  }
  for (const [cityId, label] of cityLabels) {
    if (!cityProgress.value.has(cityId)) {
      label.remove()
      cityLabels.delete(cityId)
    }
  }

  // 省描边点亮
  for (const [adcode, path] of provincePaths) {
    const province = provinceOfAdcode.get(adcode)
    const lit = province ? litProvinces.value.has(province) : false
    path.setStyle(lit ? { ...STYLE.provinceLit } : { ...STYLE.provinceBase })
    const el = path.getElement()
    if (el) el.classList.toggle('province-lit', lit)
  }

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
      icon: L.divIcon({ className: 'wish-wrap', html: '<span class="wish-flag">⚑</span>', iconSize: [14, 16], iconAnchor: [7, 16] }),
      interactive: false,
      zIndexOffset: 600,
    }).addTo(map!)
    overlayMarkers.set(aId, m)
  }
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
  }).on('remove', () => {
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
    style: () => ({ ...STYLE.provinceBase }),
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
      style: () => ({ ...STYLE.cityBase }),
      onEachFeature: (_f, l) => {
        const path = l as L.Polygon
        path.on('click', () => openCity(city.id))
        path.on('mouseover', () => {
          if (!(path as unknown as { isLit?: boolean }).isLit) path.setStyle({ ...STYLE.cityHover })
        })
        path.on('mouseout', () => {
          if (!(path as unknown as { isLit?: boolean }).isLit) path.setStyle({ ...STYLE.cityBase })
        })
      },
    }).addTo(map)
    const inner = layer.getLayers()[0]
    if (inner) cityPaths.set(city.id, inner as L.Polygon)
  }

  for (const [, list] of attractionsByCity) {
    for (const a of list) {
      const marker = L.circleMarker([a.lat, a.lng], {
        ...STYLE.dotNone,
        renderer: canvasRenderer,
      }).addTo(map)
      marker.on('click', () => openAttractionPopup(a.id))
      markers.set(a.id, marker)
    }
  }

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
      <span class="flex items-center gap-2"><i class="dot dot-wish" />⚑ 心愿</span>
      <span class="flex items-center gap-2"><i class="dot dot-lit" />已点亮</span>
    </div>

    <!-- 海报按钮 -->
    <button
      class="absolute right-3 bottom-3 z-[1000] px-3.5 py-2 rounded-xl text-xs font-medium transition
             bg-glow-500/15 text-glow-300 border border-glow-500/40 backdrop-blur hover:bg-glow-500/30"
      @click="showPoster = true"
    >
      🖼️ 生成点亮海报
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
  background: #546a8f;
  border: 1px solid #7d92b5;
}
.dot-wish {
  background: #f0a35e;
}
.dot-lit {
  background: #f6c453;
  box-shadow: 0 0 6px rgba(246, 196, 83, 0.9);
}
</style>
