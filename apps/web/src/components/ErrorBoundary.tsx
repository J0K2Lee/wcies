import { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result } from 'antd';

/**
 * UI crash boundary — a render error never leaves a blank page.
 *
 * 2026-10-17 体检 P1-8 后的三处升级：
 * 1. **可复位**：`resetKeys` 任一变化即清除错误态。改造前 `hasError` 一旦置位就
 *    永久生效，用户只能整页刷新；现在路由级边界传 `[location.pathname]`，
 *    换页自动恢复。
 * 2. **两级边界**：根边界兜住整个应用（最后一道），`AppLayout` 内再包一层
 *    `inset` 边界，页面级崩溃只影响内容区，左导航/顶栏仍可用。
 * 3. **文案分离**：对外只说「页面渲染失败」，原始 message 只进 console，
 *    不再把技术细节直接摆在业务用户面前。
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** Any change in this list clears the error state (e.g. `[location.pathname]`). */
  resetKeys?: unknown[];
  /** Route-level boundary: occupy only the content area instead of the viewport. */
  inset?: boolean;
  title?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (!this.state.hasError) {
      return;
    }
    const prevKeys = prevProps.resetKeys ?? [];
    const nextKeys = this.props.resetKeys ?? [];
    const changed =
      prevKeys.length !== nextKeys.length || prevKeys.some((key, index) => key !== nextKeys[index]);
    if (changed) {
      this.setState({ hasError: false });
    }
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  private goHome = (): void => {
    // 类组件里没有 hook；整页跳转同时丢弃可能已损坏的组件树。
    window.location.assign('/');
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div
        style={
          this.props.inset === true
            ? { padding: '72px 0' }
            : { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        }
      >
        <Result
          status="error"
          title={this.props.title ?? '页面出现错误'}
          subTitle="该页面渲染失败。可以重试，或返回首页继续其他操作。技术细节已记录到浏览器控制台。"
          extra={[
            <Button key="retry" type="primary" onClick={this.reset}>
              重试
            </Button>,
            <Button key="home" onClick={this.goHome}>
              返回首页
            </Button>,
          ]}
        />
      </div>
    );
  }
}
