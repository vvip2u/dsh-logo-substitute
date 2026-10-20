/**
 * logo-substitute —— 浏览器半（DSH Web GUI 第三方插件，lazy factory 格式）。
 *
 * 入口契约：window.__ModuleLoader__.load({ id, factory })，其中 id 必须等于包名。
 * 依赖面：只 require('react')。不得 require 任何 @deepseek-ai/* 包。
 *
 * 席位：
 * - settings.section（list）：设置导航新增「Logo替换」子菜单，常驻注册。
 * - sidebar.brand.mark / sidebar.brand.name（single）：官方
 *   @deepseek-ai/dsh-client-ui-brand-official 以 priority 0 注册。single slot 上
 *   同 priority 第二次注册会 throw，不同 priority 允许共存且 priority 数值最小者胜出，
 *   因此本插件用 priority: -1 接管。只在「已保存 mode === 'custom' 且有图片」时注册；
 *   切回 default 时 dispose，让官方鲸鱼 / 字形自然回来（绝不自绘官方鲸鱼）。
 *
 * 持久化：渲染层 localStorage（key logo-substitute:v1，沿用旧 key 以保住用户已有的图标与文字），
 * 刷新 / 重启后仍生效。
 *
 * 充值余额：数字只从 Host 半的 GET /plugins/dsh-logo-substitute/balance 取（与官方
 * 【设置】-【账号与余额】同一份 accountController 数据），纯展示、不可点击；
 * 读不到就显示灰色「--」或干脆不显示，任何情况下都不许显示成 0。
 */
