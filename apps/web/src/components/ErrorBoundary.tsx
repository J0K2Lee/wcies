import { Component, ErrorInfo, ReactNode } from 'react';
import { Result } from 'antd';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/** Last-resort UI crash boundary so a render error never leaves a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <Result status="error" title="页面出现错误" subTitle={this.state.message} />;
    }
    return this.props.children;
  }
}
