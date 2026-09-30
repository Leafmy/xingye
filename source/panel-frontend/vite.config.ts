import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * public/ 里这一组文件在面板里没有任何引用（已全仓库检索确认），
 * 但会被 Vite 原样拷进 dist，直接抬高发布体积 —— app/panel-frontend/dist
 * 会被 Tauri 打进 NSIS 安装包，白扛 576KB。
 *
 *   xingye-avatar.png         300,044 B
 *   xingye-avatar-square.png  276,730 B
 *   favicon.svg                 9,522 B   （index.html 用的是 favicon.png）
 *   icons.svg                   5,031 B   （只被未被引用的 HelloWorld.vue 用到）
 *
 * 这里只在构建产物里剔除，源文件保持不动 —— 需要临时取回时，把名字从下面
 * 这个数组里删掉重新构建即可。
 */
const UNUSED_PUBLIC_ASSETS = [
  'xingye-avatar.png',
  'xingye-avatar-square.png',
  'favicon.svg',
  'icons.svg',
]

/** 构建结束后从 dist 摘掉上面那批未引用的静态资源 */
function pruneUnusedPublicAssets(): Plugin {
  let outDir = ''
  return {
    name: 'xingye:prune-unused-public-assets',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      for (const name of UNUSED_PUBLIC_ASSETS) {
        rmSync(resolve(outDir, name), { force: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), pruneUnusedPublicAssets()],
  define: {
    // 面板全程使用 <script setup>（组合式 API），没有任何 Options API 组件。
    // 注：Vue 3.5 的 runtime-core 没有把这段实现包在开关里，实测这个开关
    // 在本项目对体积无影响，保留它只是给后续新增组件划一条线。
    __VUE_OPTIONS_API__: false,
    // 生产环境不需要 devtools 钩子与 hydration 失配详情
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    // 外壳是 Tauri，Windows 走 WebView2（常青 Chromium），按 Chrome 120 出产物：
    // 既不为老内核降级语法，也不让 CSS 额外生成旧语法回退（默认 target 会让
    // CSS 多出约 1.3KB）
    target: 'chrome120',
    // 单入口：CSS 跟随入口产出独立文件（长缓存友好），不把样式塞进 JS
    cssCodeSplit: true,
    // 构建日志不需要 gzip 体积，省掉一次全量压缩计算
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // 框架运行时单独成块：App.vue 是巨石组件，业务代码每次改动都会换
        // hash，但 vue/vendor 块的 hash 稳定，客户端只需重新下载业务块
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](@vue|vue)[\\/]/.test(id)) return 'vue'
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5174,
  },
})
