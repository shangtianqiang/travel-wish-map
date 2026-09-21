#!/usr/bin/env node
/**
 * 从 Wikimedia Commons / 中文维基百科为每个景点匹配 1-3 张真实照片（非 AI 图）：
 *   src/data/attraction-photos.json
 *
 * 策略：
 *  1. 预处理：经 Wikidata 为每个城市取英文地名（城市词）。
 *  2. 每个景点：
 *     a. Wikidata 按名称+坐标（<5km）匹配实体，取英文 label/aliases 中的显著专名；
 *     b. Commons 全文搜索（filemime:image/jpeg），搜索词多级回退：
 *        全名+城市 → 全名 → 核心名+城市 → 核心名 → 别名(+城市) → 短名(+城市)；
 *     c. 结果需通过相关性校验：文件名含景点中文专名（2 字以上），
 *        或含英文显著专名（>=6 字单独成立，4-5 字需搭配城市词）；
 *  3. 仍不足 3 张时，用中文维基百科对应页面 media-list 补充；
 *  4. 过滤：jpeg、宽 >=700、宽高比 0.5~2.5，排除 logo/地图/铭牌/画作/邮票/
 *     铁路车站/地铁等（景点本身是铁路主题时除外）。
 *
 * 断点续跑：输出文件已存在时，已有非空结果的景点跳过。
 * 抽样：SAMPLE=1 仅处理每个城市的第一个景点，用于验证。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

// Node 原生 fetch 不自动读取代理环境变量，显式设置
const proxyUrl =
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.HTTP_PROXY
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl))

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'src', 'data')
const OUT = path.join(DATA, 'attraction-photos.json')
const UA = 'travel-wish-map/0.1 (photo fetch; contact: local dev)'
const TARGET = 3
const WORKERS = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, retries = 3) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20000),
      })
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 5
        await sleep(Math.min(wait * 1000, 15000))
        throw new Error('HTTP 429 rate limited')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (i < retries) await sleep(Math.min(1500 * 2 ** i, 8000))
    }
  }
  throw lastErr
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// —— 名称解析 ——
const SUFFIXES = [
  '国家森林公园', '国家湿地公园', '国家地质公园', '国家级风景名胜区', '国家级自然保护区',
  '国家自然保护区', '自然保护区', '风景名胜区', '旅游度假区', '风景区', '旅游区', '度假区',
  '度假村', '步行街', '博物院', '博物馆', '公园', '广场', '景区', '街区',
]

function parseName(name) {
  const aliases = []
  const stripped = name
    .replace(/[（(]([^（）()]+)[)）]/g, (_, inner) => {
      aliases.push(inner.trim())
      return ''
    })
    .trim()
  const parts = stripped.split(/[·•・|/]/).map((s) => s.trim()).filter(Boolean)
  const head = parts[0] ?? stripped
  for (const p of parts.slice(1)) aliases.push(p)
  let short = head
  for (const s of SUFFIXES) {
    if (head.endsWith(s) && head.length > s.length + 1) {
      short = head.slice(0, -s.length)
      break
    }
  }
  return { base: head, aliases: [...new Set(aliases)], short }
}

function buildQueries(full, cityName, parsed) {
  const { base, aliases, short } = parsed
  const qs = []
  const add = (q) => {
    if (q && !qs.includes(q)) qs.push(q)
  }
  add(`${full} ${cityName}`)
  add(full)
  if (base !== full) {
    add(`${base} ${cityName}`)
    add(base)
  }
  for (const a of aliases) {
    add(`${a} ${cityName}`)
    add(a)
  }
  if (short && short !== base && short !== full) {
    add(`${short} ${cityName}`)
    add(short)
  }
  return qs
}

// —— 停用词 ——
const EN_STOP = new Set([
  'china', 'city', 'great', 'grand', 'street', 'road', 'avenue', 'temple', 'palace',
  'museum', 'park', 'square', 'ancient', 'north', 'south', 'west', 'east', 'view',
  'tower', 'hall', 'gate', 'bridge', 'mountain', 'river', 'scenic', 'historic', 'garden',
  'gardens', 'market', 'bazaar', 'cathedral', 'church', 'mosque', 'monastery', 'shrine',
  'grotto', 'cave', 'caves', 'stadium', 'memorial', 'monument', 'cemetery', 'mausoleum',
  'fortress', 'castle', 'lake', 'hotel', 'building', 'district', 'area', 'national',
  'province', 'autonomous', 'prefecture', 'people', 'republic', 'imperial', 'qing',
  'ming', 'tang', 'dynasty', 'desert', 'grassland', 'salt', 'beach', 'bay', 'island',
  'port', 'town', 'main', 'central', 'world', 'with', 'from', 'near', 'page', 'china,',
])

const CN_STOP_GRAMS = new Set([
  '国家', '中国', '文化', '旅游', '度假', '风景', '风光', '景区', '公园', '广场',
  '博物', '步行', '大街', '古城', '古镇', '老街', '街区', '大厦', '纪念', '建筑',
  '名胜', '古迹', '遗址', '大桥', '宫殿', '近代', '博物馆', '博物院', '风景区',
  '纪念馆', '古建筑', '国家级', '步行街',
])

// —— 通用黑名单（非实拍 / 非景点主体） ——
const BAD_PATTERNS = [
  'logo', 'icon', 'locator', 'osm', '地图', '位置图', 'satellite', '卫星', '铭牌', '标志',
  'seal', 'emblem', 'coat of arms', 'coat_of_arms', 'badge', 'banner', 'diagram', 'chart',
  ' plan', '_plan', 'plan ', 'ticket', '门票', 'coin', 'stamp', '邮票', '纸币', 'banknote',
  'poster', '海报', '大字壁', 'blueprint', 'schema', 'qrcode', '二维码', 'graffiti',
  'signature', '签名', 'manuscript', '手稿', 'title page', 'titlepage', '扉页', ' cover',
  '_cover', 'cover ', '封面', 'leaflet', 'brochure', 'screenshot', '截图', 'plaque',
  'painting', 'drawing', 'calligraphy', '书法', '图卷', '画卷', 'engraving', 'lithograph',
  'illustration', 'postcard', '明信片', ' map', '_map', 'map ', 'map-', '-map', '3d model',
  '概况', '功德', '导览图', '全景图', '分布图', '示意图', '效果图',
  'airport', '机场', 'jichang', '收费站', '服务区', 'service area', 'tollgate',
  'toll gate', '草图', '亜細亜大観', '亚细亚大观', '站场', 'hotel', '宾馆', '酒店',
  '立板', '鲜花饼', '菠萝米', '黄山区',
]

// 铁路/地铁类（景点本身是铁路主题时不启用）
const RAIL_PATTERNS = [
  'railway', 'train', 'locomotive', 'metro', 'subway', 'platform', 'station', 'zhan',
  '高铁', '轻轨', '火车', '地铁', '站台', '列车',
]
const RAIL_ATTRACTION = /铁路|火车|列车|地铁|轻轨|车站/

function isBad(title, attractionName) {
  const f = title.replace(/^File:/, '').toLowerCase().replace(/_/g, ' ')
  for (const bad of BAD_PATTERNS) {
    if (f.includes(bad)) return true
  }
  if (!RAIL_ATTRACTION.test(attractionName)) {
    for (const bad of RAIL_PATTERNS) {
      if (f.includes(bad)) return true
    }
    // 中文“X站 外观/站台/口”等车站照片
    if (/[\u4e00-\u9fa5]站[\s外台口]/.test(f) || /[\u4e00-\u9fa5]站$/.test(title)) return true
  }
  return false
}

function isPhoto(c, attractionName) {
  if (!c.url || !c.width || !c.height) return false
  if (c.width < 700) return false
  const ratio = c.width / c.height
  if (ratio < 0.5 || ratio > 2.5) return false
  return !isBad(c.title, attractionName)
}

// —— Wikidata ——
async function wdSearch(term, limit = 6) {
  const params = new URLSearchParams({
    action: 'wbsearchentities', search: term, language: 'zh', uselang: 'zh',
    limit: String(limit), format: 'json',
  })
  const d = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`)
  return d.search ?? []
}

async function wdEntities(ids, languages = 'en') {
  const out = {}
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const params = new URLSearchParams({
      action: 'wbgetentities', ids: chunk.join('|'), languages,
      props: 'labels|claims|aliases', format: 'json',
    })
    const d = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`)
    Object.assign(out, d.entities)
  }
  return out
}

function extractWords(label, aliases, words) {
  const add = (s) => {
    if (typeof s !== 'string' || !s) return
    s.toLowerCase().replace(/[(),']/g, ' ').split(/[\s-]+/).forEach((w) => {
      if (w.length >= 4 && !EN_STOP.has(w)) words.add(w)
    })
  }
  add(label)
  for (const a of aliases ?? []) add(typeof a === 'string' ? a : a.value)
}

/** 景点 Wikidata 匹配：返回显著专名集合 */
async function matchAttractionWd(a, parsed) {
  const terms = [...new Set([a.name, parsed.base, ...parsed.aliases])].slice(0, 3)
  let candidates = []
  for (const t of terms) {
    try {
      const res = await wdSearch(t)
      for (const r of res) if (!candidates.some((c) => c.id === r.id)) candidates.push(r)
    } catch {
      /* ignore */
    }
    if (candidates.length >= 8) break
  }
  if (!candidates.length) return new Set()
  const ents = await wdEntities([...new Set(candidates.map((c) => c.id))])
  let chosen = null
  let best = Infinity
  for (const c of candidates) {
    const e = ents[c.id]
    const v = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value
    if (!v) continue
    const d = haversine(a.lat, a.lng, v.latitude, v.longitude)
    if (d < 20 && d < best) {
      best = d
      chosen = e
    }
  }
  if (!chosen) {
    // 无坐标/坐标超距：取 label 与名称精确相等的第一个候选
    const exact = candidates.find(
      (c) => c.label === a.name || c.label === parsed.base
    )
    if (exact) chosen = ents[exact.id]
  }
  const words = new Set()
  if (chosen) {
    extractWords(chosen.labels?.en?.value, chosen.aliases?.en, words)
  }
  return words
}

