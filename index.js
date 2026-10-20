/**
 * dsh-logo-substitute —— 宿主半入口。
 *
 * 契约对照 dsh-plugin-ledger/index.js：export { name, inject, apply }，所有注册都包在
 * ctx.effect(() => …, '标签') 里，任一能力缺失就优雅退化，不抛异常。
 *
 * inject 只声明 webServer：accountController 属于官方账号服务，若它不在就绪集合里，
 * 写进 inject 会让整个插件卡在 pending/failed —— 反而连 UI 都加载不出来。
 * 因此它只在路由 handler 内部按需取用，取不到就降级成 status="unavailable"。
 */
import { registerRoutes } from './host/routes.mjs';

export const name = 'dsh-logo-substitute';

export const inject = ['webServer'];

export function apply(ctx) {
  if (!ctx || typeof ctx.effect !== 'function') return;

  ctx.effect(() => {
    const disposers = registerRoutes(ctx);
    return () => {
      disposers.forEach((dispose) => {
        try { dispose(); } catch (err) { /* 单条路由释放失败不影响其它 */ }
      });
    };
  }, 'dsh-logo-substitute: balance route');
}
