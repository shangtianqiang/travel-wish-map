#!/usr/bin/env node
/**
 * 从阿里 DataV.GeoAtlas 下载行政区划边界并简化，生成打包用的 GeoJSON：
 *   src/data/geo/china-provinces.json   全国省级边界（简化）
 *   src/data/geo/city-boundaries.json   内置城市边界，key 为 adcode（简化）
 *
 * 简化策略：Douglas-Peucker（省界容差 0.005°，市界 0.01°）+ 坐标精度 3 位小数。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'src', 'data')
const GEO = path.join(DATA, 'geo')
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'

// —— Douglas-Peucker ——
function dp(points, tolerance) {
  if (points.length <= 3) return points
  const sqTol = tolerance * tolerance
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxSq = 0
    let idx = -1
    const [x1, y1] = points[first]
    const [x2, y2] = points[last]
    const dx = x2 - x1
    const dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]
      let sq
      if (lenSq === 0) {
        const ex = px - x1
        const ey = py - y1
        sq = ex * ex + ey * ey
      } else {
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
        t = Math.max(0, Math.min(1, t))
        const ex = px - (x1 + t * dx)
        const ey = py - (y1 + t * dy)
        sq = ex * ex + ey * ey
      }
      if (sq > maxSq) {
        maxSq = sq
        idx = i
      }
    }
    if (maxSq > sqTol && idx > 0) {
      keep[idx] = true
      stack.push([first, idx], [idx, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

const round3 = (n) => Math.round(n * 1000) / 1000

function simplifyCoords(coords, tolerance) {
  return coords.map((ring) => dp(ring, tolerance).map(([x, y]) => [round3(x), round3(y)]))
}

function simplifyGeometry(geom, tolerance) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: simplifyCoords(geom.coordinates, tolerance) }
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) => simplifyCoords(poly, tolerance)),
    }
  }
  throw new Error(`Unsupported geometry type: ${geom.type}`)
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'travel-wish-map/0.1' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`

async function main() {
  await mkdir(GEO, { recursive: true })
  const { cities } = JSON.parse(await readFile(path.join(DATA, 'cities.json'), 'utf8'))

  console.log('Downloading provinces (100000_full) ...')
  const full = await fetchJson(`${BASE}/100000_full.json`)
  const provinces = full.features
    .filter((f) => f.geometry && f.properties.adcode !== 100000)
    .map((f) => ({
      adcode: f.properties.adcode,
      name: f.properties.name,
      geometry: simplifyGeometry(f.geometry, 0.005),
    }))
  await writeFile(path.join(GEO, 'china-provinces.json'), JSON.stringify(provinces))
  console.log(
    `china-provinces.json: ${provinces.length} provinces, ${kb(JSON.stringify(provinces).length)}`
  )

  const boundaries = {}
  for (const city of cities) {
    try {
      const fc = await fetchJson(`${BASE}/${city.adcode}.json`)
      const f = fc.features.find((x) => x.properties.adcode === city.adcode) || fc.features[0]
      boundaries[city.adcode] = simplifyGeometry(f.geometry, 0.01)
      console.log(`  ${city.name}(${city.adcode}) ok`)
    } catch (e) {
      console.error(`  ${city.name}(${city.adcode}) FAILED: ${e.message}`)
    }
  }
  await writeFile(path.join(GEO, 'city-boundaries.json'), JSON.stringify(boundaries))
  console.log(
    `city-boundaries.json: ${Object.keys(boundaries).length} cities, ${kb(JSON.stringify(boundaries).length)}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
