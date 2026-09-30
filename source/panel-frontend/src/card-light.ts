/*!
 * 星野 Xingye · 指针光效引擎（一个光源照亮范围内所有卡片）
 * ---------------------------------------------------------------------------
 * 逻辑整体复刻自 leafmy.top 站点的鼠标悬停光效（/custom/admin/admin.js 的
 * 「卡片光效」段落 + /custom/admin/admin.css 的 .adm-glow-blob / .adm-edge）：
 *
 *   · 指针是一个点光源：范围内每张卡片按「指针到卡片矩形的最近距离」衰减发光，
 *     近的更亮、远的更淡，指针在卡片内时强度锁死为 1；
 *   · 卡片内注入两层跟随指针的发光元素（见 harmonyos.css 第 14 节）：
 *       .card-light-blob  软光斑（背景洗光，radial-gradient 固定，只平移）
 *       .card-light-edge  1px 边缘环（mask 环）+ 环上高光 .card-light-edge-light
 *   · 光心只做 transform 平移（走合成器），不改渐变坐标 —— 后者会让浏览器
 *     每帧重绘渐变，快速移动时出现拖影 / 跳动；
 *   · 强度写成 --card-light(0~1)，透明度由 CSS 侧计算，只做阈值写入；
 *   · pointermove 经 requestAnimationFrame 合并，一帧最多写一次样式。
 *
 * 卡片的圆角、边框、毛玻璃与内容层级都在 CSS 里（.card-light 系列规则），
 * 本模块只负责「谁发光、发多亮、光心在哪」。
 * ---------------------------------------------------------------------------
 */

/* ---------------- 常量（与站点一致） ---------------- */

/** 光效影响半径（px）：指针到此半径内的卡片都会发光 */
const GLOW_RADIUS = 280;
/** 光斑 / 环高光直径（px）—— 平移时用各自半径做偏移，须与 CSS 一致 */
const BLOB_SIZE = 420;
const EDGE_LIGHT_SIZE = 380;
/** 强度变化小于此值不写样式，避免无谓的样式重算 */
const MIN_DELTA = 0.004;

/**
 * 参与光效的卡片。刻意排除布局外壳（.sidebar / .header / .titlebar /
 * .content-wrapper / .app），避免给它们加上 position:relative + 裁剪后
 * 破坏既有布局；其余都是面板里成组排布的卡片、磁贴与行。
 */
const CARD_SELECTOR = [
  '.nav-item',
  '.stat-card',
  '.panel',
  '.resource-card',
  '.feature-item',
  '.settings-item',
  '.settings-sub',
  '.settings-info-row',
  '.usage-summary-card',
  '.close-behavior-option',
  '.sys-toggle-row',
  '.filter-tab',
  '.log-row',
  '.log-item',
  '.conn-popover-item',
  '.check-label',
  '.sys-checkbox',
  '.cli-box',
  '.log-search',
  '.text-input',
  '.select-input',
  '.select-sm',
  '.search-input',
  '.sys-textarea',
  '.sys-btn',
  '.icon-btn',
  '.btn-primary',
  '.btn-outline',
  '.btn-xs',
  '.toggle-btn',
  '.titlebar-btn',
  '.header-toggle',
  '.app-settings-btn',
  '.dark-mode-toggle',
  '.panel-link',
  '.panel-badge',
  '.live-badge',
].join(',');

/* ---------------- 内部状态 ---------------- */

interface GlowCard {
  el: HTMLElement;
  blob: HTMLElement;
  light: HTMLElement;
  /** 上一次写入的强度，用于跳过无变化的重绘 */
  value: number;
}

let cards: GlowCard[] = [];
let pointerX = -9999;
let pointerY = -9999;
let frameId = 0;
let observeTimer = 0;
let moveTimer = 0;

const reduceMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 卡片装饰 ---------------- */

/** 给一张卡片挂上光层元素（已挂过则跳过） */
function decorate(el: HTMLElement): void {
  el.classList.add('card-light');
  if (el.querySelector(':scope > .card-light-blob')) return;

  const blob = document.createElement('i');
  blob.className = 'card-light-blob';
  blob.setAttribute('aria-hidden', 'true');

  const edge = document.createElement('i');
  edge.className = 'card-light-edge';
  edge.setAttribute('aria-hidden', 'true');
  const light = document.createElement('i');
  light.className = 'card-light-edge-light';
  edge.appendChild(light);

  el.append(blob, edge);
}

/** 重新扫描全文档，给所有卡片挂光层 */
function decorateAll(): void {
  const found = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  cards = [];
  for (const el of found) {
    /* 光层自身、以及面板外壳不参与 */
    if (el.classList.contains('card-light-blob') || el.classList.contains('card-light-edge')) continue;
    decorate(el);
    const blob = el.querySelector<HTMLElement>(':scope > .card-light-blob');
    const light = el.querySelector<HTMLElement>(':scope > .card-light-edge > .card-light-edge-light');
    if (!blob || !light) continue;
    cards.push({ el, blob, light, value: -1 });
  }
  schedule();
}

