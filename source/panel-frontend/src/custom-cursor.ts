/*!
 * 星野 Xingye · 自定义指针（复刻 leafmy.top 的「Win11 概念指针」）
 * ---------------------------------------------------------------------------
 * 形状、跟随方式、点击反馈与设备降级整体复刻自 leafmy.top 的
 * /custom/cursor/site-cursor.js：
 *   · 圆润三角 / 水滴形箭头，-45° 旋转后朝左上，尖端为热点；
 *   · pointermove 里直接写 transform（translate3d，走合成器）跟随，零延迟；
 *   · 按下缩放 0.9，松开复位；
 *   · 指针离开窗口 / 窗口失焦时淡出，触屏设备（coarse pointer）整体降级。
 *
 * 与站点的差异（本项目定制，其余保持原样）：
 *   1. 单色描边体。站点是彩虹流光渐变填充，星野按主题取反色（CSS 见
 *      styles/custom-cursor.css，主题切换由 html.dark 自动接管，脚本不感知主题）：
 *        亮色模式 → 黑边 + 白色实心
 *        暗色模式 → 白边 + 黑色实心
 *   2. 热点按几何对齐。站点把元素放在 (clientX - 2, clientY - 2)，但 -45° 旋转后
 *      尖端实际落在元素内 (4.73, 4.73) 处，于是尖端比真实指针偏右下约 2.7px。
 *      这里按 viewBox / 尺寸 / 旋转角算出尖端坐标（HOTSPOT），让尖端压在指针上。
 *   3. 点击缩放真正生效。站点把 scale(0.9) 写在 .clicking 类上，而该类规则会被
 *      脚本每帧写的内联 transform 覆盖 —— 实际从未缩放过。这里改为外层元素只做
 *      平移、内层 svg 做旋转 + 缩放，两者互不干扰。
 *   4. 只在自定义指针就绪后才隐藏系统指针（html.has-custom-cursor）：脚本异常时
 *      面板仍保留系统指针，不会出现「没有指针」的失控状态。
 *   5. 不做 max-width: 768px 降级：桌面端「App 设置」窗口宽 760px，按站点规则会
 *      误判为移动端而关掉指针，这里只保留触屏（coarse pointer）降级。
 * ---------------------------------------------------------------------------
 */

/** 容器 id / 隐藏系统指针的开关类（与 CSS 保持一致） */
const CURSOR_ID = 'custom-cursor'
const ENABLED_CLASS = 'has-custom-cursor'

/** 元素尺寸（px，与 CSS 中 #custom-cursor 的 width/height 一致） */
const BOX = 24
/** SVG 画布边长（viewBox，与站点一致） */
const VIEW = 28
/** 形状旋转角（deg，与 CSS 中内层 svg 的 rotate 一致） */
const ROTATE_DEG = -45
/** 箭头尖端在 viewBox 中的坐标（形状路径起点 M14 2） */
const TIP_X = 14
const TIP_Y = 2

/** 形状路径：与站点逐字一致（圆润三角 + 三处圆角 + 内凹底边） */
const SHAPE_D =
  'M14 2 Q13 3 12 5 L5 21 Q4 23 6 24 Q8 25 10 24 Q12 23 14 21 ' +
  'Q16 23 18 24 Q20 25 22 24 Q24 23 23 21 L16 5 Q15 3 14 2 Z'

/**
 * 热点偏移：尖端经过「viewBox 缩放 + 绕中心旋转」后在元素内的位置。
 * 元素 transform 用 (clientX - HOTSPOT.x, clientY - HOTSPOT.y) 定位，
 * 尖端即与真实指针重合。stroke 以路径为中心向两侧各扩 1（viewBox 单位），
 * 因此箭头外缘还会再超出约 0.9px，视觉上正好“盖住”指针点。
 */
const HOTSPOT = ((): { x: number; y: number } => {
  const k = BOX / VIEW
  const rad = (ROTATE_DEG * Math.PI) / 180
  const cx = BOX / 2
  const cy = BOX / 2
  const dx = TIP_X * k - cx
  const dy = TIP_Y * k - cy
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  }
})()

/** 触屏 / 无精确指针的设备不做自定义指针 */
function isTouchDevice(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  )
}

/** 指针 SVG：单色填充 + 描边由 CSS 按主题着色 */
function cursorSvg(): string {
  return (
    `<svg width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}" ` +
    'fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    `<path class="cursor-body" d="${SHAPE_D}" stroke-linejoin="round" stroke-linecap="round"/>` +
    '</svg>'
  )
}

function start(): void {
  if (isTouchDevice()) return
  if (document.getElementById(CURSOR_ID)) return

  const cursor = document.createElement('div')
  cursor.id = CURSOR_ID
  cursor.setAttribute('aria-hidden', 'true')
  cursor.innerHTML = cursorSvg()
  document.body.appendChild(cursor)

  /* 就绪后才隐藏系统指针（CSS 侧由 html.has-custom-cursor 控制） */
  document.documentElement.classList.add(ENABLED_CLASS)

  let visible = false

  const onPointerMove = (event: PointerEvent): void => {
    cursor.style.transform =
      `translate3d(${(event.clientX - HOTSPOT.x).toFixed(2)}px,` +
      `${(event.clientY - HOTSPOT.y).toFixed(2)}px,0)`
    if (!visible) {
      visible = true
      cursor.style.opacity = '1'
    }
  }

  /* 按下 / 松开：内层 svg 缩放，外层 translate 不受影响 */
  const onPointerDown = (): void => cursor.classList.add('pressing')
  const onPointerUp = (): void => cursor.classList.remove('pressing')

  const hide = (): void => {
    cursor.classList.remove('pressing')
    if (!visible) return
    visible = false
    cursor.style.opacity = '0'
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerdown', onPointerDown, { passive: true })
  document.addEventListener('pointerup', onPointerUp, { passive: true })
  document.addEventListener('pointercancel', onPointerUp, { passive: true })
  /* 指针移出文档 / 窗口失焦 / 窗口最小化 → 淡出，避免残影停在窗口边缘 */
  document.addEventListener('pointerleave', hide)
  document.addEventListener('mouseleave', hide)
  window.addEventListener('blur', hide)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hide()
  })
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
} catch {
  /* 静默降级：指针不可用时不影响面板功能（系统指针保持可见） */
}
