/**
 * Host 侧路由：GET /plugins/dsh-logo-substitute/balance
 *
 * 形态对照 dsh-plugin-ledger/host/routes.mjs：webServer.register({ kind, path, handler })
 * 返回 disposer；handler 是 Node 的 (req, res)。缺 webServer 时返回 [] 而不是抛错，
 * 让插件在没有 Web GUI 的宿主里也能正常装载。
 */
import { createBalanceService } from './balance.mjs';
import { serviceOf } from './service.mjs';

export const ROUTE_PATHS = { balance: '/plugins/dsh-logo-substitute/balance' };

function sendJson(res, payload) {
  res.statusCode = 200;
  try {
    if (typeof res.setHeader === 'function') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
    }
  } catch (err) { /* 假 res（测试）可能没有 setHeader */ }
  res.end(JSON.stringify(payload));
}

export function createBalanceHandler(service) {
  return async function balanceHandler(req, res) {
    const url = req && typeof req.url === 'string' ? req.url : '';
    const force = /[?&]force=1(?:&|$)/.test(url);
    const body = await service.read(force);
    sendJson(res, body);
  };
}

export function registerRoutes(ctx) {
  const webServer = serviceOf(ctx, 'webServer');
  if (!webServer || typeof webServer.register !== 'function') return [];

  const service = createBalanceService(ctx);
  const disposers = [];
  Object.entries(ROUTE_PATHS).forEach(([key, path]) => {
    try {
      const dispose = webServer.register({
        kind: 'exact',
        path,
        handler: key === 'balance' ? createBalanceHandler(service) : undefined,
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (err) { /* 单条路由注册失败不影响其它能力 */ }
  });
  return disposers;
}
