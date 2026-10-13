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
 * 重置密码页（公开，邮件链接 /reset-password?token=...）：链接本身即身份
 * 凭证，在此设置新密码。成功后所有修改前签发的登录会话全部失效。
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { message } = App.useApp();
  const [form] = Form.useForm<PasswordFormValues>();

  const confirmMutation = useMutation({
    mutationFn: (password: string) =>
      apiPost<void>('/api/v1/auth/password/change/confirm', { token, newPassword: password }),
    onSuccess: () => {
      void message.success('密码已重置');
    },
    onError: (error: Error) => {
      void message.error(`重置失败: ${error.message}`);
    },
  });

  return (
    <TokenPageShell title="重置登录密码">
      {token === '' ? (
        missingTokenBlock('也可以在「系统管理 → 账号与安全」重新发起。')
      ) : confirmMutation.isSuccess ? (
        <>
          <Alert
            type="success"
            showIcon
            title="密码重置成功"
            description="请使用新密码重新登录；其他设备上的旧会话已全部失效。"
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
            该链接仅可使用一次，有效期为 30 分钟。
          </Typography.Paragraph>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, max: 128, message: '长度需为 8-128 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
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
            重置密码
          </Button>
        </Form>
      )}
    </TokenPageShell>
  );
}
