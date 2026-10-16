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
 * 持久化：渲染层 localStorage（key logo-substitute:v1），刷新 / 重启后仍生效。
 */
window.__ModuleLoader__.load({
  id: 'logo-substitute',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const PLUGIN_ID = 'logo-substitute';
    // 设置页底部的插件信息。版本号与 package.json 的 version 保持同一版本（manifest 用合法 semver）。
    const PLUGIN_VERSION = '1.0';
    const PLUGIN_AUTHOR = 'JakeKim';
    const PLUGIN_WECHAT = 'vvip2u';
    const STORAGE_KEY = 'logo-substitute:v1';
    const BRAND_PRIORITY = -1;
    const MODE_DEFAULT = 'default';
    const MODE_CUSTOM = 'custom';
    const DEFAULT_SIZE = 24;

    // ───────────────────────────── 配置模型（纯函数） ─────────────────────────────
    function defaultSettings() {
      return { mode: MODE_DEFAULT, imageDataUrl: null, label: '' };
    }

    // 脏数据一律回落：未知 mode → default，非 data:image/* → null，非字符串 label → ''。
    function normalizeSettings(raw) {
      if (!raw || typeof raw !== 'object') return defaultSettings();
      const mode = raw.mode === MODE_CUSTOM ? MODE_CUSTOM : MODE_DEFAULT;
      const imageDataUrl = typeof raw.imageDataUrl === 'string' && /^data:image\//.test(raw.imageDataUrl)
        ? raw.imageDataUrl
        : null;
      const label = typeof raw.label === 'string' ? raw.label : '';
      return { mode: mode, imageDataUrl: imageDataUrl, label: label };
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
      const next = normalizeSettings(Object.assign({}, draft, { mode: mode }));
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
      const settings = store.get();
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
        }, 'HARNESS')
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

      function onSave() {
        const result = persistSettings(resolveStorage(), draft);
        if (!result.ok) { setNotice({ kind: 'error', text: result.error }); return; }
        store.set(result.settings);
        setNotice({ kind: 'ok', text: '已保存' });
      }

      return h('div', { className: 'logo-substitute-root', 'data-logo-substitute-root': 'true', 'data-logo-substitute-mode': mode },
        h('style', { dangerouslySetInnerHTML: { __html: STYLE } }),
        h('header', { className: 'logo-substitute-header' },
          h('h1', { className: 'logo-substitute-title' }, 'Logo替换'),
          h('p', { className: 'logo-substitute-subtitle' }, '替换侧边栏顶部品牌行的鲸鱼标志与 deepseek 字形。HARNESS 标记会保留。')
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

        return () => {
          unsubscribe();
          releaseBrands();
          if (typeof disposeSettings === 'function') disposeSettings();
        };
      }, 'logo-substitute: slots');

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
    };

    return {
      inject: ['slots'],
      apply: apply,
      __internals: __internals,
    };
  },
});
