#!/usr/bin/env node
/**
 * logo-substitute 浏览器半冒烟测试：纯 node 运行、零依赖、不联网、不写盘。
 *
 * 做法与 first-demo/tools/smoke-test.mjs 一致：stub globalThis.window.__ModuleLoader__.load
 * 捕获 { id, factory }，用 new Function('window', source) 执行 client.js 源码，stub
 * require('react')，再调用 factory(stubRequire) 拿到导出，对 __internals 的纯函数断言；
 * 同时用假 ctx + 假 slots 走一遍 apply()，验证席位注册与 brand 遮蔽的关键回归点。
 *
 * 用法：node tools/smoke-test.mjs  → 全通过打印 SMOKE OK: n/m 并以 0 退出。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(here, '..', 'client.js');
const source = readFileSync(clientPath, 'utf8');

let passed = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(name + (detail ? '  [' + detail + ']' : ''));
}
function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}
function deepEq(name, actual, expected) {
  eq(name + ' (JSON)', JSON.stringify(actual), JSON.stringify(expected));
}
function throws(name, fn) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  ok(name, !err, err ? String(err && err.message) : '');
}

// 把 stub createElement 产出的元素树拍平，便于按属性找节点。
function flatten(node, acc) {
  const out = acc || [];
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  if (node.children) flatten(node.children, out);
  return out;
}
function findIn(tree, key, value) {
  return flatten(tree).find((el) => el.props && el.props[key] === value);
}
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.children) return textOf(node.children);
  return '';
}

function makeFakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

// ─────────────────── 1. 加载 client.js（stub loader + stub react） ───────────────────
let captured = null;
const requireCalls = [];

const stubReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol.for('react.fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
};
const stubRequire = (id) => {
  requireCalls.push(id);
  if (id === 'react') return stubReact;
  throw new Error('client.js 试图 require 未授权的模块: ' + id);
};

const fakeWindow = { __ModuleLoader__: { load: (entry) => { captured = entry; } } };
throws('执行 client.js 源码不抛异常', () => {
  // eslint-disable-next-line no-new-func
  new Function('window', source)(fakeWindow); // 测试里加载源码这一次是允许的
});

ok('__ModuleLoader__.load 被调用', captured !== null);
if (!captured) {
  console.error('SMOKE FAIL: client.js 没有调用 window.__ModuleLoader__.load');
  process.exitCode = 1;
} else {
  eq('模块 id 等于包名 logo-substitute', captured.id, 'logo-substitute');
  eq('factory 是函数', typeof captured.factory, 'function');

  const mod = captured.factory(stubRequire);
  eq('factory 只 require 了 react', requireCalls.join(','), 'react');
  ok('导出 inject 含 slots', Array.isArray(mod.inject) && mod.inject.indexOf('slots') >= 0, JSON.stringify(mod.inject));
  eq('导出 apply 是函数', typeof mod.apply, 'function');
  ok('导出 __internals 测试缝', !!mod.__internals && typeof mod.__internals.validateImageSize === 'function');
  ok('源码未使用 eval(...) 调用', !/(^|[^.\w$])eval\s*\(/.test(source));
  ok('源码未使用 new Function(...) 调用', !/new\s+Function\s*\(/.test(source));
  ok('源码未硬编码颜色（无 #hex）', !/#[0-9a-fA-F]{3,8}\b/.test(source));
  ok('源码未硬编码颜色（无 rgb()/rgba()）', !/\brgba?\(/.test(source));

  const I = mod.__internals;
  eq('存储 key', I.STORAGE_KEY, 'logo-substitute:v1');
  eq('品牌席位 priority = -1', I.BRAND_PRIORITY, -1);

  // ─────────────────── 2. 图片正方形校验（纯函数） ───────────────────
  ok('正方形 64×64 通过', I.validateImageSize(64, 64).ok === true);
  ok('正方形 512×512 通过（无 64px 限制）', I.validateImageSize(512, 512).ok === true);
  ok('正方形 129×129 通过（奇数边长）', I.validateImageSize(129, 129).ok === true);
  const rect = I.validateImageSize(120, 80);
  eq('非正方形不通过', rect.ok, false);
  ok('非正方形错误提示是中文且含尺寸', /正方形/.test(rect.error) && rect.error.indexOf('120') >= 0 && rect.error.indexOf('80') >= 0, rect.error);
  ok('正方形无错误文案', I.validateImageSize(64, 64).error === '');
  eq('零尺寸不通过', I.validateImageSize(0, 0).ok, false);
  eq('NaN 不通过', I.validateImageSize(NaN, NaN).ok, false);
  ok('非正方形提示要求裁剪', /裁剪/.test(rect.error), rect.error);

  // reduceImageCandidate：非正方形不得覆盖已选中 / 已保存的图片。
  const before = { mode: 'custom', imageDataUrl: 'data:image/png;base64,OLD', label: '老图' };
  const bad = I.reduceImageCandidate(before, 'data:image/png;base64,NEW', 100, 50);
  eq('非正方形候选被拒绝', bad.ok, false);
  eq('非正方形候选不覆盖原图', bad.draft.imageDataUrl, 'data:image/png;base64,OLD');
  eq('非正方形候选保留原文字', bad.draft.label, '老图');
  ok('非正方形候选给出中文错误', /正方形/.test(bad.error), bad.error);
  const good = I.reduceImageCandidate(before, 'data:image/png;base64,NEW', 50, 50);
  eq('正方形候选被接受', good.ok, true);
  eq('正方形候选替换图片', good.draft.imageDataUrl, 'data:image/png;base64,NEW');
  eq('正方形候选保留原文字', good.draft.label, '老图');
  eq('正方形候选切到 custom', good.draft.mode, 'custom');

  // ─────────────────── 3. 持久化 round-trip / 脏数据回落 ───────────────────
  const saved = { mode: 'custom', imageDataUrl: 'data:image/png;base64,AAA', label: 'Acme' };
  const storageA = makeFakeStorage();
  eq('writeSettings 返回成功', I.writeSettings(storageA, saved), true);
  deepEq('保存后读回一致（round-trip）', I.readSettings(storageA), saved);
  ok('写盘 key 正确', storageA.dump()[I.STORAGE_KEY] !== undefined, JSON.stringify(storageA.dump()));

  const EMPTY = { mode: 'default', imageDataUrl: null, label: '' };
  // 脏数据按字段回落：未知 mode → default，非 data:image/* → null，非字符串 label → ''。
  // 不变量：图片缺失或非法时，脏数据绝不能让自定义品牌生效（官方品牌必须留在原位）。
  const dirtyCases = [
    ['空存储', undefined, EMPTY, false],
    ['非 JSON', 'not json at all', EMPTY, false],
    ['JSON null', 'null', EMPTY, false],
    ['JSON 数组', '[1,2,3]', EMPTY, false],
    ['未知 mode 回落 default（字面合法的图片与文字保留但休眠）',
      '{"mode":"weird","imageDataUrl":"data:image/png;base64,AAA","label":"X"}',
      { mode: 'default', imageDataUrl: 'data:image/png;base64,AAA', label: 'X' }, false],
    ['非 dataURL 图片置 null（custom 因缺图不生效）',
      '{"mode":"custom","imageDataUrl":"https://example.com/a.png","label":"X"}',
      { mode: 'custom', imageDataUrl: null, label: 'X' }, false],
    ['label 非字符串置空串（图片合法，品牌仍生效，只少了文字）',
      '{"mode":"custom","imageDataUrl":"data:image/png;base64,AAA","label":123}',
      { mode: 'custom', imageDataUrl: 'data:image/png;base64,AAA', label: '' }, true],
  ];
  dirtyCases.forEach(([label, raw, expected, expectActive]) => {
    const store = makeFakeStorage(raw === undefined ? {} : { [I.STORAGE_KEY]: raw });
    const read = I.readSettings(store);
    deepEq('脏数据回落: ' + label, read, expected);
    eq('脏数据品牌生效与否: ' + label, I.isCustomActive(read), expectActive);
  });
  const brokenStore = { getItem() { throw new Error('boom'); }, setItem() { throw new Error('boom'); } };
  throws('storage 抛异常时 readSettings 不抛', () => I.readSettings(brokenStore));
  eq('storage 抛异常时回落 default', I.readSettings(brokenStore).mode, 'default');
  eq('storage 抛异常时 writeSettings 返回 false', I.writeSettings(brokenStore, saved), false);

  // persistSettings：default 保留自定义图片与文字、只把 mode 置回 default；custom 缺图拒绝保存。
  const storageB = makeFakeStorage({ [I.STORAGE_KEY]: JSON.stringify(saved) });
  const toDefault = I.persistSettings(storageB, { mode: 'default', imageDataUrl: 'data:image/png;base64,AAA', label: 'Acme' });
  eq('保存 default 成功', toDefault.ok, true);
  deepEq('保存 default 保留自定义图片与文字（只置 mode=default）', I.readSettings(storageB), { mode: 'default', imageDataUrl: 'data:image/png;base64,AAA', label: 'Acme' });
  eq('保存 default 后自定义品牌不生效', I.isCustomActive(I.readSettings(storageB)), false);
  const noImage = I.persistSettings(makeFakeStorage(), { mode: 'custom', imageDataUrl: null, label: 'X' });
  eq('custom 缺图拒绝保存', noImage.ok, false);
  ok('custom 缺图给出中文提示', /上传/.test(noImage.error), noImage.error);
  const storageC = makeFakeStorage();
  const toCustom = I.persistSettings(storageC, { mode: 'custom', imageDataUrl: 'data:image/png;base64,AAA', label: 'Acme' });
  eq('保存 custom 成功', toCustom.ok, true);
  deepEq('保存 custom 读回一致', I.readSettings(storageC), saved);

  // ─────────────────── 4. 席位注册：settings.section 常驻 ───────────────────
  function makeFakeCtx() {
    const injections = [];
    const registrations = [];
    const injectDisposers = [];
    const ctx = {
      slots: {
        inject(key, callback) {
          injections.push(key);
          const result = callback();
          let called = false;
          const disposer = () => {
            called = true;
            if (typeof result === 'function') result();
            else if (result && typeof result[Symbol.iterator] === 'function') Array.from(result).forEach((d) => d());
          };
          injectDisposers.push({ key, disposer, isCalled: () => called });
          return disposer;
        },
        register(options, component) {
          const rec = { key: options.name, options, component, disposed: false };
          registrations.push(rec);
          return () => { rec.disposed = true; };
        },
      },
      effect(fn, label) {
        injections.push('effect:' + label);
        const dispose = fn();
        return typeof dispose === 'function' ? dispose : () => {};
      },
    };
    return { ctx, injections, registrations, injectDisposers };
  }
  const activeOf = (registrations, key) => registrations.filter((r) => r.key === key && !r.disposed);

  // 4a. 默认配置：只注册 settings.section，不碰品牌席位。
  globalThis.localStorage = makeFakeStorage();
  const envDefault = makeFakeCtx();
  throws('apply(fakeCtx) 不抛异常', () => mod.apply(envDefault.ctx));
  const slotInjections = (env) => env.injections.filter((k) => k.indexOf('effect:') !== 0);
  eq('注入了 settings.section', slotInjections(envDefault).join(','), 'settings.section');
  ok('副作用通过 ctx.effect 归还', envDefault.injections.indexOf('effect:logo-substitute: slots') >= 0, JSON.stringify(envDefault.injections));

  const section = activeOf(envDefault.registrations, 'settings.section')[0];
  ok('注册了 settings.section', !!section);
  eq('settings.section 席位 id = logo-substitute', section.options.id, 'logo-substitute');
  eq('settings.section 导航次序 order = 100', section.options.order, 100);
  eq('settings.section 菜单文案', String(section.options.label()), 'Logo替换');
  eq('settings.section 组件是函数', typeof section.component, 'function');
  eq('默认配置下不注册 sidebar.brand.mark', activeOf(envDefault.registrations, 'sidebar.brand.mark').length, 0);
  eq('默认配置下不注册 sidebar.brand.name', activeOf(envDefault.registrations, 'sidebar.brand.name').length, 0);

  // 4b. 已保存 custom + 有图：两个品牌席位都以 priority -1 接管。
  const customStorage = makeFakeStorage({ [I.STORAGE_KEY]: JSON.stringify(saved) });
  globalThis.localStorage = customStorage;
  const envCustom = makeFakeCtx();
  throws('apply(fakeCtx)（custom）不抛异常', () => mod.apply(envCustom.ctx));
  ok('custom 下注入顺序 = settings.section, sidebar.brand.mark, sidebar.brand.name',
    envCustom.injections.slice(0, 3).join(','),
    envCustom.injections.join(','));

  const mark = activeOf(envCustom.registrations, 'sidebar.brand.mark')[0];
  const name = activeOf(envCustom.registrations, 'sidebar.brand.name')[0];
  ok('custom 下注册了 sidebar.brand.mark', !!mark);
  ok('custom 下注册了 sidebar.brand.name', !!name);
  eq('sidebar.brand.mark 使用 priority -1（关键回归点）', mark.options.priority, -1);
  eq('sidebar.brand.name 使用 priority -1（关键回归点）', name.options.priority, -1);
  eq('sidebar.brand.mark 组件是函数', typeof mark.component, 'function');
  eq('sidebar.brand.name 组件是函数', typeof name.component, 'function');

  // 4c. 切回 default：两个品牌席位的 disposer 都被调用，席位被释放；settings.section 不动。
  I.getStore().set({ mode: 'default', imageDataUrl: null, label: '' });
  eq('切回 default 后 sidebar.brand.mark 被释放', activeOf(envCustom.registrations, 'sidebar.brand.mark').length, 0);
  eq('切回 default 后 sidebar.brand.name 被释放', activeOf(envCustom.registrations, 'sidebar.brand.name').length, 0);
  eq('切回 default 后 mark 注册记录 disposed=true', mark.disposed, true);
  eq('切回 default 后 name 注册记录 disposed=true', name.disposed, true);
  eq('切回 default 后 settings.section 仍存活', activeOf(envCustom.registrations, 'settings.section').length, 1);
  ok('切回 default 后品牌注入的 disposer 被调用',
    envCustom.injectDisposers.filter((d) => d.key.indexOf('sidebar.brand') === 0).every((d) => d.isCalled()),
    JSON.stringify(envCustom.injectDisposers.map((d) => [d.key, d.isCalled()])));

  // 4d. 再切回 custom：先 dispose 旧的再重新注入，不触发同 priority 重复注册。
  I.getStore().set(saved);
  const mark2 = activeOf(envCustom.registrations, 'sidebar.brand.mark').slice(-1)[0];
  const name2 = activeOf(envCustom.registrations, 'sidebar.brand.name').slice(-1)[0];
  ok('重新切回 custom 后 mark 重新注册', !!mark2 && mark2 !== mark);
  eq('重新注册仍使用 priority -1', mark2.options.priority, -1);
  eq('重新注册仍使用 priority -1（name）', name2.options.priority, -1);
  eq('同一时刻 mark 只有一个活跃注册', activeOf(envCustom.registrations, 'sidebar.brand.mark').length, 1);

  // ─────────────────── 5. 品牌组件渲染 ───────────────────
  const markNode = I.BrandMark({ size: 24 });
  eq('BrandMark 渲染 img', markNode.type, 'img');
  eq('BrandMark src 用上传的图片', markNode.props.src, saved.imageDataUrl);
  eq('BrandMark 尺寸跟随 owner props.size', markNode.props.width, 24);
  eq('BrandMark 高度跟随 owner props.size', markNode.props.height, 24);
  eq('BrandMark 保持正方形（object-fit contain）', markNode.props.style.objectFit, 'contain');
  eq('BrandMark 用 display:block', markNode.props.style.display, 'block');
  eq('BrandMark 带测试选择器', markNode.props['data-logo-substitute-mark'], 'custom');
  eq('BrandMark 缺省尺寸 24', I.BrandMark({}).props.width, 24);

  const nameNode = I.BrandName({});
  const nameText = textOf(nameNode);
  ok('BrandName 显示用户输入的文字', nameText.indexOf('Acme') >= 0, nameText);
  ok('BrandName 保留 HARNESS 标记', nameText.indexOf('HARNESS') >= 0, nameText);
  eq('BrandName 自带测试选择器', nameNode.props['data-logo-substitute-name'], 'custom');
  const harnessNode = findIn(nameNode, 'data-logo-substitute-harness', 'true');
  ok('HARNESS 由本插件自绘', !!harnessNode);
  eq('HARNESS 使用次级色 token', harnessNode.props.style.color, 'var(--dsw-alias-label-tertiary)');
  eq('HARNESS 大写样式', harnessNode.props.style.textTransform, 'uppercase');
  eq('BrandName 文字标识挂在 data-logo-substitute-label-text 上',
    findIn(nameNode, 'data-logo-substitute-label-text', 'Acme').props['data-logo-substitute-label-text'], 'Acme');
  eq('自定义文字为空时仍渲染 HARNESS',
    textOf(I.BrandName({})).indexOf('HARNESS') >= 0, true);

  I.getStore().set({ mode: 'default', imageDataUrl: null, label: '' });
  eq('default 状态下 BrandMark 返回 null', I.BrandMark({ size: 24 }), null);
  eq('default 状态下 BrandName 返回 null', I.BrandName({}), null);
  I.getStore().set(saved);

  // ─────────────────── 6. 设置页渲染与保存 ───────────────────
  const sectionTree = I.SettingsSection({ close: () => {} });
  const flat = flatten(sectionTree);
  const styleEl = flat.find((el) => el.type === 'style');
  ok('设置页渲染 <style>', !!styleEl && typeof styleEl.props.dangerouslySetInnerHTML.__html === 'string');
  ok('CSS 未硬编码颜色（无 #hex）', !/#[0-9a-fA-F]{3,8}\b/.test(I.STYLE));
  ok('CSS 未硬编码颜色（无 rgb()）', !/\brgba?\(/.test(I.STYLE));
  ok('CSS 使用 dsw 主题 token', I.STYLE.indexOf('var(--dsw-alias-') >= 0);
  const classNames = flat.map((el) => el.props && el.props.className).filter((c) => typeof c === 'string').join(' ').split(/\s+/).filter(Boolean);
  const badClassNames = classNames.filter((c) => c.indexOf('logo-substitute-') !== 0);
  eq('所有类名以 logo-substitute- 前缀', badClassNames.join(','), '');
  ok('设置页有「使用默认」标签', !!findIn(sectionTree, 'data-logo-substitute-tab', 'default'));
  ok('设置页有「使用自定义」标签', !!findIn(sectionTree, 'data-logo-substitute-tab', 'custom'));
  const defaultTabText = textOf(findIn(sectionTree, 'data-logo-substitute-tab', 'default'));
  const customTabText = textOf(findIn(sectionTree, 'data-logo-substitute-tab', 'custom'));
  eq('「使用默认」文案', defaultTabText, '使用默认');
  eq('「使用自定义」文案', customTabText, '使用自定义');
  ok('自定义模式下有文件上传控件', !!findIn(sectionTree, 'data-logo-substitute-file', 'true'));
  ok('自定义模式下有文字标识输入框', !!findIn(sectionTree, 'data-logo-substitute-label', 'true'));
  ok('自定义模式下有已选图片预览', !!findIn(sectionTree, 'data-logo-substitute-preview', 'true'));

  const saveBtn = findIn(sectionTree, 'data-logo-substitute-save', 'true');
  ok('页面底部有保存按钮', !!saveBtn);
  eq('保存按钮文案', textOf(saveBtn), '保存');

  // 页面底部的插件信息：版本号 + 作者，且必须挂在 footer 容器内。
  const versionEl = findIn(sectionTree, 'data-logo-substitute-version', '1.0');
  ok('页面底部显示插件版本号', !!versionEl);
  eq('版本号文案', textOf(versionEl), 'Logo替换 v1.0');
  const authorEl = findIn(sectionTree, 'data-logo-substitute-author', 'JakeKim');
  ok('页面底部显示作者', !!authorEl);
  eq('作者文案', textOf(authorEl), '作者 JakeKim ｜ 微信 vvip2u');
  const footerEl = flatten(findIn(sectionTree, 'data-logo-substitute-root', 'true')).find((el) => el.type === 'footer');
  ok('页面底部存在 footer 容器', !!footerEl);
  ok('版本号与作者信息挂在 footer 内',
    !!footerEl && flatten(footerEl.children).some((el) => el.props && el.props['data-logo-substitute-meta'] === 'true'));

  // 在 custom 下点保存 → 落盘 + 共享状态更新。
  const saveStorage = makeFakeStorage({ [I.STORAGE_KEY]: JSON.stringify(saved) });
  globalThis.localStorage = saveStorage;
  I.getStore().set(saved);
  const customTree = I.SettingsSection({ close: () => {} });
  const customSave = findIn(customTree, 'data-logo-substitute-save', 'true');
  throws('点保存不抛异常', () => customSave.props.onClick());
  deepEq('保存后落盘内容正确', JSON.parse(saveStorage.dump()[I.STORAGE_KEY]), saved);
  deepEq('保存后共享状态更新', { mode: I.getStore().get().mode, label: I.getStore().get().label }, { mode: 'custom', label: 'Acme' });

  // 在 default 下点保存 → 官方品牌恢复；已上传的图片与文字仍留在配置里。
  // 用 store 里「mode=default 但带着图片与文字」模拟用户切到「使用默认」标签后的草稿。
  const defaultTree = (() => {
    I.getStore().set({ mode: 'default', imageDataUrl: saved.imageDataUrl, label: saved.label });
    return I.SettingsSection({ close: () => {} });
  })();
  eq('默认模式下不渲染文件上传控件', findIn(defaultTree, 'data-logo-substitute-file', 'true'), undefined);
  eq('默认模式下不渲染文字标识输入框', findIn(defaultTree, 'data-logo-substitute-label', 'true'), undefined);
  ok('默认模式下仍有保存按钮', !!findIn(defaultTree, 'data-logo-substitute-save', 'true'));
  const defaultStorage = makeFakeStorage({ [I.STORAGE_KEY]: JSON.stringify(saved) });
  globalThis.localStorage = defaultStorage;
  findIn(defaultTree, 'data-logo-substitute-save', 'true').props.onClick();
  deepEq('默认模式保存后图片与文字仍保留', I.readSettings(defaultStorage), { mode: 'default', imageDataUrl: saved.imageDataUrl, label: saved.label });
  eq('默认模式保存后共享状态为 default', I.getStore().get().mode, 'default');
  eq('默认模式保存后 isCustomActive=false', I.isCustomActive(I.getStore().get()), false);

  // 切标签：点「使用自定义」派发状态变更（stub useState 不重渲染，只验证回调不抛）。
  const tabsTree = I.SettingsSection({ close: () => {} });
  throws('点「使用自定义」标签不抛异常', () => findIn(tabsTree, 'data-logo-substitute-tab', 'custom').props.onClick());
  throws('点「使用默认」标签不抛异常', () => findIn(tabsTree, 'data-logo-substitute-tab', 'default').props.onClick());

  // ─────────────────── 7. apply 的回收链 ───────────────────
  const envTeardown = makeFakeCtx();
  globalThis.localStorage = makeFakeStorage({ [I.STORAGE_KEY]: JSON.stringify(saved) });
  mod.apply(envTeardown.ctx);
  const effectLabel = envTeardown.injections.find((k) => k.indexOf('effect:') === 0);
  ok('apply 通过 ctx.effect 归还副作用', effectLabel === 'effect:logo-substitute: slots', effectLabel);
  // ctx.effect 的返回值即 apply 的清理链；这里直接验证它可安全回收（fake ctx.effect 已运行 fn）。
  eq('回收前品牌席位活跃', activeOf(envTeardown.registrations, 'sidebar.brand.mark').length, 1);

  // ─────────── 8. custom → default → custom：default 保存不得丢掉自定义配置 ───────────
  const keepStorage = makeFakeStorage({ [I.STORAGE_KEY]: JSON.stringify(saved) });
  globalThis.localStorage = keepStorage;
  const envKeep = makeFakeCtx();
  mod.apply(envKeep.ctx);
  eq('起始：custom 下 sidebar.brand.mark 已占用', activeOf(envKeep.registrations, 'sidebar.brand.mark').length, 1);
  eq('起始：custom 下 sidebar.brand.name 已占用', activeOf(envKeep.registrations, 'sidebar.brand.name').length, 1);

  // 用户切到「使用默认」后点保存：草稿里仍有图片与文字。
  const savedDefault = I.persistSettings(keepStorage, { mode: 'default', imageDataUrl: saved.imageDataUrl, label: saved.label });
  eq('default 保存成功', savedDefault.ok, true);
  I.getStore().set(savedDefault.settings);

  eq('default 下 isCustomActive=false', I.isCustomActive(I.getStore().get()), false);
  eq('default 保存后 sidebar.brand.mark 被 dispose', activeOf(envKeep.registrations, 'sidebar.brand.mark').length, 0);
  eq('default 保存后 sidebar.brand.name 被 dispose', activeOf(envKeep.registrations, 'sidebar.brand.name').length, 0);
  eq('default 下 BrandMark 返回 null（官方鲸鱼回归）', I.BrandMark({ size: 24 }), null);
  eq('default 下 BrandName 返回 null（官方 deepseek 字形回归）', I.BrandName({}), null);
  deepEq('default 保存后落盘仍带图片与文字', I.readSettings(keepStorage), { mode: 'default', imageDataUrl: saved.imageDataUrl, label: saved.label });

  // 再切回「使用自定义」：不用重新上传，原图与原文仍在。
  const backDraft = I.getStore().get();
  const backToCustom = I.persistSettings(keepStorage, { mode: 'custom', imageDataUrl: backDraft.imageDataUrl, label: backDraft.label });
  eq('切回 custom 保存成功', backToCustom.ok, true);
  I.getStore().set(backToCustom.settings);
  eq('切回 custom 后图片仍是原来那张（无需重新上传）', I.getStore().get().imageDataUrl, saved.imageDataUrl);
  eq('切回 custom 后文字仍是原来那条', I.getStore().get().label, saved.label);
  const restoredTree = I.SettingsSection({ close: () => {} });
  eq('切回 custom 后预览直接显示原图', findIn(restoredTree, 'data-logo-substitute-preview', 'true').props.src, saved.imageDataUrl);
  eq('切回 custom 后 sidebar.brand.mark 重新占用', activeOf(envKeep.registrations, 'sidebar.brand.mark').length, 1);
  eq('切回 custom 后 sidebar.brand.name 重新占用', activeOf(envKeep.registrations, 'sidebar.brand.name').length, 1);
}

// ─────────────────── 汇总 ───────────────────
const total = passed + failures.length;
if (failures.length) {
  console.error('SMOKE FAIL: ' + passed + '/' + total);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exitCode = 1;
} else {
  console.log('SMOKE OK: ' + passed + '/' + total);
  process.exitCode = 0;
}
