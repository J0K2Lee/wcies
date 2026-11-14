import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Divider,
  Modal,
  Progress,
  Radio,
  Space,
  Tag,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, useApiQuery } from '../api/hooks';
import { colors } from '../design-system';

/**
 * SKU 自定义列导出（2026-11-04）。
 *
 * 默认口径（用户确认）：
 * - 勾选「平台映射」组的列 → **一行一个 listing**（同一 SKU 多行，SKU 列重复）；
 * - 一张映射列都不勾 → 每个 SKU 只出一行；
 * - 全量导出，不截断；执行在 BullMQ，这里只轮询进度并给出下载。
 *
 * 列目录由后端 `GET /skus/exports/columns` 提供 —— 前端不硬编码列清单。
 */

interface SkuExportColumnDto {
  key: string;
  label: string;
  group: string;
  groupLabel: string;
  listing: boolean;
  defaultSelected: boolean;
}

interface SkuExportJobCreatedDto {
  jobId: string;
  status: string;
}

interface SkuExportJobStatusDto {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  rowCount?: number;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
}

export interface SkuExportFilters {
  keyword?: string;
  brandId?: string;
  categoryId?: string;
  status?: string;
  hasListing?: 'true' | 'false';
}

interface Props {
  open: boolean;
  onClose: () => void;
  filters: SkuExportFilters;
  selectedSkuIds: readonly string[];
  totalCount: number;
}

/** 上次勾选的列（localStorage，与订单/采购页「视图设置」同一套路）。 */
const COLUMNS_STORAGE_KEY = 'wcies.skus.export.v1';

function loadSavedColumns(): string[] | null {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return null;
  }
}

function saveColumns(keys: readonly string[]): void {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // 隐私模式：仅本次会话生效。
  }
}

