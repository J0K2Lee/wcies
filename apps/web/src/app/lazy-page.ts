import { ComponentType, LazyExoticComponent, lazy } from 'react';

/**
 * Route-level code splitting helper (S1-1, 2026-10-17 体检报告 §4.3).
 *
 * 全站页面都是**命名导出**（`export function OrdersPage()`），而 `React.lazy`
 * 要求模块默认导出一个组件，所以这里统一把「动态 import + 取命名导出」包一层，
 * 避免 40 个路由各写一遍 `.then((m) => ({ default: m.XxxPage }))`。
 *
 * 刻意不做 `any` 转换：模块类型必须是「字符串索引到组件」，取出来的值是组件本体，
 * 找不到导出时在运行期给出可读错误，而不是静默渲染空白。
 */
type PageModule = Record<string, ComponentType>;

export function page(
  load: () => Promise<PageModule>,
  exportName: string,
): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    const module = await load();
    const Component = module[exportName];
    if (Component === undefined) {
      throw new Error(`页面模块缺少导出「${exportName}」，请检查 import 路径`);
    }
    return { default: Component };
  });
}
