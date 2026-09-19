import { provinces, cityBoundaries, cityById, attractionById } from '../data'
import type { ThemePalette } from '../themes'

export interface PosterInput {
  litCityIds: Set<string>
  litProvinces: Set<string>
  litAttractionIds: Set<string>
}

const L0 = 73
const L1 = 136
const B0 = 18
const B1 = 54

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

function makeProjector(x: number, y: number, w: number, h: number) {
  const my0 = mercY(B0)
  const my1 = mercY(B1)
  return (lng: number, lat: number): [number, number] => [
    x + ((lng - L0) / (L1 - L0)) * w,
    y + ((my1 - mercY(lat)) / (my1 - my0)) * h,
  ]
}

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  geom: { type: string; coordinates: number[][][] | number[][][][] },
  project: (lng: number, lat: number) => [number, number],
) {
  const polys =
    geom.type === 'Polygon'
      ? [geom.coordinates as number[][][]]
      : (geom.coordinates as number[][][][])
  ctx.beginPath()
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const [px, py] = project(lng, lat)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.closePath()
    }
  }
}

export function renderPoster(input: PosterInput, palette: ThemePalette): HTMLCanvasElement {
  const W = 900
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, palette.posterBgTop)
  bg.addColorStop(0.55, palette.posterBgBottom)
  bg.addColorStop(1, palette.posterBgBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 点缀星光
  ctx.save()
  for (let i = 0; i < 90; i++) {
    const sx = Math.random() * W
    const sy = Math.random() * H
    const r = Math.random() * 1.3
    ctx.globalAlpha = 0.15 + Math.random() * 0.5
    ctx.fillStyle = palette.posterStar
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // 标题
  ctx.textAlign = 'center'
  ctx.fillStyle = palette.litStroke
  ctx.font = 'bold 44px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.shadowColor = palette.cityLitShadow
  ctx.shadowBlur = 24
  ctx.fillText('我的旅游心愿地图', W / 2, 108)
  ctx.shadowBlur = 0
  ctx.fillStyle = palette.posterTextDim
  ctx.font = '16px "PingFang SC", sans-serif'
  ctx.fillText(
    new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
    W / 2,
    142,
  )

  // 地图区域（等比：经度用弧度跨度与墨卡托纬度跨度比较）
  const mapX = 40
  const mapY = 180
  const mapW = W - 80
  const mapH = 760
  const lonSpan = ((L1 - L0) * Math.PI) / 180
  const latSpan = mercY(B1) - mercY(B0)
  const geoAspect = lonSpan / latSpan
  let dw = mapW
  let dh = dw / geoAspect
  if (dh > mapH) {
    dh = mapH
    dw = dh * geoAspect
  }
  const ox = mapX + (mapW - dw) / 2
  const oy = mapY + (mapH - dh) / 2
  const project = makeProjector(ox, oy, dw, dh)

  // 省底图
  for (const p of provinces) {
    drawGeometry(ctx, p.geometry, project)
    ctx.fillStyle = palette.provinceFill
    ctx.fill()
    ctx.strokeStyle = litProvinceOf(p.adcode, input) ? palette.provinceStrokeLit : palette.provinceStroke
    ctx.lineWidth = litProvinceOf(p.adcode, input) ? 1.3 : 0.7
    ctx.stroke()
  }

  // 点亮城市
  ctx.save()
  ctx.shadowColor = palette.cityLitShadow
  ctx.shadowBlur = 18
  for (const cityId of input.litCityIds) {
    const city = cityById.get(cityId)
    if (!city) continue
    const geom = cityBoundaries[city.adcode]
    if (!geom) continue
    drawGeometry(ctx, geom, project)
    ctx.fillStyle = palette.cityLitFill
    ctx.fill()
    ctx.strokeStyle = palette.cityLitStroke
    ctx.lineWidth = 1.4
    ctx.stroke()
  }
  ctx.restore()

  // 点亮景点
  ctx.save()
  ctx.shadowColor = palette.cityLitShadow
  ctx.shadowBlur = 8
  ctx.fillStyle = palette.litFill
  for (const aId of input.litAttractionIds) {
    const a = attractionById.get(aId)
    if (!a) continue
    const [px, py] = project(a.lng, a.lat)
    ctx.beginPath()
    ctx.arc(px, py, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // 统计区
  const stats = [
    { label: '点亮景点', value: input.litAttractionIds.size },
    { label: '点亮城市', value: input.litCityIds.size },
    { label: '走过省份', value: input.litProvinces.size },
  ]
  const cardY = 1010
  const cardW = W - 120
  const cardH = 200
  const card = ctx.createLinearGradient(0, cardY, 0, cardY + cardH)
  card.addColorStop(0, palette.posterStatFrom)
  card.addColorStop(1, palette.posterStatTo)
  ctx.fillStyle = card
  roundRect(ctx, 60, cardY, cardW, cardH, 20)
  ctx.fill()
  ctx.strokeStyle = palette.posterStatBorder
  ctx.lineWidth = 1
  ctx.stroke()

  const colW = cardW / stats.length
  stats.forEach((s, i) => {
    const cx = 60 + colW * i + colW / 2
    ctx.fillStyle = palette.litStroke
    ctx.font = 'bold 58px "PingFang SC", sans-serif'
    ctx.fillText(String(s.value), cx, cardY + 92)
    ctx.fillStyle = palette.posterTextDim
    ctx.font = '15px "PingFang SC", sans-serif'
    ctx.fillText(s.label, cx, cardY + 128)
    if (i > 0) {
      ctx.strokeStyle = palette.posterDivider
      ctx.beginPath()
      ctx.moveTo(60 + colW * i, cardY + 40)
      ctx.lineTo(60 + colW * i, cardY + cardH - 40)
      ctx.stroke()
    }
  })

  // 落款
  ctx.fillStyle = palette.posterTextDim
  ctx.font = '14px "PingFang SC", sans-serif'
  ctx.fillText('每一盏灯，都是一段旅程 · 旅游心愿地图', W / 2, 1290)

  return canvas
}

function litProvinceOf(adcode: number, input: PosterInput): boolean {
  // 省界点亮由城市反推：这里依赖调用方按省预着色，直接查省名映射
  const province = PROVINCE_OF_ADCODE[adcode]
  return province ? input.litProvinces.has(province) : false
}

const PROVINCE_OF_ADCODE: Record<number, string> = {
  110000: '北京', 120000: '天津', 130000: '河北', 140000: '山西', 150000: '内蒙古',
  210000: '辽宁', 220000: '吉林', 230000: '黑龙江', 310000: '上海', 320000: '江苏',
  330000: '浙江', 340000: '安徽', 350000: '福建', 360000: '江西', 370000: '山东',
  410000: '河南', 420000: '湖北', 430000: '湖南', 440000: '广东', 450000: '广西',
  460000: '海南', 500000: '重庆', 510000: '四川', 520000: '贵州', 530000: '云南',
  540000: '西藏', 610000: '陕西', 620000: '甘肃', 630000: '青海', 640000: '宁夏',
  650000: '新疆',
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
