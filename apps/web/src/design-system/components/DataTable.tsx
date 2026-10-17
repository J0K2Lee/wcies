import { Table } from 'antd';
import { TableProps } from 'antd';
import { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

/**
 * Unified data table (task §52): 44-48px rows, light header, faint dividers,
 * no per-cell borders. All management pages render list data through this so
 * density stays identical across the workbench.
 *
 * 错误态（2026-10-17 体检 P1-7）：传入 `error` 时渲染 ErrorState 而不是空表。
 * 改造前 161 处查询只有 9 个页面渲染错误态，请求失败会表现成「共 0 条」的空表，
 * 与「确实没有数据」无法区分 —— 直接违背「异常可见」原则。现在由组件层统一兜住，
 * 页面只需把 `query.error` 与重试函数透传下来。
 */
export interface DataTableProps<RecordType extends object> extends TableProps<RecordType> {
  /** Renders inside the table when the query resolves to zero rows. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Optional summary line pinned under the header row (e.g. counts). */
  toolbar?: ReactNode;
  /** Query failure. When set, the table body is replaced by an error state. */
  error?: unknown;
  /** Retry action shown inside the error state. */
  onRetry?: () => void;
  /** True while a retry is in flight (keeps the retry button spinning). */
  retrying?: boolean;
}

export function DataTable<RecordType extends object>({
  emptyTitle,
  emptyDescription,
  toolbar,
  error,
  onRetry,
  retrying,
  ...tableProps
}: DataTableProps<RecordType>) {
  const failed = error !== undefined && error !== null;
  return (
    <div>
      {toolbar !== undefined && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #EEF0F3' }}>{toolbar}</div>
      )}
      {failed ? (
        <div style={{ padding: '56px 0' }}>
          <ErrorState
            // 后端 envelope 的 message 是业务文案，直接展示比「请稍后重试」有用；
            // 非 Error（网络层异常）则退回默认文案。
            description={error instanceof Error && error.message !== '' ? error.message : undefined}
            onRetry={onRetry}
            retrying={retrying}
          />
        </div>
      ) : (
        <Table<RecordType>
          size="middle"
          {...tableProps}
          locale={{
            ...tableProps.locale,
            emptyText: (
              <EmptyState title={emptyTitle ?? '暂无数据'} description={emptyDescription} />
            ),
          }}
        />
      )}
    </div>
  );
}
