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
 *
 * 性能约定（改这个文件前请先读这一段）：
 *   1. 事件回调里只记录坐标，禁止做任何几何读取 / 样式写入；
 *   2. 一帧内先「只读」读完全部卡片几何，再「只写」写完全部样式，
 *      不允许读一张写一张（那会让每张卡片都重新触碰样式失效状态）；
 *   3. prefers-reduced-motion 的判定结果缓存，不在高频回调里新建 MediaQueryList；
 *   4. 文档重扫走 WeakMap 快路径，已挂过光层的卡片不再做任何 DOM 查询；
 *   5. 窗口不可见时不排队渲染帧，恢复可见时由 visibilitychange 重新驱动。
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
/** 光心位移小于此值不写样式（与 toFixed(1) 的写入精度对齐） */
const MIN_MOVE = 0.1;
/** 指针运动期间挂在 <html> 上的平滑类（规则见 harmonyos.css 第 14 节） */
const SMOOTH_CLASS = 'card-light-smoothing';
/** 平滑窗口时长（ms）：与旧版逐卡片写内联 transition 的计时保持一致 */
const SMOOTH_MS = 220;

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
  /** 上一次写入的光心坐标（相对卡片左上角），用于跳过亚像素级重复写入 */
  lastX: number;
  lastY: number;
  /** 本帧读到的几何：只在 rAF 的「读」阶段赋值，绝不在事件回调里读 */
  rect: DOMRect | null;
}

let cards: GlowCard[] = [];
/**
 * 元素 → 光效状态的持久映射。重扫时复用旧状态，好处有二：
 *   · 不用为每张卡片再跑 `:scope >` 选择器查询（旧版每卡片 3 次）；
 *   · value / lastX / lastY 跟着元素走，重扫后不会因归零而全量重写样式。
 */
const cardState = new WeakMap<HTMLElement, GlowCard>();

let pointerX = -9999;
let pointerY = -9999;
let frameId = 0;
let observeTimer = 0;
let smoothTimer = 0;

/**
 * prefers-reduced-motion 的结果缓存。
 * 旧实现在每个 pointermove 里调一次 matchMedia —— 那是新建 MediaQueryList 的
 * 分配开销，高频指针移动时完全是浪费。这里只订阅一次 change 事件。
 */
let prefersReduced = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 卡片装饰 ---------------- */

/**
 * 给一张卡片挂上光层元素（已挂过则复用，返回两层元素）。
 * 快路径用 parentElement / isConnected 两个 O(1) 判断代替选择器查询；
 * 只有首次遇到、或光层被 Vue 重渲染挪走时才走慢路径补挂。
 */
function decorate(el: HTMLElement): { blob: HTMLElement; light: HTMLElement } | null {
  el.classList.add('card-light');

  const cached = cardState.get(el);
  if (cached && cached.blob.parentElement === el && cached.light.parentElement?.parentElement === el) {
    return { blob: cached.blob, light: cached.light };
  }

  let blob = el.querySelector<HTMLElement>(':scope > .card-light-blob');
  if (!blob) {
    blob = document.createElement('i');
    blob.className = 'card-light-blob';
    blob.setAttribute('aria-hidden', 'true');
    el.append(blob);
  }

  let light = el.querySelector<HTMLElement>(':scope > .card-light-edge > .card-light-edge-light');
  if (!light) {
    const edge = document.createElement('i');
    edge.className = 'card-light-edge';
    edge.setAttribute('aria-hidden', 'true');
    light = document.createElement('i');
    light.className = 'card-light-edge-light';
    edge.appendChild(light);
    el.append(edge);
  }

  return { blob, light };
}

/** 重新扫描全文档，给所有卡片挂光层并重建缓存数组 */
function decorateAll(): void {
  const found = document.querySelectorAll<HTMLElement>(CARD_SELECTOR);
  const next: GlowCard[] = [];
  for (const el of found) {
    /* 光层自身、以及面板外壳不参与 */
    if (el.classList.contains('card-light-blob') || el.classList.contains('card-light-edge')) continue;
    const parts = decorate(el);
    if (!parts) continue;
    /* 复用旧状态：强度与光心缓存跟着元素走，重扫后无需全量重写样式 */
    const prev = cardState.get(el);
    if (prev) {
      prev.blob = parts.blob;
      prev.light = parts.light;
      next.push(prev);
    } else {
      const card: GlowCard = {
        el,
        blob: parts.blob,
        light: parts.light,
        value: -1,
        lastX: -999,
        lastY: -999,
        rect: null,
      };
      cardState.set(el, card);
      next.push(card);
    }
  }
  cards = next;
  schedule();
}

/* ---------------- 渲染 ---------------- */

/** 把光斑与环高光「停」到屏幕外，避免下次进入时从旧位置滑过来 */
function park(): void {
  for (const card of cards) {
    card.blob.style.transform = 'translate3d(-999px, -999px, 0)';
    card.light.style.transform = 'translate3d(-999px, -999px, 0)';
    /* 位置缓存同步复位：否则下一次进入会被「位移不足 MIN_MOVE 不写」挡住 */
    card.lastX = -999;
    card.lastY = -999;
  }
}

