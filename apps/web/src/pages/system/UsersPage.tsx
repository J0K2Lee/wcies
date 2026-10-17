import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Form, Input, Modal, Popconfirm, Select, Space } from 'antd';
import { apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import {
  colors,
  DataTable,
  ErrorState,
  PageHeader,
  RelativeTime,
  SectionCard,
  StatusBadge,
  typography,
} from '../../design-system';

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
}

interface CreateUserResult {
  user: UserRow;
  inviteSent: boolean;
  inviteError: string | null;
}

interface CreateUserValues {
  username: string;
  email: string;
  role: string;
}

const USER_STATUS_META: Record<string, { tone: 'success' | 'warning' | 'neutral'; label: string }> =
  {
    ACTIVE: { tone: 'success', label: '启用' },
    PENDING_VERIFICATION: { tone: 'warning', label: '待邮箱验证' },
    DISABLED: { tone: 'neutral', label: '已停用' },
  };

/**
 * 用户管理（docs/business-rules/users.md）：管理员添加用户（邀请邮件验证）、
 * 停用/启用、重发邀请。写操作仅对 ADMIN 开放，后端 AdminGuard 兜底。
 */
export function UsersPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const users = useApiQuery<{ data: UserRow[] }>('/api/v1/users', {}, ['users-list']);
  const me = useApiQuery<{ data: { id: string; role: string } }>('/api/v1/auth/me', {}, [
    'auth-me',
  ]);
  const myId = me.data?.data.id;
  const isAdmin = me.data?.data.role === 'ADMIN';

  const createMutation = useMutation({
    mutationFn: (values: CreateUserValues) => apiPost<CreateUserResult>('/api/v1/users', values),
    onSuccess: (result) => {
      if (result.inviteSent) {
        void message.success(`用户 ${result.user.username} 已创建，邀请邮件已发送`);
      } else {
        void message.warning(
          `用户 ${result.user.username} 已创建，但邀请邮件未发出：${result.inviteError ?? '未知原因'}。可稍后使用行内「重发邀请」。`,
          6,
        );
      }
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (error: Error) => {
      void message.error(`创建失败: ${error.message}`);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DISABLED' }) =>
      apiPatch<UserRow>('/api/v1/users/{id}/status', { status }, { id }),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (error: Error) => {
      void message.error(`操作失败: ${error.message}`);
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => apiPost<UserRow>('/api/v1/users/{id}/resend-invite', {}, { id }),
    onSuccess: (user) => {
      void message.success(`邀请邮件已重新发送至 ${user.email ?? ''}`);
    },
    onError: (error: Error) => {
      void message.error(`重发失败: ${error.message}`);
    },
  });

  const columns = useMemo(
    () => [
      {
        title: '用户名',
        dataIndex: 'username',
        width: 160,
        render: (value: string) => (
          <span style={{ fontWeight: 550, color: colors.textPrimary }}>{value}</span>
        ),
      },
      {
        title: '邮箱',
        dataIndex: 'email',
        render: (value: string | null, record: UserRow) => (
          <Space size={6}>
            <span style={{ fontFamily: typography.monoFamily, fontSize: 12.5 }}>
              {value ?? '—'}
            </span>
            {value !== null && !record.emailVerified && (
              <StatusBadge tone="neutral" label="未验证" showDot={false} />
            )}
          </Space>
        ),
      },
      {
        title: '角色',
        dataIndex: 'role',
        width: 110,
        render: (value: string) => (value === 'ADMIN' ? '管理员' : '操作员'),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 130,
        render: (value: string) => (
          <StatusBadge
            tone={USER_STATUS_META[value]?.tone ?? 'neutral'}
            label={USER_STATUS_META[value]?.label ?? value}
            hint={value}
          />
        ),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        width: 160,
        render: (value: string) => <RelativeTime value={value} />,
      },
      {
        title: '操作',
        key: 'actions',
        width: 190,
        render: (_: unknown, record: UserRow) => {
          const disabled = record.status === 'DISABLED';
          const isSelf = record.id === myId;
          return (
            <Space size={4}>
              {record.status === 'PENDING_VERIFICATION' && (
                <Button
                  size="small"
                  type="text"
                  loading={resendMutation.isPending && resendMutation.variables === record.id}
                  onClick={() => resendMutation.mutate(record.id)}
                >
                  重发邀请
                </Button>
              )}
              <Popconfirm
                title={disabled ? '启用该账号？' : '停用该账号？'}
                description={
                  record.status === 'PENDING_VERIFICATION' && !disabled
                    ? '停用后需重新启用并完成邮箱验证才能登录。'
                    : disabled && !record.emailVerified
                      ? '重新启用后将回到「待邮箱验证」，需完成邀请验证才能登录。'
                      : disabled
                        ? '启用后即可正常登录。'
                        : '停用后该账号立即无法登录。'
                }
                okText={disabled ? '启用' : '停用'}
                cancelText="取消"
                onConfirm={() =>
                  statusMutation.mutate({ id: record.id, status: disabled ? 'ACTIVE' : 'DISABLED' })
                }
              >
                <Button size="small" type="text" disabled={isSelf && !disabled} danger={!disabled}>
                  {disabled ? '启用' : '停用'}
                </Button>
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [myId, resendMutation, statusMutation],
  );

  return (
    <div>
      <PageHeader
        title="用户管理"
        description="添加用户（经邮箱验证激活）、停用/启用账号。验证邮件通过系统邮箱发送。"
        extra={
          isAdmin ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              添加用户
            </Button>
          ) : undefined
        }
      />

      {!isAdmin && me.data !== undefined && (
        <Alert
          type="warning"
          showIcon
          title="仅管理员可以管理用户"
          description="当前账号角色不是 ADMIN，以下列表仅供参考，写操作会被拒绝。"
          style={{ marginBottom: 16 }}
        />
      )}

      <SectionCard flush>
        {users.isError ? (
          <ErrorState
            description={(users.error as Error | null)?.message}
            onRetry={() => void users.refetch()}
            retrying={users.isFetching}
          />
        ) : (
          <DataTable<UserRow>
            rowKey="id"
            loading={users.isLoading}
            error={users.error}
            onRetry={() => void users.refetch()}
            dataSource={users.data?.data ?? []}
            columns={columns}
            emptyTitle="暂无用户"
            emptyDescription="点击右上角「添加用户」创建第一个账号"
            pagination={{ pageSize: 50, showSizeChanger: false }}
          />
        )}
      </SectionCard>

      <CreateUserModal
        open={createOpen}
        confirmLoading={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values)}
      />
    </div>
  );
}

function CreateUserModal({
  open,
  confirmLoading,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  confirmLoading: boolean;
  onCancel: () => void;
  onSubmit: (values: CreateUserValues) => void;
}) {
  const [form] = Form.useForm<CreateUserValues>();
  return (
    <Modal
      title="添加用户"
      open={open}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText="创建并发送邀请"
      cancelText="取消"
      destroyOnHidden
      onOk={() => {
        void form.validateFields().then((values) => onSubmit(values));
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ role: 'OPERATOR' }}
        disabled={confirmLoading}
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[
            { required: true, message: '请输入用户名' },
            { min: 3, max: 100, message: '3-100 个字符' },
          ]}
        >
          <Input autoComplete="off" placeholder="登录用户名，如 ops-alice" />
        </Form.Item>
        <Form.Item
          name="email"
          label="邮箱"
          extra="邀请邮件将发送到该地址，收件人验证后设置初始密码"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input autoComplete="off" placeholder="name@example.com" />
        </Form.Item>
        <Form.Item name="role" label="角色" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'OPERATOR', label: '操作员' },
              { value: 'ADMIN', label: '管理员' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
