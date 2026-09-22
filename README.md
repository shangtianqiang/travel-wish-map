# 旅游心愿地图 · Travel Wish Map

🌏 一张属于你的中国旅行足迹地图：点亮去过的景点、标记想去的心愿，自动点亮城市与省份，生成专属点亮海报。

**👉 在线预览（GitHub Pages）：<https://shangtianqiang.github.io/travel-wish-map/>**

> 首次访问或推送 main 分支后，GitHub Actions 会自动构建并部署，约 1–2 分钟后生效。

## 功能

- **交互式地图**：基于 Leaflet 的中国地图，76 个城市、687 个精选景点，省界 / 市界随打卡进度点亮
- **景点打卡**：日期、文字日记、照片（本地存储），支持多次打卡与内联编辑
- **心愿清单**：一键标记「我想去」，旗帜标注；打卡后自动转为已点亮
- **我的足迹**：看板（城市 / 省份进度）、心愿、日记三个视图
- **点亮海报**：一键绘制当前足迹海报（地图描金 + 统计 + 标语）并保存为图片
- **城市抽屉**：点击城市边界查看该城全部景点与点亮进度
- **搜索定位**：按城市 / 景点名搜索，飞行定位并打开景点卡片
- **三套主题**：夜光金、水墨江南、极光翠，本地记忆偏好
- **移动端适配**：窄屏下弹窗、抽屉、表单、海报均自适应
- **纯本地数据**：打卡记录保存在浏览器 IndexedDB，无需登录、无后端

## 技术栈

Vue 3.5 + TypeScript + Vite 6 + Pinia + Leaflet 1.9（Canvas 渲染）+ Tailwind CSS 4 + Dexie（IndexedDB）

景点照片来自 Wikimedia Commons，数据在构建时静态打包（`src/data/attraction-photos.json`），打开网页不会触发任何抓取任务。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173
```

## 构建与预览

```bash
npm run build    # 类型检查 + 产物输出到 dist/
npm run preview  # 本地预览构建产物
```

## 部署到 GitHub Pages

仓库已包含工作流 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)：

1. 推送到 `main` 分支即自动构建并部署；
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（仅首次需要）；
3. 部署完成后访问 `https://<你的用户名>.github.io/travel-wish-map/`。

`vite.config.ts` 中设置了 `base: './'`，产物使用相对路径，部署在任意子路径下均可正常加载；也可以把 `dist/` 托管到任何静态服务器。

## 目录结构

```
src/
├── components/      # 地图、景点卡片、搜索、城市抽屉、海报、足迹页等组件
├── data/            # 城市 / 景点 / 行政区边界 / 照片索引（静态数据）
├── stores/          # Pinia：打卡记录（Dexie）、主题
├── composables/     # 统计派生（点亮城市 / 省份 / 景点）
└── utils/           # 地理几何工具
scripts/             # 行政区边界与照片数据的一次性抓取脚本（运行需显式开关）
```
