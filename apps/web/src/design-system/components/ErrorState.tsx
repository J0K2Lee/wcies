import { Button } from 'antd';
import { EmptyState } from './EmptyState';

/**
 * Data-load failure state (Phase 2 task §40): a visible "无法加载数据" block
 * with a retry action — never a console-only error. Used by every Phase 2
 * page's main data area.
 */
export interface ErrorStateProps {
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ description, onRetry, retrying }: ErrorStateProps) {
  return (
    <EmptyState
      error
      title="无法加载数据"
      description={description ?? '请求失败，请稍后重试'}
      action={
        onRetry !== undefined ? (
          <Button size="small" onClick={onRetry} loading={retrying === true}>
            重新加载
          </Button>
        ) : undefined
      }
    />
  );
}
