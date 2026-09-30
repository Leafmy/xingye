import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
// HarmonyOS 控制中心主题层：必须排在 App.vue 之后导入，保证打包产物中它的
// 规则位于组件样式之后（两者同为无层级样式，按源序覆盖）
import './styles/harmonyos.css'
// 指针光效（复刻 leafmy.top 的鼠标悬停光效）：指针作为点光源，
// 按距离照亮范围内所有卡片，并在卡片内跟随指针平移光斑与边缘高光
import './card-light'
// 自定义指针（复刻 leafmy.top 的 Win11 概念指针）：圆润三角箭头跟随指针，
// 亮色模式黑边白体 / 暗色模式白边黑体（配色在 styles/custom-cursor.css）
import './styles/custom-cursor.css'
import './custom-cursor'

// ===== 明暗主题：沿用 index.html 内联脚本的同一存储键 =====
function applyInitialTheme(): void {
  try {
    const saved = localStorage.getItem('xingye-theme')
    const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
  } catch { /* 忽略：无 localStorage 时保持浅色 */ }
}
applyInitialTheme()

const app = createApp(App)
app.mount('#app')

// ===== 启动页淡出：Vue 挂载完成（bundle 加载完毕）后平滑过渡到主界面 =====
// 挂载完成并不代表后端/首屏数据已就绪，因此默认等待 App.vue 发出
// 'xingye:app-ready'（首次 WebSocket 连上后端）后再淡出；
// 同时设置最小展示时长与最大兜底时长，避免加载异常时永久卡在启动页。
const MIN_SPLASH_MS = 600
const MAX_SPLASH_MS = 4500
const mountAt = Date.now()
let splashGone = false
let readyNotified = false

function fadeOutSplash(): void {
  if (splashGone) return
  splashGone = true
  const splash = document.getElementById('splash')
  if (!splash) return
  splash.classList.add('splash-out')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })
  // 兜底：transitionend 未触发时强制移除
  setTimeout(() => splash.remove(), 700)
}

function onAppReady(): void {
  if (readyNotified || splashGone) return
  readyNotified = true
  const elapsed = Date.now() - mountAt
  setTimeout(fadeOutSplash, Math.max(0, MIN_SPLASH_MS - elapsed))
}

window.addEventListener('xingye:app-ready', onAppReady, { once: true })
if ((window as any).__xingyeAppReady) onAppReady()
// 后端/首屏若在最大时长内仍未就绪，也撤掉启动页，避免永久卡屏
setTimeout(fadeOutSplash, MAX_SPLASH_MS)

// ===== 聚焦主窗口（Tauri 桌面壳） =====
// 窗口启动即显示（背景色 + 内联启动页消除白屏），此处 invoke 让窗口获得焦点，
// Rust 侧实现幂等（已显示则仅聚焦）。
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  try {
    (window as any).__TAURI_INTERNALS__.invoke('show_main_window')
  } catch { /* 忽略：窗口本身已显示 */ }
}
