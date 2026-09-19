import { createApp } from 'vue'
import 'leaflet/dist/leaflet.css'
import App from './App.vue'
import { pinia } from './pinia'
import './styles/main.css'

createApp(App).use(pinia).mount('#app')
