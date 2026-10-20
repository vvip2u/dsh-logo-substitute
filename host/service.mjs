/** Host 服务获取：先走 ctx.get(name)（cordis 标准），再回落属性访问（老版本 ctx 直接挂服务）。 */
export function serviceOf(ctx, serviceName) {
  try {
    if (ctx && typeof ctx.get === 'function') return ctx.get(serviceName);
  } catch (err) { /* 服务未就绪 */ }
  try {
    return ctx ? ctx[serviceName] : undefined;
  } catch (err) {
    return undefined;
  }
}
