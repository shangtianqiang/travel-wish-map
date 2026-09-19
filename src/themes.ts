export type ThemeId = 'night' | 'ink' | 'aurora'

export interface ThemeMeta {
  id: ThemeId
  name: string
  emoji: string
  desc: string
  /** 切换面板里的三个预览色点 */
  swatch: [string, string, string]
}

export interface ThemePalette {
  /* —— 地图：省界 —— */
  provinceStroke: string
  provinceStrokeLit: string
  provinceFill: string
  /* —— 地图：城市边界 —— */
  cityStroke: string
  cityFill: string
  cityHoverStroke: string
  cityHoverFill: string
  cityLitStroke: string
  cityLitFill: string
  cityLitShadow: string
  /* —— 地图：景点 —— */
  dotNoneFill: string
  dotNoneStroke: string
  wish: string
  wishStroke: string
  litFill: string
  litStroke: string
  /* —— 海报 —— */
  posterBgTop: string
  posterBgBottom: string
  posterStar: string
  posterStatFrom: string
  posterStatTo: string
  posterStatBorder: string
  posterTextDim: string
  posterDivider: string
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'night',
    name: '夜光金',
    emoji: '🌙',
    desc: '深蓝夜幕 · 金色足迹',
    swatch: ['#0b1220', '#f6c453', '#ffe9a3'],
  },
  {
    id: 'ink',
    name: '水墨江南',
    emoji: '📜',
    desc: '宣纸米白 · 朱砂点亮',
    swatch: ['#f4eddc', '#c04f38', '#6b6355'],
  },
  {
    id: 'aurora',
    name: '极光翠',
    emoji: '🌌',
    desc: '墨绿深空 · 薄荷翠光',
    swatch: ['#081a17', '#3ddbb5', '#a8f0dc'],
  },
]

export const THEME_PALETTES: Record<ThemeId, ThemePalette> = {
  night: {
    provinceStroke: 'rgba(105,128,170,0.35)',
    provinceStrokeLit: 'rgba(246,196,83,0.6)',
    provinceFill: '#101a2e',
    cityStroke: 'rgba(125,146,185,0.5)',
    cityFill: '#16233c',
    cityHoverStroke: 'rgba(180,200,235,0.8)',
    cityHoverFill: '#22345a',
    cityLitStroke: '#f6c453',
    cityLitFill: 'rgba(246,196,83,0.22)',
    cityLitShadow: 'rgba(246,196,83,0.85)',
    dotNoneFill: '#6d84ab',
    dotNoneStroke: '#93a8cc',
    wish: '#f0a35e',
    wishStroke: '#ffd7a8',
    litFill: '#f6c453',
    litStroke: '#fff3cf',
    posterBgTop: '#070d18',
    posterBgBottom: '#0d1626',
    posterStar: '#cdd9ef',
    posterStatFrom: 'rgba(246,196,83,0.09)',
    posterStatTo: 'rgba(246,196,83,0.03)',
    posterStatBorder: 'rgba(246,196,83,0.3)',
    posterTextDim: 'rgba(160,178,205,0.9)',
    posterDivider: 'rgba(246,196,83,0.18)',
  },
  ink: {
    provinceStroke: 'rgba(110,100,80,0.45)',
    provinceStrokeLit: 'rgba(192,79,56,0.7)',
    provinceFill: '#f7f1e2',
    cityStroke: 'rgba(110,100,80,0.55)',
    cityFill: '#eee4cd',
    cityHoverStroke: 'rgba(90,80,60,0.85)',
    cityHoverFill: '#e5d8ba',
    cityLitStroke: '#c04f38',
    cityLitFill: 'rgba(192,79,56,0.18)',
    cityLitShadow: 'rgba(192,79,56,0.6)',
    dotNoneFill: '#b3a88f',
    dotNoneStroke: '#8f8672',
    wish: '#c07a2a',
    wishStroke: '#a05f18',
    litFill: '#c04f38',
    litStroke: '#8a2c18',
    posterBgTop: '#f6f0e1',
    posterBgBottom: '#ece1c8',
    posterStar: '#ddd2b8',
    posterStatFrom: 'rgba(192,79,56,0.08)',
    posterStatTo: 'rgba(192,79,56,0.03)',
    posterStatBorder: 'rgba(192,79,56,0.35)',
    posterTextDim: 'rgba(107,99,85,0.95)',
    posterDivider: 'rgba(192,79,56,0.22)',
  },
  aurora: {
    provinceStroke: 'rgba(90,150,138,0.35)',
    provinceStrokeLit: 'rgba(61,219,181,0.6)',
    provinceFill: '#0a1d1a',
    cityStroke: 'rgba(95,154,141,0.5)',
    cityFill: '#0e2420',
    cityHoverStroke: 'rgba(140,210,190,0.8)',
    cityHoverFill: '#153430',
    cityLitStroke: '#3ddbb5',
    cityLitFill: 'rgba(61,219,181,0.2)',
    cityLitShadow: 'rgba(61,219,181,0.8)',
    dotNoneFill: '#3d6a60',
    dotNoneStroke: '#5f9a8d',
    wish: '#e5c04f',
    wishStroke: '#f0d68a',
    litFill: '#3ddbb5',
    litStroke: '#a8f0dc',
    posterBgTop: '#04100e',
    posterBgBottom: '#081d18',
    posterStar: '#bfe8dd',
    posterStatFrom: 'rgba(61,219,181,0.09)',
    posterStatTo: 'rgba(61,219,181,0.03)',
    posterStatBorder: 'rgba(61,219,181,0.3)',
    posterTextDim: 'rgba(143,181,172,0.9)',
    posterDivider: 'rgba(61,219,181,0.18)',
  },
}
