import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Space, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  ExportOutlined,
  LinkOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router';
import { useApiQuery } from '../../api/hooks';
import { fmtNumber } from '../../utils/format';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntityLink,
  EntitySummary,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  PlatformTag,
  RelativeTime,
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Platform mapping overview (Phase 2 task §29): settings-level view of SKU
 * mapping health — totals, unmapped backlog and entry points. The actual
 * mapping work stays in the SKU 映射 workbench (/listings); single-SKU mapping
 * lives in the SKU page. Read-only here.
 */

interface ListingRow {
  id: string;
  platformCode: string;
  storeCode: string;
  platformProductId: string;
  title: string | null;
  url: string | null;
  skuId: string | null;
  skuCode: string | null;
  skuName: string | null;
  mappingStatus: 'MAPPED' | 'UNMAPPED';
  status: string;
  updatedAt: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

export function PlatformMappingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  const [mappingState, setMappingState] = useState<string | undefined>();
  const [platformId, setPlatformId] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const effectiveKeyword = keyword.trim();
  const list = useApiQuery<Envelope<ListingRow[]>>(
    '/api/v1/listings',
    {
      page,
      pageSize: 20,
      ...(effectiveKeyword ? { keyword: effectiveKeyword } : {}),
      ...(mappingState ? { mappingState } : {}),
      ...(platformId ? { platformId } : {}),
    },
    ['listings', 'overview', page, effectiveKeyword, mappingState, platformId],
  );