window.__ModuleLoader__.load({
  id: 'dsh-logo-substitute',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const PLUGIN_ID = 'dsh-logo-substitute';
    // 设置页底部的插件信息。版本号与 package.json 的 version 保持同一版本（manifest 用合法 semver）。
    const PLUGIN_VERSION = '1.2';
    const PLUGIN_AUTHOR = 'JakeKim';
    const PLUGIN_WECHAT = 'vvip2u';
    const STORAGE_KEY = 'logo-substitute:v1';
    const BRAND_PRIORITY = -1;
    const MODE_DEFAULT = 'default';
    const MODE_CUSTOM = 'custom';
    const DEFAULT_SIZE = 24;

    const BALANCE_ENDPOINT = '/plugins/dsh-logo-substitute/balance';
    const BALANCE_REFRESH_MS = 60000;
    const THRESHOLD_DEFAULT = 10;
    const THRESHOLD_MAX = 1000000;

    // ───────────────────────────── 配置模型（纯函数） ─────────────────────────────
    function defaultSettings() {
      return {
        mode: MODE_DEFAULT,
        imageDataUrl: null,
        label: '',
        showBalance: true,
        thresholdYuan: THRESHOLD_DEFAULT,
      };
    }

    // 脏数据一律回落：未知 mode → default，非 data:image/* → null，非字符串 label → ''。
    // showBalance 只有明确的 false 才算关（旧数据没有这个字段时必须照常显示）；
    // 阈值非整数 / 负数回落默认，超出上限按上限收口（用户确实填了个大数，重置成 10 更意外）。
    function normalizeSettings(raw) {
      if (!raw || typeof raw !== 'object') return defaultSettings();
      const mode = raw.mode === MODE_CUSTOM ? MODE_CUSTOM : MODE_DEFAULT;
      const imageDataUrl = typeof raw.imageDataUrl === 'string' && /^data:image\//.test(raw.imageDataUrl)
        ? raw.imageDataUrl
        : null;
      const label = typeof raw.label === 'string' ? raw.label : '';
      const showBalance = raw.showBalance === false ? false : true;
      const thresholdYuan = Number.isInteger(raw.thresholdYuan) && raw.thresholdYuan >= 0
        ? Math.min(raw.thresholdYuan, THRESHOLD_MAX)
        : THRESHOLD_DEFAULT;
      return {
        mode: mode,
        imageDataUrl: imageDataUrl,
        label: label,
        showBalance: showBalance,
        thresholdYuan: thresholdYuan,
      };
    }

    // 保存路径上的阈值校验：与 normalizeSettings 的静默回落不同，这里必须把脏值挡下来。
    function validateThreshold(raw) {
      if (raw === null || typeof raw === 'undefined' || raw === '') {
        return { ok: true, value: THRESHOLD_DEFAULT, error: '' };
      }
      const n = Number(raw);
      if (!isFinite(n) || !Number.isInteger(n) || n < 0) {
        return { ok: false, value: null, error: '阈值必须是整数元（填 0 表示不启用红色提醒）' };
      }
      if (n > THRESHOLD_MAX) {
        return { ok: false, value: null, error: '阈值不能超过 ' + THRESHOLD_MAX + ' 元' };
      }
      return { ok: true, value: n, error: '' };
    }

    // 输入框给的是字符串：空串 / 小数 / 负数 / 非数字都要给出中文提示，绝不静默存脏值。
    function parseThresholdInput(text) {
      const raw = typeof text === 'string' ? text.trim() : text;
      if (raw === '' || raw === null || typeof raw === 'undefined') {
        return { ok: false, value: null, error: '请填写阈值（整数元，填 0 表示不启用红色提醒）' };
      }
      return validateThreshold(raw);
    }

    // 阈值比较只认「充值余额」的 CNY 钱包，不含赠金；阈值 0 表示不启用红色提醒。
    function shouldWarn(primaryCny, thresholdYuan) {
      if (typeof primaryCny !== 'number' || !isFinite(primaryCny)) return false;
      if (typeof thresholdYuan !== 'number' || !isFinite(thresholdYuan) || thresholdYuan <= 0) return false;
      return primaryCny < thresholdYuan;
    }

    // 品牌遮蔽只在 custom + 有图时成立；这也是注册 / 释放两个席位的唯一判据。
    function isCustomActive(settings) {
      const s = normalizeSettings(settings);
      return s.mode === MODE_CUSTOM && typeof s.imageDataUrl === 'string' && s.imageDataUrl.length > 0;
    }

    function resolveStorage() {
      try {
        if (typeof window !== 'undefined' && window && window.localStorage) return window.localStorage;
      } catch (err) { /* 隐私模式等场景下取 localStorage 会抛，忽略 */ }
      try {
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
      } catch (err) { /* 同上 */ }
      return null;
    }

    function readSettings(storage) {
      try {
        const store = storage || resolveStorage();
        if (!store || typeof store.getItem !== 'function') return defaultSettings();
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return defaultSettings();
        return normalizeSettings(JSON.parse(raw));
      } catch (err) {
        return defaultSettings();
      }
    }

    function writeSettings(storage, settings) {
      const next = normalizeSettings(settings);
      try {
        const store = storage || resolveStorage();
        if (!store || typeof store.setItem !== 'function') return false;
        store.setItem(STORAGE_KEY, JSON.stringify(next));
        return true;
      } catch (err) {
        return false;
      }
    }

    // 保存：default 只把 mode 置回 default（官方品牌回归），已上传的图片与文字一律保留，
    // 用户随时可切回自定义而无需重新上传；custom 必须已选好图片。
    function persistSettings(storage, draft) {
      const mode = draft && draft.mode === MODE_CUSTOM ? MODE_CUSTOM : MODE_DEFAULT;
      if (mode === MODE_CUSTOM && !(typeof draft.imageDataUrl === 'string' && draft.imageDataUrl.length > 0)) {
        return { ok: false, settings: null, error: '请先上传正方形图标，再保存' };
      }
      // 表单已经校验过；这里再挡一次，防止绕过表单的调用把 12.5 静默抹成默认值。
      const threshold = validateThreshold(draft && draft.thresholdYuan);
      if (!threshold.ok) return { ok: false, settings: null, error: threshold.error };
      const next = normalizeSettings(Object.assign({}, draft, { mode: mode, thresholdYuan: threshold.value }));
      const ok = writeSettings(storage, next);
      return { ok: ok, settings: ok ? next : null, error: ok ? '' : '保存失败：浏览器存储不可用或已满' };
    }

    // ───────────────────────────── 图片校验（纯函数） ─────────────────────────────
    // 只要求宽高相等（正方形），不做尺寸上限。
    function validateImageSize(width, height) {
      const w = Number(width);
      const hgt = Number(height);
      if (!isFinite(w) || !isFinite(hgt) || w <= 0 || hgt <= 0) {
        return { ok: false, error: '无法读取图片尺寸，请换一张图片' };
      }
      if (Math.round(w) !== Math.round(hgt)) {
        return { ok: false, error: '图片必须是正方形（当前 ' + Math.round(w) + '×' + Math.round(hgt) + '），请先裁剪为正方形再上传' };
      }
      return { ok: true, error: '' };
    }

    // 把一次候选图片折进草稿：不合法时原样返回草稿 + 中文错误，绝不覆盖已保存 / 已选中的图片。
    function reduceImageCandidate(draft, dataUrl, width, height) {
      const base = normalizeSettings(draft);
      const check = validateImageSize(width, height);
      if (!check.ok) return { draft: base, ok: false, error: check.error };
      if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
        return { draft: base, ok: false, error: '图片读取失败，请重试' };
      }
      return {
        draft: { mode: MODE_CUSTOM, imageDataUrl: dataUrl, label: base.label },
        ok: true,
        error: '',
      };
    }

    // ───────────────────────────── 共享状态 ─────────────────────────────
    // 设置页保存后必须让 apply() 重新决定两个品牌席位是否存在，故用极小的订阅式 store。
    function createStore(initial) {
      let state = normalizeSettings(initial);
      const listeners = [];
      return {
        get: () => state,
        set(next) {
          state = normalizeSettings(next);
          listeners.slice().forEach((fn) => {
            try { fn(state); } catch (err) { /* 单个订阅者出错不影响其它订阅者 */ }
          });
        },
        subscribe(fn) {
          listeners.push(fn);
          return () => {
            const at = listeners.indexOf(fn);
            if (at >= 0) listeners.splice(at, 1);
          };
        },
      };
    }

    const store = createStore(defaultSettings());

    // ───────────────────────────── 充值余额（数据层） ─────────────────────────────
    // 形状对齐 Host 半契约：status 决定显示方式（不显示 / 金额 / --），primaryCny 只用于阈值比较。
    function emptyBalance() {
      return { status: 'unavailable', display: '', primaryCny: null, fetchedAt: 0 };
    }

    function failedBalance() {
      return { status: 'failed', display: '--', primaryCny: null, fetchedAt: 0 };
    }

    // 契约之外的形状一律按 failed（显示 --）：宁可显示占位符，也不能把读不懂的数据渲染成 0。
    function normalizeBalancePayload(raw) {
      if (!raw || typeof raw !== 'object') return failedBalance();
      const known = raw.status === 'ready' || raw.status === 'signed-out' || raw.status === 'failed' || raw.status === 'unavailable';
      const status = known ? raw.status : 'failed';
      const display = typeof raw.display === 'string' ? raw.display : '';
      const primaryCny = typeof raw.primaryCny === 'number' && isFinite(raw.primaryCny) ? raw.primaryCny : null;
      const fetchedAt = typeof raw.fetchedAt === 'number' && isFinite(raw.fetchedAt) ? raw.fetchedAt : 0;
      return { status: status, display: display, primaryCny: primaryCny, fetchedAt: fetchedAt };
    }

    function defaultBalanceEvents() {
      const win = typeof window !== 'undefined' && window ? window : null;
      const doc = typeof document !== 'undefined' && document ? document : null;
      function bind(target, type, fn) {
        if (!target || typeof target.addEventListener !== 'function') return () => {};
        target.addEventListener(type, fn);
        return () => {
          try { target.removeEventListener(type, fn); } catch (err) { /* 目标已销毁，忽略 */ }
        };
      }
      return {
        on(type, fn) {
          if (type === 'visibilitychange') {
            // 只有从后台回到「可见」时才值得刷新；切走那一刻刷新没有意义。
            return bind(doc, type, () => {
              if (!doc || doc.visibilityState === 'visible') fn();
            });
          }
          return bind(win, type, fn);
        },
      };
    }

    // 极小的订阅式 store：第一个订阅者进来才开始拉取，最后一个走了就彻底停表、摘监听。
    function createBalanceStore(deps) {
      const d = deps || {};
      const listeners = [];
      let state = emptyBalance();
      let timerId = null;
      let detachers = [];
      let running = false;
      let generation = 0;

      function emit() {
        listeners.slice().forEach((fn) => {
          try { fn(state); } catch (err) { /* 单个订阅者出错不影响其它订阅者 */ }
        });
      }

      function patch(next) {
        state = next;
        emit();
      }

      function resolveFetch() {
        if (typeof d.fetch === 'function') return d.fetch;
        const win = typeof window !== 'undefined' && window ? window : null;
        if (win && typeof win.fetch === 'function') return win.fetch.bind(win);
        if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
        return null;
      }

      function timerApi() {
        if (d.timer) return d.timer;
        return {
          set: (fn, ms) => globalThis.setInterval(fn, ms),
          clear: (id) => globalThis.clearInterval(id),
        };
      }

      async function refresh() {
        const mine = generation;
        const doFetch = resolveFetch();
        if (!doFetch) {
          if (mine === generation) patch(failedBalance());
          return state;
        }
        let payload = null;
        try {
          const res = await doFetch(BALANCE_ENDPOINT, { method: 'GET', headers: { accept: 'application/json' } });
          if (!res || res.ok === false) throw new Error('balance http ' + (res ? res.status : 'no-response'));
          payload = typeof res.json === 'function' ? await res.json() : null;
        } catch (err) {
          // 任何失败都归一成 failed（显示 --），绝不把异常抛进 React 渲染。
          if (mine === generation) patch(failedBalance());
          return state;
        }
        // 卸载后到达的响应直接丢弃，避免已经摘掉的组件又写回一份数据。
        if (mine === generation) patch(normalizeBalancePayload(payload));
        return state;
      }

      function start() {
        if (running) return;
        running = true;
        refresh();
        timerId = timerApi().set(() => { refresh(); }, BALANCE_REFRESH_MS);
        const events = d.events || defaultBalanceEvents();
        // 窗口重新聚焦 / 页面重新可见时立即刷新：切回来看到的必须是新数字。
        detachers = [events.on('focus', () => { refresh(); }), events.on('visibilitychange', () => { refresh(); })];
      }

      function stop() {
        if (!running) return;
        running = false;
        generation += 1;
        if (timerId !== null) {
          timerApi().clear(timerId);
          timerId = null;
        }
        detachers.forEach((off) => {
          if (typeof off !== 'function') return;
          try { off(); } catch (err) { /* 忽略 */ }
        });
        detachers = [];
      }

      return {
        get: () => state,
        refresh: refresh,
        start: start,
        stop: stop,
        subscribe(fn) {
          listeners.push(fn);
          if (listeners.length === 1) start();
          return () => {
            const at = listeners.indexOf(fn);
            if (at >= 0) listeners.splice(at, 1);
            if (listeners.length === 0) stop();
          };
        },
      };
    }

    const balanceStore = createBalanceStore();

    // ───────────────────────────── 余额 chip（两种品牌模式共用） ─────────────────────────────
    // 颜色只用主题 token；纯展示，pointer-events:none 让点击穿透给品牌按钮，避免挡住「新建会话」。
    const CHIP_CLASS = 'logo-substitute-balance-chip';
    // 底/字成对取，两态都是「实心药丸」：
    //   未低于阈值 = 深底（label-primary，浅色主题即近黑）+ 浅灰字（label-tertiary）
    //   低于阈值   = 红底（state-error）+ 纯白字（static-white，深浅主题都是白，不用会反转的 label-primary-foreground）
    const CHIP_COLOR_NORMAL = 'var(--dsw-alias-label-tertiary)';
    const CHIP_BG_NORMAL = 'var(--dsw-alias-label-primary)';
    const CHIP_COLOR_WARN = 'var(--dsw-static-neutral-bluish-00)';
    const CHIP_BG_WARN = 'var(--dsw-alias-state-error-primary)';
    const CHIP_BASE_STYLE = {
      marginLeft: '6px',
      padding: '1px 6px',
      borderRadius: 'var(--dsw-radius-sm)',
      boxSizing: 'border-box',
      fontSize: '11px',
      lineHeight: '1.4',
      letterSpacing: 'normal',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      pointerEvents: 'none',
      color: CHIP_COLOR_NORMAL,
      background: CHIP_BG_NORMAL,
    };

    function balanceChipStyle(warn) {
      return Object.assign({}, CHIP_BASE_STYLE, warn
        ? { color: CHIP_COLOR_WARN, background: CHIP_BG_WARN }
        : { color: CHIP_COLOR_NORMAL, background: CHIP_BG_NORMAL });
    }

    // 一条渠道：React 组件用 balanceChipStyle 内联，DOM 挂载侧用它把底与字一起刷上去，
    // 避免「切成告警时只改了字色、底还是上一态」这种半更新。
    function applyChipStyle(node, warn) {
      const style = balanceChipStyle(warn);
      Object.keys(style).forEach((key) => { node.style[key] = style[key]; });
    }

    // 显示判定（两种品牌模式唯一一份）：ready → 金额，failed → --，其余状态与「开关关闭」一律不渲染。
    function resolveChipView(settings, balance) {
      const s = normalizeSettings(settings);
      if (!s.showBalance) return null;
      const b = balance || emptyBalance();
      if (b.status === 'ready') {
        const text = typeof b.display === 'string' ? b.display : '';
        if (text.length === 0) return null;
        return { text: text, warn: shouldWarn(b.primaryCny, s.thresholdYuan) };
      }
      if (b.status === 'failed') return { text: '--', warn: false };
      return null;
    }

    function useSettingsSnapshot() {
      const [snapshot, setSnapshot] = React.useState(() => store.get());
      React.useEffect(() => store.subscribe(setSnapshot), []);
      return snapshot;
    }

    function BalanceChip() {
      const settings = useSettingsSnapshot();
      const [balance, setBalance] = React.useState(() => balanceStore.get());
      const show = normalizeSettings(settings).showBalance;
      React.useEffect(() => {
        // 订阅即开始 60s 轮询；开关关掉必须退订，否则侧栏会一直空转请求。
        if (!show) return undefined;
        return balanceStore.subscribe(setBalance);
      }, [show]);
      const view = resolveChipView(settings, balance);
      if (!view) return null;
      return h('span', {
        className: CHIP_CLASS,
        'data-logo-substitute-balance': view.warn ? 'warn' : 'normal',
        style: balanceChipStyle(view.warn),
      }, view.text);
    }

    // 官方品牌模式下 HARNESS 在官方 SVG 所在的 span 里，纯文本复刻必然走形，
    // 只能把 chip 挂进那个 span 的末尾（自定义模式下由 BrandName 直接渲染）。
    const BRAND_NAME_SELECTOR = '[class*="brandName"]';

    function resolveDocument() {
      try {
        return typeof document !== 'undefined' && document ? document : null;
      } catch (err) {
        return null;
      }
    }

    function createBrandBalanceMount(deps) {
      const d = deps || {};
      const doc = d.document || resolveDocument();
      const settingsStore = d.store || store;
      const balanceStateStore = d.balanceStore || balanceStore;
      const Observer = d.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      const noop = { sync: () => {}, dispose: () => {}, getNode: () => null };
      // 没有 document（冒烟测试 / 非浏览器环境）时静默降级，绝不抛错。
      if (!doc || typeof doc.querySelector !== 'function' || typeof doc.createElement !== 'function') return noop;

      let node = null;
      let observer = null;
      let settingsOff = null;
      let balanceOff = null;
      let scheduled = false;
      let alive = true;

      function removeNode() {
        if (node && node.parentNode) {
          try { node.parentNode.removeChild(node); } catch (err) { /* 节点可能已被 React 摘走，忽略 */ }
        }
        node = null;
      }

      function stopObserver() {
        if (!observer) return;
        try { observer.disconnect(); } catch (err) { /* 忽略 */ }
        observer = null;
      }

      function stopBalancePolling() {
        if (!balanceOff) return;
        const off = balanceOff;
        balanceOff = null;
        off();
      }

      function setBalancePolling(on) {
        if (on && !balanceOff) balanceOff = balanceStateStore.subscribe(schedule);
        if (!on) stopBalancePolling();
      }

      function ensureObserver() {
        if (observer || !Observer || !doc.body) return;
        // React 重渲染会把我们插进去的节点抹掉，所以持续盯着 body 的子树变化并补挂。
        observer = new Observer(() => { schedule(); });
        observer.observe(doc.body, { childList: true, subtree: true });
      }

      function schedule() {
        if (!alive || scheduled) return;
        scheduled = true;
        const run = () => { scheduled = false; sync(); };
        if (typeof queueMicrotask === 'function') queueMicrotask(run);
        else Promise.resolve().then(run);
      }

      function place(host, view) {
        if (!node) {
          node = doc.createElement('span');
          node.className = CHIP_CLASS;
          node.textContent = view.text;
        }
        if (node.parentNode !== host) host.appendChild(node);
        if (node.textContent !== view.text) node.textContent = view.text;
        const flag = view.warn ? 'warn' : 'normal';
        if (typeof node.getAttribute === 'function' && node.getAttribute('data-logo-substitute-balance') !== flag) {
          node.setAttribute('data-logo-substitute-balance', flag);
        }
        applyChipStyle(node, view.warn);
      }

      function sync() {
        if (!alive) return;
        const settings = normalizeSettings(settingsStore.get());
        // custom + 有图时品牌名由本插件的 React 组件渲染：DOM 挂载必须让位，否则会重复显示两个数字。
        const domOwns = settings.showBalance && !isCustomActive(settings);
        setBalancePolling(domOwns);
        if (!domOwns) {
          removeNode();
          stopObserver();
          return;
        }
        ensureObserver();
        const view = resolveChipView(settings, balanceStateStore.get());
        const host = doc.querySelector(BRAND_NAME_SELECTOR);
        // 侧栏折叠 / 品牌行还没渲染：什么也不做，等 observer 在节点出现时补挂。
        if (!view || !host || typeof host.appendChild !== 'function') {
          removeNode();
          return;
        }
        place(host, view);
      }

      function dispose() {
        if (!alive) return;
        alive = false;
        if (settingsOff) {
          const off = settingsOff;
          settingsOff = null;
          off();
        }
        stopBalancePolling();
        removeNode();
        stopObserver();
      }

      settingsOff = settingsStore.subscribe(schedule);
      sync();

      return { sync: sync, dispose: dispose, getNode: () => node };
    }

    // ───────────────────────────── 品牌遮蔽组件 ─────────────────────────────
    // 行内样式与官方布局实测值对齐：brandIdentity 高 24px、gap 8px；mark 居中；name 字距 .04em。
    function BrandMark(props) {
      const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : DEFAULT_SIZE;
      const settings = store.get();
      if (!isCustomActive(settings)) return null;
      return h('img', {
        className: 'logo-substitute-brand-mark',
        'data-logo-substitute-mark': 'custom',
        src: settings.imageDataUrl,
        alt: '',
        'aria-hidden': 'true',
        width: size,
        height: size,
        style: {
          width: size + 'px',
          height: size + 'px',
          objectFit: 'contain',
          display: 'block',
        },
      });
    }

    function BrandName() {
      const settings = useSettingsSnapshot();
      if (!isCustomActive(settings)) return null;
      const label = typeof settings.label === 'string' ? settings.label : '';
      return h('span', {
        className: 'logo-substitute-brand-name',
        'data-logo-substitute-name': 'custom',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          minWidth: 0,
          letterSpacing: '.04em',
        },
      },
        h('span', {
          className: 'logo-substitute-brand-label',
          'data-logo-substitute-label-text': label,
          style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, label),
        h('span', {
          className: 'logo-substitute-brand-harness',
          'data-logo-substitute-harness': 'true',
          style: {
            fontSize: '10px',
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--dsw-alias-label-tertiary)',
            whiteSpace: 'nowrap',
          },
        }, 'HARNESS'),
        h(BalanceChip, { key: 'balance' })
      );
    }

    // ───────────────────────────── 设置页 ─────────────────────────────
    // 全部使用已核实的 --dsw-alias-* 主题 token，深浅色自动跟随；不硬编码颜色。
    const STYLE = [
      '.logo-substitute-root{height:100%;box-sizing:border-box;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:20px clamp(14px,3vw,32px) 32px;display:flex;flex-direction:column;gap:16px;}',
      '.logo-substitute-header{display:flex;flex-direction:column;gap:6px;}',
      '.logo-substitute-title{margin:0;font-size:16px;font-weight:600;line-height:1.4;}',
      '.logo-substitute-subtitle{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;}',
      '.logo-substitute-tabs{display:inline-flex;gap:4px;padding:3px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);align-self:flex-start;}',
      '.logo-substitute-tab{font:inherit;font-size:12px;font-weight:600;line-height:1.4;cursor:pointer;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-secondary);padding:4px 14px;}',
      '.logo-substitute-tab:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.logo-substitute-tab-active{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));}',
      '.logo-substitute-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.logo-substitute-panel{display:flex;flex-direction:column;gap:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:14px;}',
      '.logo-substitute-field{display:flex;flex-direction:column;gap:6px;}',
      '.logo-substitute-field-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.logo-substitute-input{box-sizing:border-box;width:100%;max-width:320px;font:inherit;font-size:13px;line-height:1.5;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:6px 10px;}',
      '.logo-substitute-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.logo-substitute-file{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.logo-substitute-preview{display:flex;align-items:center;gap:10px;}',
      '.logo-substitute-preview-img{width:48px;height:48px;object-fit:contain;display:block;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);padding:2px;}',
      '.logo-substitute-preview-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);}',
      '.logo-substitute-hint{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.7;}',
      '.logo-substitute-switch{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);cursor:pointer;}',
      '.logo-substitute-switch-box{margin:2px 0 0;flex:none;accent-color:var(--dsw-alias-brand-primary);}',
      '.logo-substitute-number{box-sizing:border-box;width:120px;font:inherit;font-size:13px;line-height:1.5;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:6px 10px;}',
      '.logo-substitute-number:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.logo-substitute-help{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-tertiary);}',
      '.logo-substitute-notice{margin:0;font-size:12px;line-height:1.6;}',
      '.logo-substitute-notice-ok{color:var(--dsw-alias-state-success-primary);}',
      '.logo-substitute-notice-error{color:var(--dsw-alias-state-error-primary);}',
      '.logo-substitute-footer{margin-top:auto;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;gap:12px;}',
      '.logo-substitute-meta{margin:0 0 0 auto;display:flex;flex-direction:column;gap:2px;align-items:flex-end;text-align:right;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary);}',
      '.logo-substitute-meta-version{font-weight:600;color:var(--dsw-alias-label-secondary);}',
      '.logo-substitute-save{font:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer;border-radius:8px;border:1px solid var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));padding:7px 20px;}',
      '.logo-substitute-save:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.logo-substitute-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
    ].join('');

    function SettingsSection() {
      const [draft, setDraft] = React.useState(() => store.get());
      const [notice, setNotice] = React.useState({ kind: '', text: '' });
      // 阈值在表单里是字符串：保留用户的原始输入，保存时才校验，错误才会具体。
      const [thresholdText, setThresholdText] = React.useState(() => String(normalizeSettings(store.get()).thresholdYuan));
      const mode = draft.mode === MODE_CUSTOM ? MODE_CUSTOM : MODE_DEFAULT;

      function pickMode(next) {
        setNotice({ kind: '', text: '' });
        setDraft(Object.assign({}, draft, { mode: next }));
      }

      function onFileChange(event) {
        const target = event && event.target;
        const file = target && target.files && target.files[0];
        if (!file) return;
        const fail = (text) => setNotice({ kind: 'error', text: text });
        try {
          const reader = new FileReader();
          reader.onerror = () => fail('图片读取失败，请重试');
          reader.onload = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : '';
            const probe = new Image();
            probe.onerror = () => fail('无法解析该图片，请换一张');
            probe.onload = () => {
              const outcome = reduceImageCandidate(draft, dataUrl, probe.naturalWidth || probe.width, probe.naturalHeight || probe.height);
              if (!outcome.ok) { fail(outcome.error); return; }
              setDraft(outcome.draft);
              setNotice({ kind: 'ok', text: '图片已就绪，点「保存」生效' });
            };
            probe.src = dataUrl;
          };
          reader.readAsDataURL(file);
        } catch (err) {
          fail('图片读取失败，请重试');
        }
      }

      function onLabelChange(event) {
        setDraft(Object.assign({}, draft, { label: event && event.target ? event.target.value : '' }));
      }

      function onShowBalanceChange(event) {
        setNotice({ kind: '', text: '' });
        setDraft(Object.assign({}, draft, { showBalance: !!(event && event.target && event.target.checked) }));
      }

      function onThresholdChange(event) {
        setNotice({ kind: '', text: '' });
        setThresholdText(event && event.target ? event.target.value : '');
      }

      function onSave() {
        // 先校验阈值：非整数 / 负数 / 空串必须在保存时给出中文提示，绝不静默抹成默认值。
        const threshold = parseThresholdInput(thresholdText);
        if (!threshold.ok) {
          setNotice({ kind: 'error', text: threshold.error });
          return;
        }
        const result = persistSettings(resolveStorage(), Object.assign({}, draft, { thresholdYuan: threshold.value }));
        if (!result.ok) { setNotice({ kind: 'error', text: result.error }); return; }
        store.set(result.settings);
        setNotice({ kind: 'ok', text: '已保存' });
      }

      return h('div', { className: 'logo-substitute-root', 'data-logo-substitute-root': 'true', 'data-logo-substitute-mode': mode },
        h('style', { dangerouslySetInnerHTML: { __html: STYLE } }),
        h('header', { className: 'logo-substitute-header' },
          h('h1', { className: 'logo-substitute-title' }, 'Logo替换'),
          h('p', { className: 'logo-substitute-subtitle' }, '替换侧边栏顶部品牌行的鲸鱼标志与 deepseek 字形。HARNESS 标记会保留，右侧可选显示充值余额。')
        ),
        h('div', { className: 'logo-substitute-tabs', role: 'tablist' },
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'logo-substitute-tab' + (mode === MODE_DEFAULT ? ' logo-substitute-tab-active' : ''),
            'data-logo-substitute-tab': MODE_DEFAULT,
            'aria-selected': mode === MODE_DEFAULT,
            onClick: () => pickMode(MODE_DEFAULT),
          }, '使用默认'),
          h('button', {
            type: 'button',
            role: 'tab',
            className: 'logo-substitute-tab' + (mode === MODE_CUSTOM ? ' logo-substitute-tab-active' : ''),
            'data-logo-substitute-tab': MODE_CUSTOM,
            'aria-selected': mode === MODE_CUSTOM,
            onClick: () => pickMode(MODE_CUSTOM),
          }, '使用自定义')
        ),
        h('div', { className: 'logo-substitute-panel', 'data-logo-substitute-panel': mode },
          mode === MODE_CUSTOM
            ? [
                h('div', { className: 'logo-substitute-field', key: 'icon' },
                  h('label', { className: 'logo-substitute-field-label', htmlFor: 'logo-substitute-file' }, '图标（正方形图片）'),
                  h('input', {
                    id: 'logo-substitute-file',
                    type: 'file',
                    accept: 'image/*',
                    className: 'logo-substitute-file',
                    'data-logo-substitute-file': 'true',
                    onChange: onFileChange,
                  }),
                  h('div', { className: 'logo-substitute-preview' },
                    draft.imageDataUrl
                      ? h('img', {
                          className: 'logo-substitute-preview-img',
                          'data-logo-substitute-preview': 'true',
                          src: draft.imageDataUrl,
                          alt: '自定义图标预览',
                        })
                      : h('span', { className: 'logo-substitute-preview-empty', 'data-logo-substitute-preview': 'empty' }, '尚未选择图片')
                  ),
                  h('p', { className: 'logo-substitute-hint' }, '仅要求宽高相等（正方形），无尺寸上限；非正方形会提示且不覆盖已保存的设置。')
                ),
                h('div', { className: 'logo-substitute-field', key: 'label' },
                  h('label', { className: 'logo-substitute-field-label', htmlFor: 'logo-substitute-label' }, '文字标识名称'),
                  h('input', {
                    id: 'logo-substitute-label',
                    type: 'text',
                    className: 'logo-substitute-input',
                    'data-logo-substitute-label': 'true',
                    placeholder: '例如：My Team',
                    maxLength: 40,
                    value: draft.label,
                    onChange: onLabelChange,
                  }),
                  h('p', { className: 'logo-substitute-hint' }, '该文字会替换「deepseek」字形，右侧自动接上 HARNESS 标记。')
                ),
                h('div', { className: 'logo-substitute-field', key: 'balance' },
                  h('label', { className: 'logo-substitute-switch', htmlFor: 'logo-substitute-show-balance' },
                    h('input', {
                      id: 'logo-substitute-show-balance',
                      type: 'checkbox',
                      className: 'logo-substitute-switch-box',
                      'data-logo-substitute-show-balance': 'true',
                      checked: draft.showBalance !== false,
                      onChange: onShowBalanceChange,
                    }),
                    h('span', null, '在侧栏显示充值余额')
                  ),
                  h('p', { className: 'logo-substitute-hint' }, '该开关对「使用默认」与「使用自定义」两种品牌都生效：只在侧栏品牌行 HARNESS 右侧多显示一个数字，点了不会跳转。')
                ),
                h('div', { className: 'logo-substitute-field', key: 'threshold' },
                  h('label', { className: 'logo-substitute-field-label', htmlFor: 'logo-substitute-threshold' }, '低于多少元变红（整数，填 0 不启用）'),
                  h('input', {
                    id: 'logo-substitute-threshold',
                    type: 'number',
                    min: 0,
                    max: THRESHOLD_MAX,
                    step: 1,
                    className: 'logo-substitute-number',
                    'data-logo-substitute-threshold': 'true',
                    value: thresholdText,
                    onChange: onThresholdChange,
                  }),
                  h('ul', { className: 'logo-substitute-help', 'data-logo-substitute-balance-help': 'true' },
                    h('li', { key: 'source' }, '数字来源与【设置】-【账号与余额】的【充值余额】完全相同：侧栏读的是同一份数据，约每 60 秒刷新一次，所以可能比你重新打开设置页看到的晚一会儿（切回窗口时会立即刷新）。'),
                    h('li', { key: 'bonus' }, '只算「充值余额」，不含赠金余额；有多个币种时按官方规则用「 + 」连接显示。'),
                    h('li', { key: 'warn' }, '金额严格小于阈值时用红色显示；阈值填 0 表示不启用红色提醒。'),
                    h('li', { key: 'state' }, '未登录时不显示这个数字；已登录但读取失败时显示灰色的「--」，任何情况都不会显示成 0。')
                  )
                ),
              ]
            : h('p', { className: 'logo-substitute-hint', 'data-logo-substitute-default-hint': 'true' },
                '当前使用官方默认品牌（鲸鱼标志 + deepseek HARNESS）。保存后侧边栏恢复官方品牌；自定义图片与文字会保留，随时可切回自定义。')
        ),
        notice.kind
          ? h('p', {
              className: 'logo-substitute-notice logo-substitute-notice-' + notice.kind,
              'data-logo-substitute-notice': notice.kind,
              'aria-live': 'polite',
            }, notice.text)
          : null,
        h('footer', { className: 'logo-substitute-footer' },
          h('button', {
            type: 'button',
            className: 'logo-substitute-save',
            'data-logo-substitute-save': 'true',
            onClick: onSave,
          }, '保存'),
          h('div', { className: 'logo-substitute-meta', 'data-logo-substitute-meta': 'true' },
            h('span', {
              className: 'logo-substitute-meta-version',
              'data-logo-substitute-version': PLUGIN_VERSION,
            }, 'Logo替换 v' + PLUGIN_VERSION),
            h('span', {
              className: 'logo-substitute-meta-author',
              'data-logo-substitute-author': PLUGIN_AUTHOR,
            }, '作者 ' + PLUGIN_AUTHOR + ' ｜ 微信 ' + PLUGIN_WECHAT)
          )
        )
      );
    }

    // ───────────────────────────── 席位注册 ─────────────────────────────
    function apply(ctx) {
      const slots = ctx && ctx.slots;
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return;

      const scope = typeof ctx.effect === 'function'
        ? ctx.effect
        : (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {}; };

      // 用已保存的配置初始化共享状态：刷新 / 重启后品牌遮蔽立即恢复。
      store.set(readSettings(resolveStorage()));

      scope(() => {
        const disposeSettings = slots.inject('settings.section', () => slots.register({
          name: 'settings.section',
          id: PLUGIN_ID,
          order: 100,
          label: () => 'Logo替换',
        }, SettingsSection));

        // 品牌遮蔽：single slot 上 priority 数值最小者胜出，故 -1 覆盖官方 priority 0。
        // 只在 custom + 有图时占用；切回 default 必须释放，否则官方品牌回不来。
        let disposeBrands = [];

        function releaseBrands() {
          const pending = disposeBrands;
          disposeBrands = [];
          pending.forEach((dispose) => { if (typeof dispose === 'function') dispose(); });
        }

        function syncBrands() {
          releaseBrands();
          if (!isCustomActive(store.get())) return;
          disposeBrands = [
            slots.inject('sidebar.brand.mark', () => slots.register({
              name: 'sidebar.brand.mark',
              priority: BRAND_PRIORITY,
            }, BrandMark)),
            slots.inject('sidebar.brand.name', () => slots.register({
              name: 'sidebar.brand.name',
              priority: BRAND_PRIORITY,
            }, BrandName)),
          ];
        }

        syncBrands();
        const unsubscribe = store.subscribe(syncBrands);

        // 余额 chip 的 DOM 挂载：官方品牌模式下没法用 React 渲染进官方 SVG 所在的 span。
        // custom 模式下它会自动让位给 React 组件（见 sync 里的判断）。
        const brandBalance = createBrandBalanceMount({ store: store, balanceStore: balanceStore });

        return () => {
          brandBalance.dispose();
          unsubscribe();
          releaseBrands();
          if (typeof disposeSettings === 'function') disposeSettings();
        };
      }, 'dsh-logo-substitute: slots');

      return undefined;
    }

    // 测试缝：仅供 tools/smoke-test.mjs 直接调用；DSH loader 只读 inject/apply。
    const __internals = {
      STORAGE_KEY: STORAGE_KEY,
      PLUGIN_ID: PLUGIN_ID,
      BRAND_PRIORITY: BRAND_PRIORITY,
      MODE_DEFAULT: MODE_DEFAULT,
      MODE_CUSTOM: MODE_CUSTOM,
      STYLE: STYLE,
      defaultSettings: defaultSettings,
      normalizeSettings: normalizeSettings,
      isCustomActive: isCustomActive,
      readSettings: readSettings,
      writeSettings: writeSettings,
      persistSettings: persistSettings,
      validateImageSize: validateImageSize,
      reduceImageCandidate: reduceImageCandidate,
      createStore: createStore,
      getStore: () => store,
      SettingsSection: SettingsSection,
      BrandMark: BrandMark,
      BrandName: BrandName,
      BALANCE_ENDPOINT: BALANCE_ENDPOINT,
      BALANCE_REFRESH_MS: BALANCE_REFRESH_MS,
      THRESHOLD_DEFAULT: THRESHOLD_DEFAULT,
      THRESHOLD_MAX: THRESHOLD_MAX,
      CHIP_CLASS: CHIP_CLASS,
      CHIP_COLOR_NORMAL: CHIP_COLOR_NORMAL,
      CHIP_COLOR_WARN: CHIP_COLOR_WARN,
      CHIP_BG_NORMAL: CHIP_BG_NORMAL,
      CHIP_BG_WARN: CHIP_BG_WARN,
      applyChipStyle: applyChipStyle,
      BRAND_NAME_SELECTOR: BRAND_NAME_SELECTOR,
      shouldWarn: shouldWarn,
      validateThreshold: validateThreshold,
      parseThresholdInput: parseThresholdInput,
      normalizeBalancePayload: normalizeBalancePayload,
      createBalanceStore: createBalanceStore,
      getBalanceStore: () => balanceStore,
      balanceChipStyle: balanceChipStyle,
      resolveChipView: resolveChipView,
      BalanceChip: BalanceChip,
      createBrandBalanceMount: createBrandBalanceMount,
    };

    return {
      inject: ['slots'],
      apply: apply,
      __internals: __internals,
    };
  },
});
