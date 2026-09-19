import { createApp } from 'vue'
import 'leaflet/dist/leaflet.css'
import App from './App.vue'
import { pinia } from './pinia'
import { useThemeStore } from './stores/theme'
import './styles/main.css'

// 在挂载前应用持久化的主题，避免首帧闪烁
useThemeStore(pinia).init()

createApp(App).use(pinia).mount('#app')
