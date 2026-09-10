import { Table } from 'antd';
import { TableProps } from 'antd';
import { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

/**
 * Unified data table (task §52): 44-48px rows, light header, faint dividers,
 * no per-cell borders. All management pages render list data through this so
 * density stays identical across the workbench.
 */
export interface DataTableProps<RecordType extends object> extends TableProps<RecordType> {
  /** Renders inside the table when the query resolves to zero rows. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Optional summary line pinned under the header row (e.g. counts). */
  toolbar?: ReactNode;
}

export function DataTable<RecordType extends object>({
  emptyTitle,
  emptyDescription,
  toolbar,
  ...tableProps
}: DataTableProps<RecordType>) {
  return (
    <div>
      {toolbar !== undefined && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #EEF0F3' }}>{toolbar}</div>
      )}
      <Table<RecordType>
        size="middle"
        {...tableProps}
        locale={{
          ...tableProps.locale,
          emptyText: <EmptyState title={emptyTitle ?? '暂无数据'} description={emptyDescription} />,
        }}
      />
    </div>
  );
}
