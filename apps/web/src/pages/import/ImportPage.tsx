import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Modal, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import { useState } from 'react';
import { useApiQuery } from '../../api/hooks';

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
  { value: 'SKU', label: 'SKU（含条码/商品）' },
  { value: 'BARCODE', label: '条码' },
  { value: 'WAREHOUSE', label: '仓库' },
  { value: 'BIN', label: '库位' },
  { value: 'LISTING_MAPPING', label: 'Listing 映射' },
  { value: 'INITIAL_INVENTORY', label: '库存初始化' },
];

const STATUS_TAG: Record<string, string> = {
  VALIDATED: 'blue',
  PENDING_IMPORT: 'orange',
  IMPORTING: 'orange',
  COMPLETED: 'green',
  FAILED: 'red',
};

/** 导入中心 (task §63/§57-§61): upload -> validate -> confirm. */
export function ImportPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [importType, setImportType] = useState('SKU');
  const [previewJob, setPreviewJob] = useState<ImportJob | null>(null);
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

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          value={importType}
          onChange={setImportType}
          options={IMPORT_TYPES}
          style={{ width: 200 }}
        />
        <Upload
          accept=".xlsx"
          showUploadList={false}
          customRequest={({ file }) =>
            uploadMutation.mutate({ file: file as File, type: importType })
          }
        >
          <Button type="primary" loading={uploadMutation.isPending}>
            上传 Excel（固定模板）
          </Button>
        </Upload>
      </Space>

      <Alert
        type="info"
        showIcon
        title="导入流程：上传 → 校验（精确到行/字段/错误码）→ 确认导入（后台队列执行）。重复的业务键（sku_code/条码/仓库编码等）会被拒绝，不会静默覆盖。"
      />

      <Typography.Title level={5}>导入任务</Typography.Title>
      <Table<ImportJob>
        rowKey="id"
        loading={jobs.isLoading}
        dataSource={jobs.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: jobs.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        onRow={(record) => ({
          onClick: () => setPreviewJob(record),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: '类型', dataIndex: 'importType', width: 130 },
          { title: '文件', dataIndex: 'originalFilename', ellipsis: true },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (value: string) => <Tag color={STATUS_TAG[value] ?? 'default'}>{value}</Tag>,
          },
          { title: '总行数', dataIndex: 'totalRows', width: 80 },
          { title: '有效', dataIndex: 'validRows', width: 70 },
          { title: '无效', dataIndex: 'invalidRows', width: 70 },
          { title: '已导入', dataIndex: 'importedRows', width: 80 },
          { title: '导入失败', dataIndex: 'failedRows', width: 80 },
          { title: '操作人', dataIndex: 'createdByName', width: 100 },
          { title: '时间', dataIndex: 'createdAt', width: 170 },
        ]}
      />

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
                有效 <b style={{ color: 'green' }}>{previewJob.validRows}</b> 行
              </span>
              <span>
                无效 <b style={{ color: 'red' }}>{previewJob.invalidRows}</b> 行
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
                    render: (v?: string) => v ?? '-',
                  },
                  { title: '错误码', dataIndex: 'code', width: 240 },
                  { title: '说明', dataIndex: 'message' },
                ]}
              />
            )}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
