import { useMutation } from '@tanstack/react-query';
import { App, Alert, Button, Form, Input } from 'antd';
import { Link } from 'react-router';
import { apiPost, useApiQuery } from '../../api/hooks';
import { colors, PageHeader, SectionCard, StatusBadge } from '../../design-system';

interface MeData {
  id: string;
  username: string;
  email: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
}

interface EmailChangeValues {
  newEmail: string;
  password: string;
}

/**
 * 账号与安全（docs/business-rules/users.md）：通过已验证邮箱自助修改登录
 * 密码与登录邮箱。两个流程都由邮箱验证链接完成最终确认，本页只负责发起。
 */
export function AccountSecurityPage() {
  const { message } = App.useApp();
  const me = useApiQuery<{ data: MeData }>('/api/v1/auth/me', {}, ['auth-me']);
  const profile = me.data?.data;

  const passwordRequest = useMutation({
    mutationFn: () => apiPost<void>('/api/v1/auth/password/change/request', {}),
    onSuccess: () => {
      void message.success('重置链接已发送到你的邮箱，请在 30 分钟内完成操作', 5);
    },
    onError: (error: Error) => {
      void message.error(`发送失败: ${error.message}`);
    },
  });

  const emailRequest = useMutation({
    mutationFn: (values: EmailChangeValues) =>
      apiPost<void>('/api/v1/auth/email/change/request', values),
    onSuccess: () => {
      void message.success('验证链接已发送到新邮箱，请在 1 小时内确认更换', 5);
    },
    onError: (error: Error) => {
      void message.error(`发送失败: ${error.message}`);
    },
  });

  const emailVerified = profile?.emailVerified ?? false;

  return (
    <div>
      <PageHeader
        title="账号与安全"
        description="通过已验证邮箱修改登录密码与登录邮箱；最终确认在邮件链接中完成。"
      />

      {profile !== undefined && !emailVerified && (
        <Alert
          type="warning"
          showIcon
          title="当前邮箱未验证"
          description={
            profile.email === null
              ? '当前账号未绑定邮箱，请联系管理员重新发送邀请或更换邮箱后才能自助修改密码/邮箱。'
              : `邮箱 ${profile.email} 尚未验证，无法通过邮箱自助修改密码/邮箱。`
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <SectionCard title="修改登录密码">
        <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 12px' }}>
          系统将向你的已验证邮箱 <b>{profile?.email ?? '—'}</b> 发送一次性重置链接（有效期 30
          分钟）。点击链接后设置新密码，修改成功后其他已登录会话将失效。
        </p>
        <Button
          type="primary"
          loading={passwordRequest.isPending}
          disabled={!emailVerified}
          onClick={() => passwordRequest.mutate()}
        >
          发送重置链接
        </Button>
      </SectionCard>

      <SectionCard title="修改登录邮箱">
        <p style={{ fontSize: 13, margin: '0 0 12px' }}>
          需要输入当前密码确认身份；验证链接将发送到
          <b>新邮箱</b>
          ，在新邮箱中点击确认后完成更换，新邮箱即时生效并视为已验证。
        </p>
        <EmailChangeForm
          disabled={!emailVerified}
          loading={emailRequest.isPending}
          onSubmit={(values) => emailRequest.mutate(values)}
        />
      </SectionCard>

      <SectionCard title="当前账号">
        <p style={{ fontSize: 13, margin: 0 }}>
          用户名 {profile?.username ?? '—'} · 角色 {profile?.role ?? '—'} · 邮箱验证状态{' '}
          <StatusBadge
            tone={emailVerified ? 'success' : 'warning'}
            label={emailVerified ? '已验证' : '未验证'}
            showDot={false}
          />
          。用户列表由管理员在 <Link to="/system/users">用户管理</Link> 维护。
        </p>
      </SectionCard>
    </div>
  );
}

function EmailChangeForm({
  disabled,
  loading,
  onSubmit,
}: {
  disabled: boolean;
  loading: boolean;
  onSubmit: (values: EmailChangeValues) => void;
}) {
  const [form] = Form.useForm<EmailChangeValues>();
  return (
    <Form form={form} layout="vertical" disabled={disabled || loading} style={{ maxWidth: 420 }}>
      <Form.Item
        name="newEmail"
        label="新邮箱"
        rules={[
          { required: true, message: '请输入新邮箱' },
          { type: 'email', message: '邮箱格式不正确' },
        ]}
      >
        <Input autoComplete="off" placeholder="new-mailbox@example.com" />
      </Form.Item>
      <Form.Item
        name="password"
        label="当前密码"
        rules={[{ required: true, message: '请输入当前登录密码' }]}
      >
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Button
        type="primary"
        loading={loading}
        onClick={() => {
          void form.validateFields().then((values) => onSubmit(values));
        }}
      >
        发送验证链接到新邮箱
      </Button>
    </Form>
  );
}