/**
 * 一帧内更新全部卡片，分两个阶段：
 *   阶段一（只读）：连续读完全部卡片的几何，中间不写任何样式；
 *   阶段二（只写）：算强度、平移光心。
 * 旧实现是「读一张 → 写一张 → 再读下一张」的交替循环，每张卡片都会重新
 * 触碰样式/布局失效状态，并且每张卡片都要分配一个 DOMRect 对象（GC 压力）。
 *
 * 注意：位置更新不能跟强度一起跳过 —— 指针进入卡片后距离恒为 0、强度锁死
 * 在 1，若同时跳过位置，光斑会卡在进入点（站点里踩过的坑）。这里只按
 * 「位移是否小于写入精度」跳过位置，与强度判断彼此独立。
 */
function update(): void {
  frameId = 0;
  /* 窗口不可见：不做任何几何读取与样式写入 */
  if (document.hidden) return;
  if (!cards.length) decorateAll();

  /* ---- 阶段一：只读几何 ---- */
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    card.rect = card.el.getBoundingClientRect();
  }

  /* ---- 阶段二：只写样式 ---- */
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const rect = card.rect;
    if (!rect || rect.width < 1 || rect.height < 1) continue;

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

    /* 光心：每帧只做 transform 平移；位移不足写入精度时整段跳过 */
    const localX = pointerX - rect.left;
    const localY = pointerY - rect.top;
    if (Math.abs(localX - card.lastX) >= MIN_MOVE || Math.abs(localY - card.lastY) >= MIN_MOVE) {
      card.lastX = localX;
      card.lastY = localY;
      card.blob.style.transform =
        `translate3d(${(localX - BLOB_SIZE / 2).toFixed(1)}px,${(localY - BLOB_SIZE / 2).toFixed(1)}px,0)`;
      card.light.style.transform =
        `translate3d(${(localX - EDGE_LIGHT_SIZE / 2).toFixed(1)}px,${(localY - EDGE_LIGHT_SIZE / 2).toFixed(1)}px,0)`;
    }

    /* 强度：只在变化超过阈值时写 */
    if (card.value < 0 || Math.abs(strength - card.value) >= MIN_DELTA) {
      card.value = strength;
      card.el.style.setProperty('--card-light', strength.toFixed(3));
    }
  }
}

function schedule(): void {
  /* 隐藏时不排队：requestAnimationFrame 在后台可能长时间不触发，
   * 若留着 frameId 未清零，恢复可见后就再也排不进帧了。 */
  if (document.hidden) return;
  if (!frameId) frameId = window.requestAnimationFrame(update);
}

/* ---------------- 指针运动平滑 ---------------- */

/**
 * 指针运动期间给光层挂上 transform 过渡（整篇文档一次类切换）。
 * 旧实现是在 pointermove 里逐卡片写内联 transition：一次运动开始就是
 * 2×卡片数 次样式写入，停止运动 220ms 后还要再写一遍清掉。
 * 现在 N 张卡片 → 1 次写入，视觉语义完全一致（见 harmonyos.css）。
 */
function beginSmoothing(): void {
  if (prefersReduced || smoothTimer) return;
  document.documentElement.classList.add(SMOOTH_CLASS);
  smoothTimer = window.setTimeout(() => {
    smoothTimer = 0;
    document.documentElement.classList.remove(SMOOTH_CLASS);
  }, SMOOTH_MS);
}

/** 减少动效偏好被打开时立刻撤掉平滑类 */
function stopSmoothing(): void {
  if (!smoothTimer) return;
  window.clearTimeout(smoothTimer);
  smoothTimer = 0;
  document.documentElement.classList.remove(SMOOTH_CLASS);
}

/**
 * 订阅 prefers-reduced-motion 变化。
 * 结果缓存到 prefersReduced，高频回调里只读这个布尔量。
 */
function watchReduceMotion(): void {
  if (typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReduced = mq.matches;
  const onChange = (event: MediaQueryListEvent): void => {
    prefersReduced = event.matches;
    if (prefersReduced) stopSmoothing();
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);   /* 旧内核兜底 */
}

/* ---------------- 事件 ---------------- */

function onPointerMove(event: PointerEvent): void {
  /* 高频回调里只记录坐标：几何计算与样式写入全部合并到下一帧的 rAF 里 */
  pointerX = event.clientX;
  pointerY = event.clientY;

  /* 平滑类最多每个运动窗口挂一次（内部有 smoothTimer 闸门），不涉及逐元素写入 */
  beginSmoothing();

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
  watchReduceMotion();
  decorateAll();

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', kill);
  document.addEventListener('mouseleave', kill);
  window.addEventListener('blur', kill);
  window.addEventListener('resize', kill);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      /* 隐藏：撤掉挂起的那一帧并熄灭，避免后台继续跑合成 */
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      kill();
    } else {
      /* 恢复可见：补一次扫描（隐藏期间新增的卡片不会被下面的事件处理），
       * decorateAll 会重新驱动一帧 */
      decorateAll();
    }
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
      /* 隐藏期间不重扫：恢复可见时由 visibilitychange 补一次 */
      if (document.hidden) return;
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