/** 城市预处理：cityId -> 城市词集合 */
async function buildCityWords(cities) {
  const candidatesByCity = new Map()
  await runPool(
    cities,
    async (city) => {
      let res = []
      try {
        res = await wdSearch(city.name, 5)
      } catch {
        /* ignore */
      }
      candidatesByCity.set(city.id, res)
    },
    4
  )
  let allCandidates = []
  for (const res of candidatesByCity.values()) allCandidates = allCandidates.concat(res)
  const ids = [...new Set(allCandidates.map((c) => c.id))]
  console.log(`  城市候选实体 ${ids.length} 个，批量取详情 ...`)
  const ents = await wdEntities(ids)
  const wordsByCity = new Map()
  for (const city of cities) {
    const cands = candidatesByCity.get(city.id) ?? []
    let chosen = null
    let best = Infinity
    for (const c of cands) {
      const e = ents[c.id]
      const v = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value
      if (!v) continue
      const d = haversine(city.center[1], city.center[0], v.latitude, v.longitude)
      if (d < 60 && d < best) {
        best = d
        chosen = e
      }
    }
    if (!chosen && cands.length === 1) chosen = ents[cands[0].id]
    const words = new Set()
    if (chosen) extractWords(chosen.labels?.en?.value, chosen.aliases?.en, words)
    wordsByCity.set(city.id, words)
  }
  return wordsByCity
}

