/**
 * 「充值余额」读取：与官方 设置→账号与余额 页走同一路 accountController.getBalance。
 * 只做取数 + 渲染，绝不自己算汇率/精度；渲染规则在 format.mjs。
 *
 * 只缓存 ready / failed（15s）。unavailable 表示服务还没就绪、signed-out 表示用户还没登录，
 * 这两种一律现取：用户刚登录就该立刻看到余额，而不是等一个过期窗口。
 */
import { formatBalance } from './format.mjs';
import { serviceOf } from './service.mjs';

const CACHE_TTL_MS = 15_000;
// 与 package.json 的 version 保持一致，仅用于标识调用方版本。
const PLUGIN_VERSION = '1.2.0';

export function buildBody(status, extra) {
  return Object.assign({
    ok: true,
    status,
    display: '',
    primaryCny: null,
    wallets: [],
    bonusWallets: [],
    fetchedAt: Date.now(),
  }, extra || {});
}

export function failedBody(error) {
  return buildBody('failed', { display: '--', error });
}

function errorText(err) {
  return err && err.message ? String(err.message) : String(err);
}

export function clientMeta() {
  return {
    version: PLUGIN_VERSION,
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

// primaryCny 只供阈值比较；空串/脏值算「没有可比的 CNY 钱包」。
function toNumber(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isSignedIn(state) {
  // 官方形状是 state.view.status；老版本/异形状态直接落到 state.status 上兜底。
  const status = state && state.view ? state.view.status : state && state.status;
  return status === 'credential-stored';
}

function readyBody(result) {
  const list = Array.isArray(result.value) ? result.value : [];
  const wallets = list.map((wallet) => {
    const currency = wallet && wallet.currency ? String(wallet.currency) : '';
    const amount = wallet && wallet.balance != null ? String(wallet.balance) : '0';
    return { currency, balance: amount, display: formatBalance(amount, currency) };
  });
  const cny = wallets.find((wallet) => wallet.currency === 'CNY');
  return buildBody('ready', {
    // 官方用 CSS ::before 拼 " + "，这里直接拼进字符串。
    display: wallets.map((wallet) => wallet.display).join(' + '),
    primaryCny: cny ? toNumber(cny.balance) : null,
    wallets,
    bonusWallets: Array.isArray(result.bonusWallets) ? result.bonusWallets : [],
  });
}

async function fetchBody(ctx) {
  const controller = serviceOf(ctx, 'accountController');
  if (!controller || typeof controller.getBalance !== 'function') return buildBody('unavailable');

  let state;
  try {
    state = typeof controller.getState === 'function' ? await controller.getState() : null;
  } catch (err) {
    // 连登录态都读不到，就不能假装是「未登录」——按失败处理，显示 "--"。
    return failedBody(errorText(err));
  }
  if (!isSignedIn(state)) return buildBody('signed-out');

  let result;
  try {
    result = await controller.getBalance(clientMeta());
  } catch (err) {
    return failedBody(errorText(err));
  }
  if (result == null) return buildBody('signed-out');
  if (result.status === 'ready') return readyBody(result);
  if (result.status === 'failed') return failedBody('balance-failed');
  return buildBody('unavailable');
}

export function createBalanceService(ctx, options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  let cached = null;

  async function read(force) {
    if (!force && cached && now() - cached.at < CACHE_TTL_MS) return cached.body;
    let body;
    try {
      body = await fetchBody(ctx);
    } catch (err) {
      // 契约要求路由一律 200 + JSON，所以这里把意外也收成 failed。
      body = failedBody(errorText(err));
    }
    const cacheable = body.status === 'ready' || body.status === 'failed';
    cached = cacheable ? { at: now(), body } : null;
    return body;
  }

  return { read };
}
