import { Tabs } from 'antd';
import { useSearchParams } from 'react-router';
import { InterceptionsPage } from '../interceptions/InterceptionsPage';
import { PickingPage } from '../picking/PickingPage';
import { ReturnsPage } from '../returns/ReturnsPage';
import { ShipmentsPage } from '../shipments/ShipmentsPage';

/**
 * 仓库作业中心：拣货 / 发货 / 拦截 / 退货合并为一个导航入口（用户反馈：
 * 四个独立页面各占一个导航项浪费空间、来回切换不便）。
 *
 * 各 Tab 仍是原页面实现（自带 PageHeader 与右栏注册），因此内容切换必须
 * 销毁（destroyOnHidden）——否则多个页面的 useContextRail 会相互覆盖。
 * 深链通过 ?tab= 保持（/warehouse-ops?tab=shipments 等），旧路由在
 * App 路由表中重定向到这里。
 */
const OPS_TABS = [
  { key: 'picking', label: '拣货', node: <PickingPage /> },
  { key: 'shipments', label: '发货', node: <ShipmentsPage /> },
  { key: 'interceptions', label: '拦截', node: <InterceptionsPage /> },
  { key: 'returns', label: '退货', node: <ReturnsPage /> },
] as const;

export function WarehouseOpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeKey =
    rawTab !== null && OPS_TABS.some((tab) => tab.key === rawTab) ? rawTab : 'picking';

  return (
    <Tabs
      activeKey={activeKey}
      onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
      items={OPS_TABS.map(({ key, label, node }) => ({ key, label, children: node }))}
      destroyOnHidden
    />
  );
}