  const mappedCount = useApiQuery<Envelope<ListingRow[]>>(
    '/api/v1/listings',
    { page: 1, pageSize: 1, mappingState: 'MAPPED' },
    ['listings', 'count', 'MAPPED'],
  );
  const unmappedCount = useApiQuery<Envelope<ListingRow[]>>(
    '/api/v1/listings',
    { page: 1, pageSize: 1, mappingState: 'UNMAPPED' },
    ['listings', 'count', 'UNMAPPED'],
  );
  const mappingExceptions = useApiQuery<Envelope<Array<{ id: string }>>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 1, status: 'OPEN', exceptionType: 'ORDER_SKU_MAPPING_FAILED' },
    ['exceptions', 'mapping-overview'],
  );
  const platforms = useApiQuery<Envelope<Array<{ id: string; code: string; name: string }>>>(
    '/api/v1/platforms',
    {},
    ['platforms', 'for-mappings'],
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="映射概况">
            <ContextMetric label="已映射" value={fmtNumber(mappedCount.data?.meta.total ?? 0)} />
            <ContextMetric
              label={<span style={{ color: colors.warning }}>未映射</span>}
              value={fmtNumber(unmappedCount.data?.meta.total ?? 0)}
            />
            <ContextMetric
              label={<span style={{ color: colors.danger }}>映射类异常</span>}
              value={fmtNumber(mappingExceptions.data?.meta.total ?? 0)}
            />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击列表行查看映射详情；具体映射操作在 SKU 映射页完成。
            </span>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.platformProductId}
          subtitle={selectedRow.title ?? '（无标题）'}
          badge={
            <StatusBadge
              tone={selectedRow.mappingStatus === 'MAPPED' ? 'success' : 'warning'}
              label={selectedRow.mappingStatus === 'MAPPED' ? '已映射' : '未映射'}
              hint={selectedRow.mappingStatus}
            />
          }
          meta={<PlatformTag code={selectedRow.platformCode} suffix={selectedRow.storeCode} />}
        />
      ),
      children: (
        <>
          <ContextSection title="内部 SKU">
            {selectedRow.skuCode !== null ? (
              <>
                <ContextMetric label="SKU 编码" value={selectedRow.skuCode} />
                <ContextMetric label="名称" value={selectedRow.skuName ?? '—'} />
              </>
            ) : (
              <span style={{ fontSize: 13, color: colors.warning }}>
                尚未映射到内部 SKU — 平台订单进入后将产生映射失败异常。
              </span>
            )}
          </ContextSection>
          <ContextSection title="链接信息">
            <ContextMetric
              label="更新时间"
              value={<RelativeTime value={selectedRow.updatedAt} />}
            />
            <ContextMetric
              label="商品链接"
              value={
                selectedRow.url === null ? (
                  '—'
                ) : (
                  <a
                    href={selectedRow.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: colors.primary }}
                  >
                    打开
                  </a>
                )
              }
            />
          </ContextSection>
          <ContextAction>
            <Button
              block
              icon={<LinkOutlined />}
              onClick={() =>
                void navigate(
                  `/listings?keyword=${encodeURIComponent(selectedRow.platformProductId)}`,
                )
              }
            >
              前往 SKU 映射处理
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, mappedCount.data, unmappedCount.data, mappingExceptions.data, navigate]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="SKU 映射总览"
        description="平台 SKU 与内部 SKU 的映射状态总览；具体映射操作在 SKU 映射页完成"
        secondary={
          <Space>
            <Tooltip title="刷新映射数据">
              <Button
                icon={<ReloadOutlined />}
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: ['listings', 'overview'] })
                }
              >
                刷新
              </Button>
            </Tooltip>
            <EntityLink to="/listings" primary="进入 SKU 映射工作台" icon={<ExportOutlined />} />
          </Space>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <MetricCard
          icon={<AppstoreOutlined />}
          title="已映射"
          value={fmtNumber(mappedCount.data?.meta.total ?? 0)}
          aux="MAPPED"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="未映射"
          value={fmtNumber(unmappedCount.data?.meta.total ?? 0)}
          aux="UNMAPPED · 需处理"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="映射类异常"
          value={fmtNumber(mappingExceptions.data?.meta.total ?? 0)}
          aux="待处理 ORDER_SKU_MAPPING_FAILED"
        />
      </div>

      <FilterBar>
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 140 }}
          value={platformId}
          onChange={(value) => {
            setPage(1);
            setPlatformId(value);
          }}
          options={(platforms.data?.data ?? []).map((platform) => ({
            value: platform.id,
            label: platform.name,
          }))}
        />
        <Select
          allowClear
          placeholder="映射状态"
          style={{ width: 120 }}
          value={mappingState}
          onChange={(value) => {
            setPage(1);
            setMappingState(value);
          }}
          options={[
            { value: 'UNMAPPED', label: '未映射' },
            { value: 'MAPPED', label: '已映射' },
          ]}
        />
        <Input.Search
          placeholder="搜索平台商品 ID / 标题"
          allowClear
          defaultValue={effectiveKeyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() =>
              void queryClient.invalidateQueries({ queryKey: ['listings', 'overview'] })
            }
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<ListingRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            emptyTitle="暂无 Listing"
            emptyDescription="同步商品后将出现在这里"
            pagination={{
              current: page,
              pageSize: 20,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
                borderLeft:
                  record.mappingStatus === 'UNMAPPED'
                    ? `2px solid ${colors.warning}`
                    : '2px solid transparent',
              },
            })}
            columns={[
              {
                title: '平台商品',
                key: 'platformProduct',
                render: (_: unknown, row: ListingRow) => (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 550, fontFamily: 'monospace', fontSize: 13 }}>
                      {row.platformProductId}
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: colors.textSecondary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 320,
                      }}
                    >
                      {row.title ?? '（无标题）'}
                    </div>
                  </div>
                ),
              },
              {
                title: '平台',
                dataIndex: 'platformCode',
                key: 'platform',
                width: 110,
                render: (_: unknown, row: ListingRow) => (
                  <PlatformTag code={row.platformCode} suffix={row.storeCode} />
                ),
              },
              {
                title: '映射状态',
                dataIndex: 'mappingStatus',
                key: 'mappingStatus',
                width: 100,
                render: (value: string) =>
                  value === 'MAPPED' ? (
                    <StatusBadge tone="success" label="已映射" />
                  ) : (
                    <StatusBadge tone="warning" label="未映射" />
                  ),
              },
              {
                title: '内部 SKU',
                key: 'sku',
                render: (_: unknown, row: ListingRow) =>
                  row.skuCode === null ? (
                    <span style={{ color: colors.textTertiary }}>—</span>
                  ) : (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{row.skuCode}</div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: colors.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 260,
                        }}
                      >
                        {row.skuName ?? ''}
                      </div>
                    </div>
                  ),
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                key: 'updatedAt',
                width: 110,
                render: (value: string) => <RelativeTime value={value} />,
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
