import { defineStore } from 'pinia'
import { THEME_PALETTES, type ThemeId, type ThemePalette } from '../themes'

const STORAGE_KEY = 'twm-theme'

function loadInitial(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null
    if (saved && saved in THEME_PALETTES) return saved
  } catch {
    /* localStorage 不可用时用默认主题 */
  }
  return 'night'
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: loadInitial() as ThemeId,
  }),

  getters: {
    palette(state): ThemePalette {
      return THEME_PALETTES[state.theme]
    },
  },

  actions: {
    /** 应用挂载前调用，把主题写到 <html data-theme>，避免首帧闪烁 */
    init() {
      document.documentElement.dataset.theme = this.theme
    },

    setTheme(theme: ThemeId) {
      this.theme = theme
      document.documentElement.dataset.theme = theme
      try {
        localStorage.setItem(STORAGE_KEY, theme)
      } catch {
        /* 忽略存储失败 */
      }
    },
  },
})
