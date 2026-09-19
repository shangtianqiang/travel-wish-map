import { createPinia } from 'pinia'

/** 全局唯一 Pinia 实例，弹窗等独立 createApp 挂载的组件也需要 use 它 */
export const pinia = createPinia()
