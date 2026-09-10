import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AppstoreOutlined,
  CloudSyncOutlined,
  ShoppingOutlined,
  ShopOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useDebouncedValue, useApiQuery } from '../api/hooks';
import {
  CommandPalette,
  ERP_STATUS_META,
  PaletteItem,
  SKU_STATUS_META,
  StatusBadge,
} from '../design-system';

/**
 * Global search + command palette (Phase 2 task §30-§34): Ctrl/Cmd+K opens a
 * centered palette. Entity search fans out to the existing list endpoints
 * (orders / skus / stores — there is no unified search API), debounced 300ms
 * with a 2-character minimum (task §77). Recents are kept in localStorage.
 */

const RECENTS_KEY = 'wcies.recent-entities';
const RECENTS_LIMIT = 6;
const MIN_KEYWORD = 2;

interface RecentEntity {
  key: string;
  type: string;
  label: string;
  to: string;
  ts: string;
}

interface OrderHit {
  id: string;
  orderNo: string;
  storeName: string;
  platformCode: string;
  erpStatus: string;
}

interface SkuHit {
  id: string;
  skuCode: string;
  nameZh: string;
  status: string;
}

interface StoreHit {
  id: string;
  storeCode: string;
  name: string;
  platformCode: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

function loadRecents(): RecentEntity[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as RecentEntity[];
    return Array.isArray(parsed) ? parsed.slice(0, RECENTS_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(entry: Omit<RecentEntity, 'ts'>): void {
  const next = [
    { ...entry, ts: new Date().toISOString() },
    ...loadRecents().filter((item) => item.key !== entry.key),
  ].slice(0, RECENTS_LIMIT);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [recents, setRecents] = useState<RecentEntity[]>(() => loadRecents());
  const debounced = useDebouncedValue(keyword.trim(), 300);
  const searchable = debounced.length >= MIN_KEYWORD;

  const orders = useApiQuery<Envelope<OrderHit[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 5, keyword: debounced },
    ['global-search-orders', debounced],
    undefined,
    open && searchable,
  );
  const skus = useApiQuery<Envelope<SkuHit[]>>(
    '/api/v1/skus',
    { page: 1, pageSize: 5, keyword: debounced },
    ['global-search-skus', debounced],
    undefined,
    open && searchable,
  );
  const stores = useApiQuery<Envelope<StoreHit[]>>(
    '/api/v1/stores',
    { page: 1, pageSize: 5, keyword: debounced },
    ['global-search-stores', debounced],
    undefined,
    open && searchable,
  );

  const goTo = useCallback(
    (entry: { key: string; type: string; label: string; to: string }) => {
      saveRecent(entry);
      setRecents(loadRecents());
      onClose();
      setKeyword('');
      void navigate(entry.to);
    },
    [navigate, onClose],
  );

  // Clear the input when the palette closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setKeyword('');
    }
  }, [open]);

  const quickActionItems: PaletteItem[] = useMemo(
    () => [
      {
        key: 'qa-exceptions',
        icon: <WarningOutlined />,
        primary: '查看异常',
        secondary: '异常中心',
        onSelect: () =>
          goTo({ key: 'qa-exceptions', type: '操作', label: '查看异常', to: '/exceptions' }),
      },
      {
        key: 'qa-sync',
        icon: <CloudSyncOutlined />,
        primary: '打开同步中心',
        secondary: '同步任务与 Webhook 事件',
        onSelect: () => goTo({ key: 'qa-sync', type: '操作', label: '打开同步中心', to: '/sync' }),
      },
      {
        key: 'qa-picking',
        icon: <ToolOutlined />,
        primary: '进入拣货',
        secondary: '拣货任务工作台',
        onSelect: () =>
          goTo({ key: 'qa-picking', type: '操作', label: '进入拣货', to: '/picking' }),
      },
      {
        key: 'qa-create-sku',
        icon: <AppstoreOutlined />,
        primary: '创建 SKU',
        secondary: 'SKU 管理页新建',
        onSelect: () =>
          goTo({ key: 'qa-create-sku', type: '操作', label: '创建 SKU', to: '/skus?create=1' }),
      },
    ],
    [goTo],
  );

  const orderItems: PaletteItem[] = useMemo(
    () =>
      (orders.data?.data ?? []).map((order) => ({
        key: `order-${order.id}`,
        icon: <ShoppingOutlined />,
        primary: order.orderNo,
        secondary: `${order.platformCode} · ${order.storeName}`,
        type: '订单',
        status: (
          <StatusBadge
            tone={ERP_STATUS_META[order.erpStatus]?.tone ?? 'neutral'}
            label={ERP_STATUS_META[order.erpStatus]?.label ?? order.erpStatus}
            hint={order.erpStatus}
            showDot={false}
          />
        ),
        onSelect: () =>
          goTo({
            key: `order-${order.id}`,
            type: '订单',
            label: order.orderNo,
            to: `/orders?keyword=${encodeURIComponent(order.orderNo)}&focus=${order.id}`,
          }),
      })),
    [orders.data, goTo],
  );

  const skuItems: PaletteItem[] = useMemo(
    () =>
      (skus.data?.data ?? []).map((sku) => ({
        key: `sku-${sku.id}`,
        icon: <AppstoreOutlined />,
        primary: sku.skuCode,
        secondary: sku.nameZh,
        type: 'SKU',
        status: (
          <StatusBadge
            tone={SKU_STATUS_META[sku.status]?.tone ?? 'neutral'}
            label={SKU_STATUS_META[sku.status]?.label ?? sku.status}
            hint={sku.status}
            showDot={false}
          />
        ),
        onSelect: () =>
          goTo({
            key: `sku-${sku.id}`,
            type: 'SKU',
            label: sku.skuCode,
            to: `/skus?keyword=${encodeURIComponent(sku.skuCode)}&focus=${sku.id}`,
          }),
      })),
    [skus.data, goTo],
  );

  const storeItems: PaletteItem[] = useMemo(
    () =>
      (stores.data?.data ?? []).map((store) => ({
        key: `store-${store.id}`,
        icon: <ShopOutlined />,
        primary: store.name,
        secondary: `${store.platformCode} · ${store.storeCode}`,
        type: '店铺',
        onSelect: () =>
          goTo({
            key: `store-${store.id}`,
            type: '店铺',
            label: store.storeCode,
            to: `/stores?keyword=${encodeURIComponent(store.storeCode)}&focus=${store.id}`,
          }),
      })),
    [stores.data, goTo],
  );

  const recentItems: PaletteItem[] = useMemo(
    () =>
      recents.map((entry) => ({
        key: entry.key,
        icon: <AppstoreOutlined />,
        primary: entry.label,
        secondary: entry.to,
        type: entry.type,
        timestamp: entry.ts,
        onSelect: () => goTo(entry),
      })),
    [recents, goTo],
  );

  const searching = searchable && (orders.isFetching || skus.isFetching || stores.isFetching);

  const sections = useMemo(() => {
    if (!searchable) {
      return [
        { key: 'recent', label: '最近访问', items: recentItems },
        { key: 'quick', label: '快速操作', items: quickActionItems },
      ];
    }
    return [
      { key: 'orders', label: '订单', items: orderItems },
      { key: 'skus', label: 'SKU', items: skuItems },
      { key: 'stores', label: '店铺', items: storeItems },
      {
        key: 'quick',
        label: '快速操作',
        items: keyword.trim().length === 0 ? quickActionItems : [],
      },
    ];
  }, [searchable, recentItems, quickActionItems, orderItems, skuItems, storeItems, keyword]);

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      keyword={keyword}
      onKeywordChange={setKeyword}
      loading={searching}
      minLengthHint={
        keyword.trim().length > 0 && !searchable
          ? `至少输入 ${MIN_KEYWORD} 个字符开始搜索`
          : '输入关键词搜索订单、SKU、店铺，或选择快速操作'
      }
      sections={sections}
    />
  );
}
