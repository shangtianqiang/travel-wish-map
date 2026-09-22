#!/usr/bin/env node
/**
 * 从 Wikimedia Commons / 中文维基百科为每个景点匹配 1-3 张真实照片（非 AI 图）：
 *   src/data/attraction-photos.json
 *
 * 策略：
 *  1. 预处理：经 Wikidata 为每个城市取英文地名（城市词）。
 *  2. 每个景点：
 *     a. 双路取英文专名：Wikidata 按名称+坐标（<20km）匹配；同时中文维基
 *        多词检索选最匹配文章（元文章/车站/消歧义页降权），经其 wikibase_item
 *        取英文 label/aliases，解决国内 POI 英文 Wikidata 搜不到的问题；
 *     b. Commons 全文搜索（filemime:image/jpeg）：中文全名/核心名多级回退后，
 *        英文按 多词短语 → 强单词 → 短语/单词×城市词 顺序补查；
 *     c. 相关性校验：文件名含景点显著中文专名（>=4 字直接成立，2-3 字需无跨省
 *        地名冲突），或含英文显著专名（多词短语/>=6 字单词单独成立，4-5 字需
 *        搭配城市词）；跨省同名互斥（wrongProvince）排除“湖南衡山混入山西恒山”
 *        这类误配，跨省界共有景点（晋陕壶口瀑布）与摄影师署名例外；
 *  3. 仍不足 3 张时，用中文维基百科对应页面 prop=images 补充；
 *  4. 过滤：jpeg、宽 >=700、宽高比 0.5~2.5，排除 logo/地图/铭牌/画作/邮票/
 *     铁路车站/地铁等（景点本身是铁路主题时除外）。
 *
 * 断点续跑：输出文件已存在时，已有非空结果的景点跳过。
 * 抽样：SAMPLE=1 仅处理每个城市的第一个景点，用于验证。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
  '风景线', '海滨', '滨江', '古镇', '古城',
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
  'disambiguation', 'disambig',
])

const CN_STOP_GRAMS = new Set([
  '国家', '中国', '文化', '旅游', '度假', '风景', '风光', '景区', '公园', '广场',
  '博物', '步行', '大街', '古城', '古镇', '老街', '街区', '大厦', '纪念', '建筑',
  '名胜', '古迹', '遗址', '大桥', '宫殿', '近代', '博物馆', '博物院', '风景区',
  '纪念馆', '古建筑', '国家级', '步行街', '海滨', '滨江',
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
  '高铁', '轻轨', '火车', '地铁', '站台', '列车', '站牌', '站房', '候车',
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

/** 英文名归一化：小写、去括号标点、连字符/下划线转空格 */
function normEn(s) {
  return String(s)
    .toLowerCase()
    .replace(/[(),'’]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 常见繁体→简体（Commons 文件名混用繁体，如 老外灘/東平湖/楡林窟），只覆盖高频字 */
const T2S = {
  東: '东', 車: '车', 馬: '马', 龍: '龙', 鳳: '凤', 鳥: '鸟', 魚: '鱼', 見: '见',
  觀: '观', 廣: '广', 國: '国', 會: '会', 學: '学', 寶: '宝', 寧: '宁', 濱: '滨',
  灘: '滩', 灣: '湾', 島: '岛', 嶺: '岭', 峽: '峡', 巖: '岩', 廟: '庙', 樓: '楼',
  閣: '阁', 門: '门', 橋: '桥', 宮: '宫', 舊: '旧', 縣: '县', 鎮: '镇', 鄉: '乡',
  陽: '阳', 陰: '阴', 雲: '云', 華: '华', 蘭: '兰', 萬: '万', 與: '与', 於: '于',
  體: '体', 瀋: '沈', 瀘: '泸', 隴: '陇', 頤: '颐', 驛: '驿', 騰: '腾', 麗: '丽',
  楡: '榆', 樸: '朴', 歐: '欧', 雙: '双', 飛: '飞', 來: '来', 從: '从', 興: '兴',
  義: '义', 禮: '礼', 禪: '禅', 達: '达', 遺: '遗', 鐵: '铁', 銀: '银', 銅: '铜',
  錫: '锡', 鏡: '镜', 關: '关', 際: '际', 陸: '陆', 陝: '陕', 電: '电', 霧: '雾',
  靈: '灵', 靜: '静', 風: '风', 飯: '饭', 飲: '饮', 駝: '驼', 驪: '骊', 魯: '鲁',
  鯉: '鲤', 鵝: '鹅', 穀: '谷', 餘: '余', 榮: '荣', 龕: '龛', 齒: '齿',
}
function normCn(s) {
  return String(s).replace(/[東車馬龍鳳鳥魚見觀廣國會學寶寧濱灘灣島嶺峽巖廟樓閣門橋宮舊縣鎮鄉陽陰雲華蘭萬與於體瀋瀘隴頤驛騰麗楡樸歐雙飛來從興義禮禪達遺鐵銀銅錫鏡關際陸陝電霧靈靜風飯飲駝驪魯鯉鵝穀餘榮龕齒]/g, (c) => T2S[c] ?? c)
}

function extractWords(label, aliases, words) {
  const vals = [label, ...(aliases ?? []).map((a) => (typeof a === 'string' ? a : a?.value))]
  for (const s of vals) {
    if (typeof s !== 'string' || !s) continue
    // 单词专名：长度 >=4 且非通名停用词
    normEn(s)
      .split(' ')
      .forEach((w) => {
        if (w.length >= 4 && !EN_STOP.has(w)) words.add(w)
      })
    // 多词短语（如 "heng shan shanxi"、"haihe river"）：整体长度 >=8
    // 且至少含一个 >=4 字实义词；短语足够特异，整体入集合用于检索与相关性校验
    const p = normEn(s)
    if (
      p.includes(' ') &&
      p.length >= 8 &&
      !p.includes('disambig') &&
      p.split(' ').some((t) => t.length >= 4 && !EN_STOP.has(t))
    ) {
      words.add(p)
    }
  }
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

/** 省级行政区中文名 → 英文文件名常见拼写（含直辖市/特区），用于跨省同名景点互斥 */
const PROVINCE_TOKENS = [
  ['北京', 'beijing'], ['天津', 'tianjin'], ['上海', 'shanghai'], ['重庆', 'chongqing'],
  ['河北', 'hebei'], ['山西', 'shanxi'], ['辽宁', 'liaoning'], ['吉林', 'jilin'],
  ['黑龙江', 'heilongjiang'], ['江苏', 'jiangsu'], ['浙江', 'zhejiang'], ['安徽', 'anhui'],
  ['福建', 'fujian'], ['江西', 'jiangxi'], ['山东', 'shandong'], ['河南', 'henan'],
  ['湖北', 'hubei'], ['湖南', 'hunan'], ['广东', 'guangdong'], ['海南', 'hainan'],
  ['四川', 'sichuan'], ['贵州', 'guizhou'], ['云南', 'yunnan'], ['陕西', 'shaanxi'],
  ['甘肃', 'gansu'], ['青海', 'qinghai'], ['台湾', 'taiwan'],
  ['内蒙古', 'inner mongolia'], ['广西', 'guangxi'], ['西藏', 'tibet'],
  ['宁夏', 'ningxia'], ['新疆', 'xinjiang'], ['香港', 'hong kong'], ['澳门', 'macau'],
]

/**
 * 文件名出现景点所在省/直辖市以外的省级地名时否决（防止北岳恒山混入湖南衡山）。
 * directOnly=true：只否决“省名直接拼接景点名”的异地同名（天津东湖风景区），
 * 供已命中 >=4 字中文专名的场景使用；带分隔符的跨省界共有景点
 * （“山西 黄河壶口瀑布”）仍保留。
 */
function wrongProvince(title, attraction, options = {}) {
  const { directOnly = false } = options
  const prov = attraction?.province
  if (!prov) return false
  const raw = title.replace(/^File:/, '')
  // panoramio/flickr 署名后缀（" - panoramio - wuqiang beijing"）不是地名描述
  const f = raw.split(/panoramio|flickr|wikimapia/i)[0]
  const fl = f.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ')
  let gramsCache = null
  const gramsOf = () => {
    if (!gramsCache) {
      gramsCache = []
      const p = parseName(attraction.name)
      for (const t of [p.base, ...p.aliases]) for (const g of cnGrams(t)) gramsCache.push(g)
    }
    return gramsCache
  }
  for (const [cn, en] of PROVINCE_TOKENS) {
    if (prov.includes(cn) || cn.includes(prov)) continue
    // 中文省名：需处于词首/非汉字之后，或后接行政区/分隔符，
    // 或省名直接前缀景点专名（“天津东湖…”）；
    // 排除道路小区名（北京路、南京路）与跨词偶合（庐“山东”林寺）
    const idx = f.indexOf(cn)
    if (idx >= 0) {
      const prev = f[idx - 1] ?? ''
      const next = f[idx + cn.length] ?? ''
      const roadLike = /[路街道巷里弄桥]/.test(next)
      const standalone =
        idx === 0 || !/[一-龥]/.test(prev) || /[省市县区镇村的 \s,，·\-—]/.test(next)
      const prefixHit =
        idx === 0 && gramsOf().some((g) => f.startsWith(g, idx + cn.length))
      if (!roadLike && prefixHit) return true
      if (directOnly) continue
      if (!roadLike && standalone) return true
    }
    if (directOnly) continue
    // 英文省名：边界匹配；"Bank of Jiangsu" 等机构名不算地名
    const enHit = en.includes(' ')
      ? fl.includes(en)
      : new RegExp(`(^|[^a-z])${en}(?![a-z])`).test(fl)
    const onlyBank = new RegExp(`bank of ${en}(?![a-z])`).test(fl)
    if (enHit && !onlyBank) return true
  }
  return false
}

function isRelevant(title, a, parsed, wdWords, placeWords) {
  // 繁简归一，兼容 老外灘/東平湖/楡林窟 等繁体文件名
  const f = normCn(title.replace(/^File:/, ''))
  let bestCn = 0
  // 只用“显著专名片段”计分：含通名的片段（湖风景区、古城遗址等）不具区分力，
  // 避免合肥“翡翠湖风景区”因共有“湖风景区”混入武汉“东湖风景区”
  for (const t of [parsed.base, ...parsed.aliases]) {
    for (const g of distinctiveCnGrams(t)) {
      if (f.includes(g) && g.length > bestCn) bestCn = g.length
    }
  }
  // 命中 >=4 字中文专名（壶口瀑布、塞罕坝…）足以确认同一地点；
  // 但“天津东湖风景区”这类省名直接拼接的异地同名仍否决
  if (bestCn >= 4) return !wrongProvince(title, a, { directOnly: true })
  // 2-3 字弱匹配：跨省地名先否决（天津东湖、河南尧山等）
  if (wrongProvince(title, a)) return false
  // 弱匹配成立条件：命中景点“显著核心名”，或命中 >=3 字显著片段
  // （十三陵、涌泉寺、亚布力、莫尔格勒河变体等）；跨词碎片（湖风、佛塔）不算
  const headHit = [parsed.base, ...parsed.aliases].some((t) => {
    const h = distinctiveHead(t)
    return h.length >= 2 && f.includes(h)
  })
  if (headHit || bestCn >= 3) return true
  const fl = f.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ')
  for (const w of wdWords) {
    if (!fl.includes(w)) continue
    if (w.includes(' ')) return true // 多词短语，构造时已保证特异性
    if (w.length >= 6) return true
    for (const p of placeWords) {
      if (fl.includes(p)) return true
    }
  }
  return false
}

/**
 * 景点的“显著中文专名片段”：在 cnGrams 基础上再剔除包含通名停用词
 * （古城/遗址/公园等）的片段，避免“晋阳古城遗址”因共有“古城遗址”
 * 而误配“良渚古城遗址公园”。按长度降序，用于中文维基文章标题匹配。
 */
function distinctiveCnGrams(term) {
  const out = []
  for (const g of cnGrams(term)) {
    if ([...CN_STOP_GRAMS].some((s) => g.includes(s))) continue
    if (!out.includes(g)) out.push(g)
  }
  return out
}

/**
 * 显著核心名：从名称开头截到第一个通名停用片段之前。
 * 良渚古城遗址公园 → 良渚；周庄古镇 → 周庄；北戴河海滨 → 北戴河；海河风景线 → 海河。
 * 名称中没有通名时（如 北岳恒山）返回全名。
 */
function distinctiveHead(term) {
  let cut = term.length
  for (let i = 0; i < term.length - 1; i++) {
    const g2 = term.slice(i, i + 2)
    const g3 = term.slice(i, i + 3)
    if (CN_STOP_GRAMS.has(g2) || CN_STOP_GRAMS.has(g3)) {
      cut = i
      break
    }
  }
  const head = term.slice(0, cut)
  return head.length >= 2 ? head : term
}

/**
 * 中文维基候选标题与景点名的匹配分：
 *  - 标题含景点“显著核心名”得高分（100+核心名长度），保证良渚选“良渚遗址”
 *    而非更长的“良渚古城外围水利工程遗址”、周庄选“周庄镇”而非“周庄玱珩西楼”；
 *  - 否则回退到最长显著片段命中长度（北岳恒山 → 恒山 文章得 2 分）。
 */
function zhTitleScore(title, parsed) {
  const t = title.replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, '')
  let best = 0
  for (const term of [parsed.base, ...parsed.aliases]) {
    const head = distinctiveHead(term)
    if (head.length >= 2 && t.includes(head)) {
      best = Math.max(best, 100 + head.length)
      continue
    }
    for (const g of distinctiveCnGrams(term)) {
      if (t.includes(g) && g.length > best) best = g.length
    }
  }
  return best
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

/** 中文维基搜索，返回候选文章标题（按相关度排序） */
async function zhwikiSearchTitles(full, limit = 6) {
  const sParams = new URLSearchParams({
    action: 'query', format: 'json', list: 'search', srsearch: full, srlimit: String(limit),
  })
  const sd = await fetchJson(`https://zh.wikipedia.org/w/api.php?${sParams}`)
  return (sd.query?.search ?? []).map((r) => r.title)
}

/** 中文维基“元文章/机构”降权：列表、制度、机关单位等；景点名不含行政区通名时，区县文章也降权 */
const ZH_META_TITLE =
  /列表|制度|服务局|疗养院|办事处|人大|政协|政府|军区|会议|事件|事故|战役|条约|协定|年鉴|大事记|词条|模板|分类|统计|概况/

function zhBadness(title, parsed) {
  const t = title.replace(/\s*\(.*?\)\s*/g, '')
  let b = 0
  if (ZH_META_TITLE.test(t)) b += 2
  if (/[区县市州省]$/.test(t) && !/[区县市州省]/.test(parsed.base)) b += 1
  // 交通设施条目（北戴河海滨不应选“北戴河站”），景点本身是交通主题时除外
  if (/(站|机场|码头)$/.test(t) && !/(站|机场|码头)/.test(parsed.base)) b += 2
  // 消歧义页优先让给实体条目（良渚 → 良渚遗址，而非“良渚”消歧义页）
  if (/消歧[义義]/.test(t) || t === distinctiveHead(parsed.base)) b += 2
  return b
}

/**
 * 选最匹配的中文维基文章：用显著中文片段打分（最长命中 >=2 字），
 * 解决“周庄古镇 → 周庄镇 (昆山市)”“良渚古城遗址公园 → 良渚遗址”这类标题不完全包含。
 * 同分时元文章/机构降权、短标题优先，避免“北戴河海滨 → 北戴河服务局”。
 */
function pickZhwikiTitle(titles, parsed) {
  let best = null
  let bestKey = null
  for (const title of titles) {
    const score = zhTitleScore(title, parsed)
    if (score < 2) continue
    const bareLen = title.replace(/\s*\(.*?\)\s*/g, '').length
    const key = [score, -zhBadness(title, parsed), -bareLen]
    if (
      !bestKey ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
      (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])
    ) {
      best = title
      bestKey = key
    }
  }
  return best
}

/**
 * 中文维基文章 → 其 Wikidata 实体的英文名与显著专名。
 * 很多国内 POI 用中文直接搜不到 Wikidata，但中文维基文章挂接着正确实体，
 * 经此路径可拿到 Zhouzhuang / Liangzhu / Lujiazui 等英文专名用于检索与相关性校验。
 */
async function zhwikiWdWords(title) {
  const empty = { words: new Set(), label: '' }
  try {
    const pParams = new URLSearchParams({
      action: 'query', format: 'json', titles: title, prop: 'pageprops',
      ppprop: 'wikibase_item',
    })
    const pd = await fetchJson(`https://zh.wikipedia.org/w/api.php?${pParams}`)
    const page = Object.values(pd.query?.pages ?? {})[0]
    const qid = page?.pageprops?.wikibase_item
    if (!qid) return empty
    const ents = await wdEntities([qid])
    const e = ents[qid]
    if (!e) return empty
    const words = new Set()
    extractWords(e.labels?.en?.value, e.aliases?.en, words)
    return { words, label: e.labels?.en?.value ?? '' }
  } catch {
    return empty
  }
}

async function zhwikiSupplement(title) {
  if (!title) return []
  const params = new URLSearchParams({
    action: 'query', format: 'json', titles: title, prop: 'images', imlimit: '20',
  })
  const md = await fetchJson(`https://zh.wikipedia.org/w/api.php?${params}`)
  const page = Object.values(md.query?.pages ?? {})[0]
  const titles = (page?.images ?? [])
    .map((i) => i.title)
    .filter((t) => /\.jpe?g$/i.test(t))
    .slice(0, 12)
  const { photos, missing } = await batchImageInfo('https://commons.wikimedia.org', titles)
  if (missing.length) {
    const { photos: local } = await batchImageInfo('https://zh.wikipedia.org', missing)
    photos.push(...local)
  }
  return photos
}

// —— 单景点处理 ——
async function processAttraction(a, cityName, placeWords, province = '') {
  if (province) a = { ...a, province } // 省份在城市数据上，供跨省同名互斥使用
  const parsed = parseName(a.name)
  const queries = buildQueries(a.name, cityName, parsed)
  const picked = []
  const seen = new Set()

  // Wikidata 直连匹配、中文维基选文章并行启动（中文维基按 全名/核心名/短名 多词检索）
  const wdPromise = matchAttractionWd(a, parsed)
  const zhTerms = [...new Set([a.name, parsed.base, parsed.short, ...parsed.aliases].filter(Boolean))]
    .slice(0, 3)
  const zhPromise = Promise.all(
    zhTerms.map((t) => zhwikiSearchTitles(t).catch(() => []))
  ).then((groups) => {
    const all = []
    for (const g of groups) for (const t of g) if (!all.includes(t)) all.push(t)
    return pickZhwikiTitle(all, parsed)
  })

  const candidates = []
  const collect = async (q) => {
    let results
    try {
      results = await commonsSearch(q)
    } catch {
      return
    }
    for (const c of results) {
      if (!seen.has(c.title)) {
        seen.add(c.title)
        candidates.push(c)
      }
    }
  }
  for (const q of queries) {
    await collect(q)
    await sleep(120)
  }

  // 汇合两路英文专名：直连 Wikidata + 中文维基文章挂接的 Wikidata 实体
  const wdWords = await wdPromise
  const bestZhTitle = await zhPromise
  let zhLabel = ''
  if (bestZhTitle) {
    const zh = await zhwikiWdWords(bestZhTitle)
    zhLabel = zh.label
    for (const w of zh.words) wdWords.add(w)
  }

  // 英文 Commons 检索：优先多词短语（如 "heng shan shanxi"），再显著单词×城市英文词
  const phrases = [...wdWords]
    .filter((w) => w.includes(' ') && w.length >= 8)
    .sort((x, y) => y.length - x.length)
    .slice(0, 3)
  const cityWords = [...placeWords]
    .filter((w) => w.length >= 4 && !w.includes(' '))
    .slice(0, 2)
  const sigSingles = [...wdWords]
    .filter((w) => !w.includes(' ') && w.length >= 6)
    .sort((x, y) => y.length - x.length)
    .slice(0, 2)
  const enQueries = [...phrases]
  for (const w of sigSingles) enQueries.push(w) // 强单词单独检索（如 zhouzhuang）
  if (cityWords[0]) {
    for (const p of phrases.slice(0, 1)) enQueries.push(`${p} ${cityWords[0]}`)
    for (const w of sigSingles) enQueries.push(`${w} ${cityWords[0]}`)
  }
  const enq = [...new Set(enQueries)].slice(0, 6)
  for (const q of enq) {
    if (queries.includes(q)) continue
    await collect(q)
    await sleep(120)
  }

  for (const c of candidates) {
    if (!isPhoto(c, a.name)) continue
    if (!isRelevant(c.title, a, parsed, wdWords, placeWords)) continue
    picked.push(c)
    if (picked.length >= TARGET) break
  }

  if (picked.length < TARGET && bestZhTitle) {
    try {
      const extra = await zhwikiSupplement(bestZhTitle)
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

  if (process.env.DEBUG_IDS?.split(',').includes(a.id)) {
    console.error(
      `[debug ${a.id}] zh=${bestZhTitle} label=${zhLabel} words=${[...wdWords]
        .map((w) => `"${w}"`)
        .join(',')}\n  enq=${enq.join(' | ')}\n  picked=${picked
        .map((c) => c.title)
        .join(' | ')}`
    )
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
      const city = cityById.get(a.cityId)
      const photos = await processAttraction(
        a, city?.name ?? '', cityWords.get(a.cityId) ?? new Set(), city?.province ?? ''
      )
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

export {
  processAttraction, parseName, zhwikiSearchTitles, pickZhwikiTitle, zhwikiWdWords,
  commonsSearch, matchAttractionWd, buildQueries, isRelevant, isPhoto, isBad,
  buildCityWords, wrongProvince, cnGrams, distinctiveCnGrams, distinctiveHead, normCn,
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