/* ---------------- 渲染 ---------------- */

/** 把光斑与环高光「停」到屏幕外，避免下次进入时从旧位置滑过来 */
function park(): void {
  for (const card of cards) {
    card.blob.style.transform = 'translate3d(-999px, -999px, 0)';
    card.light.style.transform = 'translate3d(-999px, -999px, 0)';
  }
}

/**
 * 一帧内更新全部卡片：先算强度（距离衰减），再平移光心。
 * 注意：位置更新不能跟强度一起跳过 —— 指针进入卡片后距离恒为 0、强度锁死
 * 在 1，若同时跳过位置，光斑会卡在进入点（站点里踩过的坑）。
 */
function update(): void {
  frameId = 0;
  if (!cards.length) decorateAll();

  for (const card of cards) {
    const el = card.el;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    /* 指针到卡片矩形的最近点距离（指针在卡片内 → 0） */
    const nearX = pointerX < rect.left ? rect.left : pointerX > rect.right ? rect.right : pointerX;
    const nearY = pointerY < rect.top ? rect.top : pointerY > rect.bottom ? rect.bottom : pointerY;
    const dx = pointerX - nearX;
    const dy = pointerY - nearY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let strength = 1 - distance / GLOW_RADIUS;
    if (strength < 0) strength = 0;
    else if (strength > 1) strength = 1;
    strength *= strength;                        /* 二次衰减：近处亮得明显 */

    /* 已熄灭且仍在范围外 → 连位置都不用更新 */
    if (strength <= 0 && card.value === 0) continue;

    /* 光心：每帧只做 transform 平移 */
    const localX = pointerX - rect.left;
    const localY = pointerY - rect.top;
    card.blob.style.transform =
      `translate3d(${(localX - BLOB_SIZE / 2).toFixed(1)}px,${(localY - BLOB_SIZE / 2).toFixed(1)}px,0)`;
    card.light.style.transform =
      `translate3d(${(localX - EDGE_LIGHT_SIZE / 2).toFixed(1)}px,${(localY - EDGE_LIGHT_SIZE / 2).toFixed(1)}px,0)`;

    /* 强度：只在变化超过阈值时写 */
    if (card.value < 0 || Math.abs(strength - card.value) >= MIN_DELTA) {
      card.value = strength;
      el.style.setProperty('--card-light', strength.toFixed(3));
    }
  }
}

function schedule(): void {
  if (!frameId) frameId = window.requestAnimationFrame(update);
}

/* ---------------- 事件 ---------------- */

function onPointerMove(event: PointerEvent): void {
  pointerX = event.clientX;
  pointerY = event.clientY;

  /* 高频抖动（一帧多次 pointermove）时退化为「只写样式」的纯合成路径：
   * 给光层补一段短过渡，让重排期间的落点变化看起来是滑动而不是瞬移。 */
  if (!reduceMotion() && !moveTimer) {
    for (const card of cards) {
      card.blob.style.transition = 'transform 90ms linear';
      card.light.style.transition = 'transform 90ms linear';
    }
    moveTimer = window.setTimeout(() => {
      moveTimer = 0;
      for (const card of cards) {
        card.blob.style.transition = '';
        card.light.style.transition = '';
      }
    }, 220);
  }

  schedule();
}

/** 指针离开文档 / 窗口失焦 / 窗口尺寸变化 → 全部熄灭 */
function kill(): void {
  pointerX = -9999;
  pointerY = -9999;
  park();
  /* 走一次常规渲染把强度归零：CSS 侧的 opacity 过渡负责淡出，不硬切 */
  schedule();
}

/* ---------------- 启动 ---------------- */

function start(): void {
  decorateAll();

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', kill);
  document.addEventListener('mouseleave', kill);
  window.addEventListener('blur', kill);
  window.addEventListener('resize', kill);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) kill();
  });

  /* 列表 / 分页 / 切页都会新增卡片，用 MutationObserver 兜住（防抖 80ms）。
   * 只观察 .app 子树；光层自身由脚本注入，通过判定跳过以免自激。 */
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver((records) => {
      const meaningful = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            !node.classList.contains('card-light-blob') &&
            !node.classList.contains('card-light-edge') &&
            !node.classList.contains('card-light-edge-light')
        )
      );
      if (!meaningful) return;
      if (observeTimer) window.clearTimeout(observeTimer);
      observeTimer = window.setTimeout(() => {
        observeTimer = 0;
        decorateAll();
      }, 80);
    });
    observer.observe(document.querySelector('.app') ?? document.body, {
      childList: true,
      subtree: true,
    });
  }
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
} catch {
  /* 静默降级：光效不可用时不影响面板功能 */
}
