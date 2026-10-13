import { useMutation } from '@tanstack/react-query';
import { App, Alert, Button, Form, Input, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router';
import { apiPost } from '../../api/hooks';
import { missingTokenBlock, TokenPageShell } from './TokenPageShell';

interface PasswordFormValues {
  password: string;
  confirm: string;
}

/**
 * 邀请激活页（公开，邮件链接 /invite?token=...）：一次性完成邮箱验证 +
 * 设置初始密码。成功后账号转为启用状态，跳转登录。
 */
export function InvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { message } = App.useApp();
  const [form] = Form.useForm<PasswordFormValues>();

  const confirmMutation = useMutation({
    mutationFn: (password: string) =>
      apiPost<void>('/api/v1/auth/verify-email/confirm', { token, newPassword: password }),
    onSuccess: () => {
      void message.success('邮箱验证成功，账号已启用');
    },
    onError: (error: Error) => {
      void message.error(`验证失败: ${error.message}`);
    },
  });

  return (
    <TokenPageShell title="验证邮箱并设置密码">
      {token === '' ? (
        missingTokenBlock('也可以联系管理员重发邀请邮件。')
      ) : confirmMutation.isSuccess ? (
        <>
          <Alert
            type="success"
            showIcon
            title="邮箱验证完成"
            description="账号已启用，请使用用户名和新设置的密码登录。"
            style={{ marginBottom: 16 }}
          />
          <Link to="/login">
            <Button type="primary" block>
              前往登录
            </Button>
          </Link>
        </>
      ) : (
        <Form
          form={form}
          layout="vertical"
          disabled={confirmMutation.isPending}
          onFinish={(values) => confirmMutation.mutate(values.password)}
        >
          <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
            请为你的账号设置登录密码（至少 8 位），设置成功即完成邮箱验证。
          </Typography.Paragraph>
          <Form.Item
            name="password"
            label="登录密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, max: 128, message: '长度需为 8-128 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator: (_rule, value: string) =>
                  value === getFieldValue('password')
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={confirmMutation.isPending}>
            验证并设置密码
          </Button>
        </Form>
      )}
    </TokenPageShell>
  );
}
