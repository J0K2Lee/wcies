import { useMutation } from '@tanstack/react-query';
import { App, Alert, Button, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router';
import { apiPost } from '../../api/hooks';
import { missingTokenBlock, TokenPageShell } from './TokenPageShell';

/**
 * 确认更换邮箱页（公开，邮件链接 /change-email/confirm?token=...）：
 * 链接发送到了新邮箱，点击确认后新邮箱立即生效并视为已验证。
 * 采用显式按钮确认（而非打开即确认），避免邮件预取消耗一次性令牌。
 */
export function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { message } = App.useApp();

  const confirmMutation = useMutation({
    mutationFn: () => apiPost<void>('/api/v1/auth/email/change/confirm', { token }),
    onSuccess: () => {
      void message.success('登录邮箱已更换');
    },
    onError: (error: Error) => {
      void message.error(`确认失败: ${error.message}`);
    },
  });

  return (
    <TokenPageShell title="确认更换登录邮箱">
      {token === '' ? (
        missingTokenBlock('也可以在「系统管理 → 账号与安全」重新发起。')
      ) : confirmMutation.isSuccess ? (
        <>
          <Alert
            type="success"
            showIcon
            title="邮箱更换成功"
            description="今后请使用新邮箱登录并接收安全邮件。"
            style={{ marginBottom: 16 }}
          />
          <Link to="/login">
            <Button type="primary" block>
              前往登录
            </Button>
          </Link>
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
            你正在确认将某个 WCIES 账号的登录邮箱更换为本邮箱。该链接仅可使用一次， 有效期为 1
            小时。若非本人操作，请直接忽略本邮件。
          </Typography.Paragraph>
          <Button
            type="primary"
            block
            loading={confirmMutation.isPending}
            onClick={() => confirmMutation.mutate()}
          >
            确认更换邮箱
          </Button>
        </>
      )}
    </TokenPageShell>
  );
}