// —— 相关性校验 ——
function* cnGrams(term) {
  for (let len = term.length; len >= 2; len--) {
    for (let i = 0; i + len <= term.length; i++) {
      const g = term.slice(i, i + len)
      if (/^[\u4e00-\u9fa5]+$/.test(g) && !CN_STOP_GRAMS.has(g)) yield g
    }
  }
}

function isRelevant(title, a, parsed, wdWords, placeWords) {
  const f = title.replace(/^File:/, '')
  const cnTerms = [parsed.base, ...parsed.aliases]
  for (const t of cnTerms) {
    for (const g of cnGrams(t)) {
      if (f.includes(g)) return true
    }
  }
  const fl = f.toLowerCase()
  for (const w of wdWords) {
    if (!fl.includes(w)) continue
    if (w.length >= 6) return true
    for (const p of placeWords) {
      if (fl.includes(p)) return true
    }
  }
  return false
}

// —— Commons 搜索 ——
async function commonsSearch(term) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6',
    gsrsearch: `${term} filemime:image/jpeg`, gsrlimit: '12', prop: 'imageinfo',
    iiprop: 'url|mime|size', iiurlwidth: '800',
  })
  const d = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`)
  const pages = Object.values(d.query?.pages ?? {})
  return pages
    .sort((x, y) => (x.index ?? 0) - (y.index ?? 0))
    .map((p) => {
      const ii = p.imageinfo?.[0]
      return { title: p.title, url: ii?.thumburl, width: ii?.width, height: ii?.height }
    })
}

// —— 中文维基补充 ——
async function batchImageInfo(apiBase, titles) {
  if (!titles.length) return { photos: [], missing: [] }
  const params = new URLSearchParams({
    action: 'query', format: 'json', titles: titles.join('|'), prop: 'imageinfo',
    iiprop: 'url|mime|size', iiurlwidth: '800',
  })
  const d = await fetchJson(`${apiBase}/w/api.php?${params}`)
  const photos = []
  const missing = []
  for (const p of Object.values(d.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0]
    if (ii?.thumburl) {
      photos.push({ title: p.title, url: ii.thumburl, width: ii.width, height: ii.height })
    } else {
      missing.push(p.title)
    }
  }
  return { photos, missing }
}

async function zhwikiSupplement(full, parsed) {
  const sParams = new URLSearchParams({
    action: 'query', format: 'json', list: 'search', srsearch: full, srlimit: '4',
  })
  const sd = await fetchJson(`https://zh.wikipedia.org/w/api.php?${sParams}`)
  const results = sd.query?.search ?? []
  const hit = results.find((r) => {
    const t = r.title.replace(/\s*\(.*?\)\s*/, '')
    return (
      t.includes(parsed.base) ||
      parsed.base.includes(t) ||
      parsed.aliases.some((a) => t.includes(a))
    )
  })
  if (!hit) return []
  const md = await fetchJson(
    `https://zh.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(hit.title)}`
  )
  const titles = (md.items ?? [])
    .filter((i) => i.type === 'image' && /\.jpe?g$/i.test(i.title))
    .slice(0, 8)
    .map((i) => i.title)
  const { photos, missing } = await batchImageInfo('https://commons.wikimedia.org', titles)
  if (missing.length) {
    const { photos: local } = await batchImageInfo('https://zh.wikipedia.org', missing)
    photos.push(...local)
  }
  return photos
}

