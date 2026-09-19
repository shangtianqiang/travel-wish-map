import type { GeoJsonGeometry } from '../data'

/** 行政区全称转常用简称：黑龙江省→黑龙江，广西壮族自治区→广西 */
export function shortProvinceName(name: string): string {
  return name
    .replace(/(省|市|特别行政区)$/, '')
    .replace(/(维吾尔|壮族|回族)?自治区$/, '')
}

/** 个别省份质心落在被挖空区域（如河北环绕京津），手工指定标注点 [lng, lat] */
export const PROVINCE_LABEL_OVERRIDE: Record<number, [number, number]> = {
  130000: [114.87, 38.35], // 河北 → 石家庄一带
}

/**
 * 计算行政区划几何的标注点：
 * 取面积最大的多边形外环，用鞋带公式求质心。
 * 对内蒙古（长条）、甘肃（哑铃）等形状比 bounds 中心更居中。
 */
export function centroidOfGeometry(geom: GeoJsonGeometry): [number, number] {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let bestArea = 0
  let cx = 0
  let cy = 0
  for (const poly of polys) {
    const ring = poly[0]
    let a = 0
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[i + 1]
      const cross = x1 * y2 - x2 * y1
      a += cross
      sumX += (x1 + x2) * cross
      sumY += (y1 + y2) * cross
    }
    a /= 2
    if (Math.abs(a) > Math.abs(bestArea)) {
      bestArea = a
      cx = sumX / (6 * a)
      cy = sumY / (6 * a)
    }
  }
  return [cx, cy]
}
