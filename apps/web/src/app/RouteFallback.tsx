import { Skeleton, Spin } from 'antd';
import { colors, layout } from '../design-system';

/**
 * Suspense fallbacks for route-level code splitting (S1-1).
 *
 * 两个用途不同，不要合并：
 * - `PageFallback`：页面切换时**只占内容区**，外壳（左导航/顶栏/右栏）保持不动，
 *   否则每次换页整个工作台会闪一下。
 * - `BootFallback`：未登录的公共路由（login/invite/reset）首包加载，此时还没有外壳，
 *   只能全屏。
 */
export function PageFallback() {
  return (
    <div
      aria-busy="true"
      aria-label="页面加载中"
      style={{ paddingTop: 4, maxWidth: layout.contentMaxWidth }}
    >
      <Skeleton
        active
        title={{ width: 180 }}
        paragraph={{ rows: 1, width: '40%' }}
        style={{ marginBottom: 24 }}
      />
      <div
        style={{
          background: colors.container,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <Skeleton active title={false} paragraph={{ rows: 8 }} />
      </div>
    </div>
  );
}

export function BootFallback() {
  return (
    <div
      aria-busy="true"
      aria-label="加载中"
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colors.canvas,
      }}
    >
      <Spin size="large" />
    </div>
  );
}
