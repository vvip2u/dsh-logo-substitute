/**
 * Host 半的零依赖测试：只跑 format / balance / routes，不联网、不写盘、不碰 ~。
 * 运行：node --test tools/host-test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBalance, addCommas } from '../host/format.mjs';
import { createBalanceService } from '../host/balance.mjs';
import { registerRoutes, createBalanceHandler, ROUTE_PATHS } from '../host/routes.mjs';

const SIGNED_IN = { view: { status: 'credential-stored' } };

/** 假 ctx：只实现 cordis 的 ctx.get，用来注入 accountController / webServer。 */
function fakeCtx(services) {
  return { get: (name) => (services || {})[name] };
}

/** 假 res：只实现路由真正会用的两个成员。 */
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) { this.body = chunk; },
  };
}

async function callHandler(service, url) {
  const res = fakeRes();
  await createBalanceHandler(service)({ url }, res);
  return { res, body: JSON.parse(res.body) };
}

test('formatBalance 逐字复刻官方口径', () => {
  assert.equal(formatBalance('0', 'CNY'), '¥0.00');
  assert.equal(formatBalance('0.0001', 'CNY'), '<¥0.01');
  assert.equal(formatBalance('12.346', 'CNY'), '¥12.34');
  // 向下截断而非四舍五入：Number 路径会给出 12.35
  assert.equal(formatBalance('12.345', 'CNY'), '¥12.34');
  assert.equal(formatBalance('1234567.891', 'CNY'), '¥1,234,567.89');
  assert.equal(formatBalance('-0.005', 'CNY'), '-¥0.01');
  assert.equal(formatBalance('-0.01', 'CNY'), '-¥0.01');
  assert.equal(formatBalance('12.34', 'USD'), '$12.34');
  assert.equal(formatBalance('12.34', 'EUR'), '$12.34');
  assert.equal(formatBalance('0.01', 'CNY'), '¥0.01');
  assert.equal(formatBalance('5', 'CNY'), '¥5.00');
});

// 官方负数分支走 big.js toFixed（默认 RM=1 → half-up），与正数的 roundDown 刻意不对称。
test('formatBalance 负数分支是四舍五入（half-up），不是截断', () => {
  assert.equal(formatBalance('-12.345', 'CNY'), '-¥12.35');
  assert.equal(formatBalance('-0.999', 'CNY'), '-¥1.00');
  assert.equal(formatBalance('-1.005', 'CNY'), '-¥1.01');
  assert.equal(formatBalance('-12.344', 'CNY'), '-¥12.34');
  assert.equal(formatBalance('-12.005', 'CNY'), '-¥12.01');
  assert.equal(formatBalance('-0.994', 'CNY'), '-¥0.99');
  // 进位连锁到整数位，再走千分位
  assert.equal(formatBalance('-9.999', 'CNY'), '-¥10.00');
  assert.equal(formatBalance('-999.999', 'CNY'), '-¥1,000.00');
  // 正数绝不能跟着变成四舍五入
  assert.equal(formatBalance('12.345', 'CNY'), '¥12.34');
  assert.equal(formatBalance('12.346', 'CNY'), '¥12.34');
});

test('addCommas 整数位千分位 + 两位小数（截断）', () => {
  assert.equal(addCommas('1234567.891'), '1,234,567.89');
  assert.equal(addCommas('999'), '999.00');
  assert.equal(addCommas('1000'), '1,000.00');
  assert.equal(addCommas('0.009'), '0.00');
});

test('ready：渲染 display / wallets / bonusWallets / primaryCny', async () => {
  const service = createBalanceService(fakeCtx({
    accountController: {
      getState: async () => SIGNED_IN,
      getBalance: async () => ({
        status: 'ready',
        value: [{ currency: 'CNY', balance: '12.345' }, { currency: 'USD', balance: '1.5' }],
        bonusWallets: [{ currency: 'CNY', balance: '9.99' }],
      }),
    },
  }));
  const { res, body } = await callHandler(service, '/plugins/dsh-logo-substitute/balance');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(body.ok, true);
  assert.equal(body.status, 'ready');
  assert.equal(body.display, '¥12.34 + $1.50');
  assert.equal(body.primaryCny, 12.345);
  assert.deepEqual(body.wallets, [
    { currency: 'CNY', balance: '12.345', display: '¥12.34' },
    { currency: 'USD', balance: '1.5', display: '$1.50' },
  ]);
  assert.deepEqual(body.bonusWallets, [{ currency: 'CNY', balance: '9.99' }]);
  assert.equal(typeof body.fetchedAt, 'number');
});

test('ready 且没有 CNY 钱包：primaryCny 为 null', async () => {
  const service = createBalanceService(fakeCtx({
    accountController: {
      getState: async () => SIGNED_IN,
      getBalance: async () => ({ status: 'ready', value: [{ currency: 'USD', balance: '3' }] }),
    },
  }));
  const { body } = await callHandler(service, '/x');
  assert.equal(body.display, '$3.00');
  assert.equal(body.primaryCny, null);
  assert.deepEqual(body.bonusWallets, []);
});

