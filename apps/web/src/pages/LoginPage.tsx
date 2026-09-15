import { useMutation } from '@tanstack/react-query';
import { App, Alert, Button, Card, Form, Input, Typography } from 'antd';

import { useNavigate, useSearchParams } from 'react-router';
import { apiClient } from '../api/client';

interface LoginFormValues {
  usernameOrEmail: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const expired = searchParams.get('reason') === 'expired';
  // 会话过期提示只走 Alert（表单上方），不再叠加 message 双提示（Phase 3 T6）。

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const { data, error } = await apiClient.POST('/api/v1/auth/login', {
        body: values,
      });
      if (error !== undefined) {
        throw new Error(error.error.message);
      }
      return data;
    },
    onSuccess: () => {
      void message.success('登录成功');
      // Redirect back to where the user was heading (decision 0004).
      void navigate(redirectTo && redirectTo.startsWith('/') ? redirectTo : '/', { replace: true });
    },
    onError: (error: Error) => {
      void message.error(`登录失败: ${error.message}`);
    },
  });

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          WCIES 登录
        </Typography.Title>
        {expired && (
          <Alert
            type="warning"
            title="登录已过期，请重新登录"
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Form<LoginFormValues>
          layout="vertical"
          onFinish={(values) => loginMutation.mutate(values)}
          disabled={loginMutation.isPending}
        >
          <Form.Item
            name="usernameOrEmail"
            label="用户名 / 邮箱"
            rules={[{ required: true, message: '请输入用户名或邮箱' }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loginMutation.isPending}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