// —— 单景点处理 ——
async function processAttraction(a, cityName, placeWords) {
  const parsed = parseName(a.name)
  const queries = buildQueries(a.name, cityName, parsed)
  const picked = []
  const seen = new Set()

  // Wikidata 匹配与 Commons 搜索并行
  const wdPromise = matchAttractionWd(a, parsed)
  const candidates = []
  for (const q of queries) {
    let results
    try {
      results = await commonsSearch(q)
    } catch {
      continue
    }
    for (const c of results) {
      if (!seen.has(c.title)) {
        seen.add(c.title)
        candidates.push(c)
      }
    }
    await sleep(120)
  }
  const wdWords = await wdPromise

  for (const c of candidates) {
    if (!isPhoto(c, a.name)) continue
    if (!isRelevant(c.title, a, parsed, wdWords, placeWords)) continue
    picked.push(c)
    if (picked.length >= TARGET) break
  }

  if (picked.length < TARGET) {
    try {
      const extra = await zhwikiSupplement(a.name, parsed)
      for (const c of extra) {
        if (!isPhoto(c, a.name) || !isRelevant(c.title, a, parsed, wdWords, placeWords)) continue
        if (picked.some((p) => p.title === c.title)) continue
        picked.push(c)
        if (picked.length >= TARGET) break
      }
    } catch {
      /* 补充失败则保留已有结果 */
    }
  }

  return picked.map((c) => ({
    url: c.url,
    page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(c.title.replace(/\s/g, '_'))}`,
    title: c.title,
  }))
}

// —— 并发池 ——
async function runPool(items, worker, workers) {
  let next = 0
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const idx = next++
        if (idx >= items.length) return
        await worker(items[idx], idx)
      }
    })
  )
}

async function main() {
  const { cities } = JSON.parse(await readFile(path.join(DATA, 'cities.json'), 'utf8'))
  const cityById = new Map(cities.map((c) => [c.id, c]))
  const regionFiles = ['north', 'south', 'east', 'west']
  let attractions = []
  for (const r of regionFiles) {
    const j = JSON.parse(await readFile(path.join(DATA, 'attractions', `${r}.json`), 'utf8'))
    attractions = attractions.concat(j.attractions)
  }

  if (process.env.SAMPLE === '1') {
    const firstByCity = new Map()
    for (const a of attractions) {
      if (!firstByCity.has(a.cityId)) firstByCity.set(a.cityId, a)
    }
    attractions = [...firstByCity.values()]
  }

  console.log('预处理城市 Wikidata 地名 ...')
  const cityWords = await buildCityWords(cities)

  let existing = {}
  try {
    existing = JSON.parse(await readFile(OUT, 'utf8'))
  } catch {
    /* 首次运行 */
  }

  const todo = attractions.filter((a) => !(existing[a.id] && existing[a.id].length))
  console.log(
    `共 ${attractions.length} 个景点，已有图跳过 ${attractions.length - todo.length}，待处理 ${todo.length}`
  )

  let done = 0
  let withPhoto = 0
  await runPool(
    todo,
    async (a) => {
      const cityName = cityById.get(a.cityId)?.name ?? ''
      const photos = await processAttraction(a, cityName, cityWords.get(a.cityId) ?? new Set())
      done++
      if (photos.length) withPhoto++
      existing[a.id] = photos
      if (done % 20 === 0 || done === todo.length) {
        console.log(`  进度 ${done}/${todo.length}，本轮有图 ${withPhoto}`)
        await writeFile(OUT, JSON.stringify(existing, null, 1))
      }
    },
    WORKERS
  )

  await writeFile(OUT, JSON.stringify(existing, null, 1))
  const totalWith = Object.values(existing).filter((p) => p && p.length).length
  console.log(
    `完成：${totalWith}/${attractions.length} 个景点有照片，输出 ${path.relative(ROOT, OUT)}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