test('signed-out：getState 未登录，且不调用 getBalance', async () => {
  let balanceCalls = 0;
  const service = createBalanceService(fakeCtx({
    accountController: {
      getState: async () => ({ view: { status: 'signed-out' } }),
      getBalance: async () => { balanceCalls += 1; return null; },
    },
  }));
  const { res, body } = await callHandler(service, '/x');
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'signed-out');
  assert.equal(body.display, '');
  assert.equal(balanceCalls, 0);
});

test('getBalance 返回 null（授权缺失/变更）→ signed-out', async () => {
  const service = createBalanceService(fakeCtx({
    accountController: { getState: async () => SIGNED_IN, getBalance: async () => null },
  }));
  const { body } = await callHandler(service, '/x');
  assert.equal(body.status, 'signed-out');
  assert.equal(body.display, '');
});

test('failed：getBalance 返回 { status: "failed" }', async () => {
  const service = createBalanceService(fakeCtx({
    accountController: { getState: async () => SIGNED_IN, getBalance: async () => ({ status: 'failed' }) },
  }));
  const { res, body } = await callHandler(service, '/x');
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, 'failed');
  assert.equal(body.display, '--');
  assert.equal(typeof body.error, 'string');
});

test('failed：getBalance 抛错', async () => {
  const service = createBalanceService(fakeCtx({
    accountController: {
      getState: async () => SIGNED_IN,
      getBalance: async () => { throw new Error('network down'); },
    },
  }));
  const { res, body } = await callHandler(service, '/x');
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, 'failed');
  assert.equal(body.display, '--');
  assert.equal(body.error, 'network down');
});

test('unavailable：accountController 完全缺失', async () => {
  const service = createBalanceService(fakeCtx({}));
  const { res, body } = await callHandler(service, '/x');
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'unavailable');
  assert.equal(body.display, '');
  assert.equal(body.primaryCny, null);
  assert.deepEqual(body.wallets, []);
  assert.deepEqual(body.bonusWallets, []);
});

test('缓存 15s 命中，?force=1 绕过', async () => {
  let calls = 0;
  const service = createBalanceService(fakeCtx({
    accountController: {
      getState: async () => SIGNED_IN,
      getBalance: async () => { calls += 1; return { status: 'ready', value: [{ currency: 'CNY', balance: String(calls) }] }; },
    },
  }));
  const first = await callHandler(service, '/plugins/dsh-logo-substitute/balance');
  const second = await callHandler(service, '/plugins/dsh-logo-substitute/balance');
  assert.equal(calls, 1);
  assert.equal(second.body.fetchedAt, first.body.fetchedAt);
  assert.equal(second.body.display, first.body.display);

  const forced = await callHandler(service, '/plugins/dsh-logo-substitute/balance?force=1');
  assert.equal(calls, 2);
  assert.equal(forced.body.display, '¥2.00');
});

test('缓存按 15s TTL 过期（注入可控时钟）', async () => {
  let clock = 1000;
  let calls = 0;
  const service = createBalanceService(fakeCtx({
    accountController: {
      getState: async () => SIGNED_IN,
      getBalance: async () => { calls += 1; return { status: 'ready', value: [{ currency: 'CNY', balance: '1' }] }; },
    },
  }), { now: () => clock });

  await service.read(false);
  clock += 14_999;
  await service.read(false);
  assert.equal(calls, 1);
  clock += 1;
  await service.read(false);
  assert.equal(calls, 2);
});

test('routes：缺 webServer 时返回 [] 而不是抛错', () => {
  assert.deepEqual(registerRoutes(fakeCtx({})), []);
  assert.deepEqual(registerRoutes(fakeCtx({ webServer: {} })), []);
});

test('routes：注册 exact 路由并返回 disposer', async () => {
  const registered = [];
  let disposed = 0;
  const webServer = {
    register(route) {
      registered.push(route);
      return () => { disposed += 1; };
    },
  };
  const ctx = fakeCtx({
    webServer,
    accountController: {
      getState: async () => SIGNED_IN,
      getBalance: async () => ({ status: 'ready', value: [{ currency: 'CNY', balance: '7.5' }] }),
    },
  });

  const disposers = registerRoutes(ctx);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].kind, 'exact');
  assert.equal(registered[0].path, ROUTE_PATHS.balance);
  assert.equal(ROUTE_PATHS.balance, '/plugins/dsh-logo-substitute/balance');
  assert.equal(disposers.length, 1);

  const res = fakeRes();
  await registered[0].handler({ url: ROUTE_PATHS.balance }, res);
  assert.equal(JSON.parse(res.body).display, '¥7.50');

  disposers[0]();
  assert.equal(disposed, 1);
});