export function SkuExportModal({ open, onClose, filters, selectedSkuIds, totalCount }: Props) {
  const { message } = AntApp.useApp();
  const catalog = useApiQuery<{ data: SkuExportColumnDto[] }>(
    '/api/v1/skus/exports/columns',
    {},
    ['sku-export-columns'],
    undefined,
    open,
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<'FILTERED' | 'SELECTED'>('FILTERED');
  const [jobId, setJobId] = useState<string | null>(null);
  const autoOpened = useRef(false);

  const columns = useMemo(() => catalog.data?.data ?? [], [catalog.data]);

  // 打开时初始化：优先用上次勾选（过滤掉已下线的列），否则用目录默认。
  useEffect(() => {
    if (!open || columns.length === 0) {
      return;
    }
    const known = new Set(columns.map((column) => column.key));
    const saved = loadSavedColumns();
    const initial =
      saved === null
        ? columns.filter((column) => column.defaultSelected).map((column) => column.key)
        : saved.filter((key) => known.has(key));
    setSelected(
      initial.length > 0 ? initial : columns.filter((c) => c.defaultSelected).map((c) => c.key),
    );
    setJobId(null);
    autoOpened.current = false;
    setScope(selectedSkuIds.length > 0 ? 'SELECTED' : 'FILTERED');
    // selectedSkuIds 只在打开瞬间取一次值：弹窗打开后用户去改勾选没有意义。
  }, [open, columns.length]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { label: string; items: SkuExportColumnDto[] }>();
    for (const column of columns) {
      const bucket = byGroup.get(column.group);
      if (bucket === undefined) {
        order.push(column.group);
        byGroup.set(column.group, { label: column.groupLabel, items: [column] });
      } else {
        bucket.items.push(column);
      }
    }
    return order.map((key) => ({ key, ...byGroup.get(key)! }));
  }, [columns]);

  const toggleColumn = (key: string, checked: boolean): void => {
    setSelected((previous) =>
      checked ? [...previous, key] : previous.filter((item) => item !== key),
    );
  };

  const toggleGroup = (keys: readonly string[], checked: boolean): void => {
    setSelected((previous) =>
      checked
        ? [...new Set([...previous, ...keys])]
        : previous.filter((key) => !keys.includes(key)),
    );
  };

  const hasListingColumns = selected.some(
    (key) => columns.find((column) => column.key === key)?.listing === true,
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      saveColumns(selected);
      return apiPost<SkuExportJobCreatedDto>('/api/v1/skus/exports', {
        // 列顺序 = 目录顺序，与弹窗里的展示顺序一致。
        columns: columns.filter((column) => selected.includes(column.key)).map((c) => c.key),
        ...(scope === 'SELECTED' ? { skuIds: [...selectedSkuIds] } : { filters }),
        sortBy: 'skuCode',
        sortOrder: 'asc',
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      autoOpened.current = false;
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const statusQuery = useQuery({
    queryKey: ['sku-export-job', jobId],
    enabled: jobId !== null && open,
    refetchInterval: (query) => {
      const current = query.state.data;
      if (current === undefined) {
        return 1500;
      }
      return current.status === 'QUEUED' || current.status === 'RUNNING' ? 1500 : false;
    },
    queryFn: async () => {
      const result = await apiGet<SkuExportJobStatusDto>(
        '/api/v1/skus/exports/{jobId}',
        {},
        { jobId: jobId ?? '' },
      );
      return result.data;
    },
  });

  const job = statusQuery.data;

  // 生成完成：尝试自动打开下载（浏览器可能拦截），弹窗保持打开并给出显式按钮。
  useEffect(() => {
    if (job?.status === 'COMPLETED' && job.downloadUrl !== undefined && !autoOpened.current) {
      autoOpened.current = true;
      window.open(job.downloadUrl, '_blank');
      void message.success(`已生成 ${job.rowCount ?? 0} 行`);
    }
  }, [job, message]);

  const running = createMutation.isPending || job?.status === 'QUEUED' || job?.status === 'RUNNING';
  const finished = job?.status === 'COMPLETED';

  return (
    <Modal
      title="导出 SKU"
      open={open}
      width={720}
      onCancel={() => {
        if (!running) {
          onClose();
        }
      }}
      maskClosable={!running}
      footer={
        <Space>
          <Button onClick={onClose} disabled={running}>
            {finished ? '关闭' : '取消'}
          </Button>
          {finished && job?.downloadUrl !== undefined ? (
            <Button type="primary" href={job.downloadUrl} target="_blank">
              下载 {job.fileName ?? '导出文件'}
            </Button>
          ) : (
            <Button
              type="primary"
              loading={running}
              disabled={selected.length === 0}
              onClick={() => createMutation.mutate()}
            >
              开始导出
            </Button>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ color: colors.textSecondary, fontSize: 13 }}>
          导出范围：
          {selectedSkuIds.length > 0 ? (
            <Radio.Group
              value={scope}
              disabled={running}
              onChange={(event) => setScope(event.target.value as 'FILTERED' | 'SELECTED')}
              style={{ marginLeft: 8 }}
            >
              <Radio value="SELECTED">仅选中的 {selectedSkuIds.length} 个 SKU</Radio>
              <Radio value="FILTERED">当前筛选的全部 {totalCount} 个 SKU</Radio>
            </Radio.Group>
          ) : (
            <span> 当前筛选的全部 {totalCount} 个 SKU</span>
          )}
        </div>

        {selectedSkuIds.length === 0 && (
          <div style={{ color: colors.textSecondary, fontSize: 12.5 }}>
            想只导一部分？在表格左侧勾选行后，这里会出现「仅选中的 SKU」选项。
          </div>
        )}

        <Divider style={{ margin: '4px 0' }} />

        <div style={{ maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
          {groups.map((group) => {
            const keys = group.items.map((item) => item.key);
            const checkedCount = keys.filter((key) => selected.includes(key)).length;
            const allChecked = checkedCount === keys.length;
            return (
              <div key={group.key} style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  <Checkbox
                    checked={allChecked}
                    indeterminate={checkedCount > 0 && !allChecked}
                    disabled={running}
                    onChange={(event) => toggleGroup(keys, event.target.checked)}
                  >
                    <span style={{ fontWeight: 550 }}>{group.label}</span>
                  </Checkbox>
                  {group.key === 'LISTING' && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      勾选后一行一个平台链接
                    </Tag>
                  )}
                </div>
                <Space wrap size={[16, 6]} style={{ paddingLeft: 24 }}>
                  {group.items.map((column) => (
                    <Checkbox
                      key={column.key}
                      checked={selected.includes(column.key)}
                      disabled={running}
                      onChange={(event) => toggleColumn(column.key, event.target.checked)}
                    >
                      {column.label}
                    </Checkbox>
                  ))}
                </Space>
              </div>
            );
          })}
        </div>

        {hasListingColumns && (
          <Alert
            type="info"
            showIcon
            message="已选择平台映射列：同一 SKU 有多个平台链接时会导出多行（SKU 列重复，每行是该链接的数据）"
          />
        )}

        {job !== undefined && (
          <div>
            <Progress
              percent={job.status === 'COMPLETED' ? 100 : job.progress}
              status={
                job.status === 'FAILED'
                  ? 'exception'
                  : job.status === 'COMPLETED'
                    ? 'success'
                    : 'active'
              }
            />
            {job.status === 'FAILED' && (
              <Alert
                type="error"
                showIcon
                message={job.error ?? '导出失败'}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        )}
      </Space>
    </Modal>
  );
}
