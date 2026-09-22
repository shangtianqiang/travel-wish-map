import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相对路径，保证构建产物可直接部署到 GitHub Pages 子路径
  // （https://<user>.github.io/travel-wish-map/），本地预览也不受部署目录影响
  base: './',
  plugins: [vue(), tailwindcss()],
})
