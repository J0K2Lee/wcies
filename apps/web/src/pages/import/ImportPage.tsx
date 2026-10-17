import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Modal, Select, Space, Table, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useApiQuery } from '../../api/hooks';
import {
  ContextMetric,
  ContextSection,
  DataTable,
  FilterBar,
  IMPORT_STATUS_META,
  IMPORT_TYPE_LABEL,
  PageHeader,
  RailHint,
  RelativeTime,
  SectionCard,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

interface ImportJob {
  id: string;
  importType: string;
  status: string;
  originalFilename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  failedRows: number;
  errors: Array<{ row: number; field?: string; code: string; message: string }> | null;
  createdByName: string | null;
  createdAt: string;
}

const IMPORT_TYPES = [
  { value: 'SKU', label: 'SKU（含条码）' },
  { value: 'BARCODE', label: '条码' },
  { value: 'WAREHOUSE', label: '仓库' },
  { value: 'BIN', label: '库位' },
  { value: 'LISTING_MAPPING', label: 'Listing 映射' },
  { value: 'INITIAL_INVENTORY', label: '库存初始化' },
];

/**
 * Backend fixed templates (import-template.service.ts) only exist for SKU and
 * LISTING_MAPPING; other import types parse user-prepared files without a
 * downloadable template, so the button hides for them.
 */
const TEMPLATE_OF_TYPE: Partial<Record<string, string>> = {
  SKU: 'SKU',
  BARCODE: 'SKU',
  LISTING_MAPPING: 'LISTING_MAPPING',
};

/** 导入中心 (task §63/§57-§61): upload -> validate -> confirm. */
export function ImportPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [importType, setImportType] = useState('SKU');
  const [previewJob, setPreviewJob] = useState<ImportJob | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const jobs = useApiQuery<{ data: ImportJob[]; meta: { total: number } }>(
    '/api/v1/imports',
    { page, pageSize: 50 },
    ['imports', page],
  );

  const uploadMutation = useMutation({
    mutationFn: async ({ file, type }: { file: File; type: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      // multipart upload: the generated client has no typed multipart body
      // for this endpoint, so this single call posts FormData directly.
      const response = await fetch(`/api/v1/imports/upload?type=${type}`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const body = (await response.json()) as {
        success: boolean;
        data?: ImportJob;
        error?: { message: string };
      };
      if (!body.success || body.data === undefined) {
        throw new Error(body.error?.message ?? '上传失败');
      }
      return body.data;
    },
    onSuccess: (job) => {
      setPreviewJob(job);
      void message.info(`解析完成：${job.validRows} 行有效，${job.invalidRows} 行有误`);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (jobId: string) =>
      fetch(`/api/v1/imports/${jobId}/confirm`, { method: 'POST', credentials: 'include' }).then(
        async (response) => {
          const body = (await response.json()) as { success: boolean; error?: { message: string } };
          if (!body.success) {
            throw new Error(body.error?.message ?? '确认失败');
          }
        },
      ),
    onSuccess: () => {
      void message.success('已提交导入队列，稍后刷新查看结果');
      setPreviewJob(null);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  /** Template download (Sprint 8 T2.4): fixed-template xlsx from the backend. */
  const downloadTemplate = async (type: string): Promise<void> => {
    try {
      const response = await fetch(`/api/v1/imports/templates/${type}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `模板下载失败（${response.status}）`);
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = match?.[1] ?? `${type}-template.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '模板下载失败');
    }
  };

  const list = jobs.data?.data ?? [];

  const railContent = useMemo<ContextRailContent>(
    () => ({
      defaultCollapsed: true,
      children: (
        <ContextSection title="导入概况">
          <ContextMetric label="导入任务" value={`${jobs.data?.meta.total ?? 0} 个`} />
          <ContextMetric label="当前导入类型" value={IMPORT_TYPE_LABEL[importType] ?? importType} />
          <RailHint>双击任务行查看校验结果；确认导入后由后台队列执行。</RailHint>
        </ContextSection>
      ),
    }),
    [jobs.data, importType],
  );
  useContextRail(railContent);

  const templateType = TEMPLATE_OF_TYPE[importType];

  return (
    <div>
      <PageHeader
        title="导入中心"
        description="上传固定模板 Excel → 行级校验 → 确认导入（后台队列执行）；重复业务键会被拒绝，不会静默覆盖"
        secondary={
          templateType !== undefined ? (
            <Button onClick={() => void downloadTemplate(templateType)}>
              下载{IMPORT_TYPE_LABEL[templateType] ?? templateType}模板
            </Button>
          ) : undefined
        }
        primary={
          <Upload
            accept=".xlsx"
            showUploadList={false}
            customRequest={({ file }) =>
              uploadMutation.mutate({ file: file as File, type: importType })
            }
          >
            <Button type="primary" icon={<UploadOutlined />} loading={uploadMutation.isPending}>
              上传 Excel
            </Button>
          </Upload>
        }
      />

      <FilterBar>
        <Select
          value={importType}
          onChange={setImportType}
          options={IMPORT_TYPES}
          style={{ width: 200 }}
          aria-label="导入类型"
        />
      </FilterBar>

      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="success"
          showIcon
          title="批量补映射两步指引（Excel 闭环）"
          description={
            <ol style={{ margin: '4px 0 0 18px', padding: 0 }}>
              <li>
                到「SKU映射」页点右上角<b>导出未映射清单</b>（列与导入模板逐列对齐，
                <code>internal_sku_code</code> 留空）。
              </li>
              <li>
                本地补填 <code>internal_sku_code</code>：SKU 未建档的，先下载
                <b>SKU 模板</b>建档（可同时建条码/品牌/分类）并导入；已有 SKU 的直接填编码。
              </li>
              <li>
                选类型 <b>LISTING_MAPPING</b> 上传补好的清单并确认导入——标识与已同步变体匹配的行会
                直接绑定该变体，不会产生重复行。
              </li>
            </ol>
          }
        />

        <SectionCard flush>
          <DataTable<ImportJob>
            rowKey="id"
            loading={jobs.isLoading}
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
            dataSource={list}
            pagination={{
              current: page,
              pageSize: 50,
              total: jobs.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个任务`,
            }}
            emptyTitle="暂无导入任务"
            emptyDescription="上传固定模板 Excel 后在此查看校验结果。"
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              onDoubleClick: () => setPreviewJob(record),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            columns={[
              {
                title: '类型',
                dataIndex: 'importType',
                width: 140,
                render: (value: string) => IMPORT_TYPE_LABEL[value] ?? value,
              },
              { title: '文件', dataIndex: 'originalFilename', ellipsis: true },
              {
                title: '状态',
                dataIndex: 'status',
                width: 110,
                render: (value: string) => (
                  <StatusBadge
                    tone={IMPORT_STATUS_META[value]?.tone ?? 'neutral'}
                    label={IMPORT_STATUS_META[value]?.label ?? value}
                    hint={value}
                    showDot={false}
                  />
                ),
              },
              { title: '总行数', dataIndex: 'totalRows', width: 80, align: 'right' },
              { title: '有效', dataIndex: 'validRows', width: 70, align: 'right' },
              { title: '无效', dataIndex: 'invalidRows', width: 70, align: 'right' },
              { title: '已导入', dataIndex: 'importedRows', width: 80, align: 'right' },
              { title: '导入失败', dataIndex: 'failedRows', width: 90, align: 'right' },
              {
                title: '操作人',
                dataIndex: 'createdByName',
                width: 100,
                render: (value: string | null) => value ?? '—',
              },
              {
                title: '时间',
                dataIndex: 'createdAt',
                width: 130,
                render: (value: string) => <RelativeTime value={value} />,
              },
            ]}
          />
        </SectionCard>
      </Space>

      <Modal
        title={`校验结果 — ${previewJob?.originalFilename ?? ''}`}
        width={860}
        open={previewJob !== null}
        onCancel={() => setPreviewJob(null)}
        footer={
          previewJob !== null && previewJob.status === 'VALIDATED'
            ? [
                <Button key="cancel" onClick={() => setPreviewJob(null)}>
                  取消
                </Button>,
                <Button
                  key="confirm"
                  type="primary"
                  loading={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate(previewJob.id)}
                >
                  确认导入 {previewJob.validRows} 行
                </Button>,
              ]
            : [
                <Button key="close" onClick={() => setPreviewJob(null)}>
                  关闭
                </Button>,
              ]
        }
      >
        {previewJob !== null && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Space size="large">
              <span>总计 {previewJob.totalRows} 行</span>
              <span>
                有效 <b style={{ color: colors.success }}>{previewJob.validRows}</b> 行
              </span>
              <span>
                无效 <b style={{ color: colors.danger }}>{previewJob.invalidRows}</b> 行
              </span>
              {previewJob.status === 'COMPLETED' && (
                <span>已导入 {previewJob.importedRows} 行</span>
              )}
            </Space>
            {(previewJob.errors ?? []).length > 0 && (
              <Table
                rowKey={(error) => `${error.row}-${error.code}-${error.field ?? ''}`}
                size="small"
                dataSource={previewJob.errors ?? []}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'Excel行', dataIndex: 'row', width: 90 },
                  {
                    title: '字段',
                    dataIndex: 'field',
                    width: 150,
                    render: (v?: string) => v ?? '—',
                  },
                  { title: '错误码', dataIndex: 'code', width: 240 },
                  { title: '说明', dataIndex: 'message' },
                ]}
              />
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}
