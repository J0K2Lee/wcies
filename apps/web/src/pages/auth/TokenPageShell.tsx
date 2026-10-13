import { ReactNode } from 'react';
import { Card, Typography } from 'antd';

/** Centered card shell shared by the public email-link pages (login style). */
export function TokenPageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          {title}
        </Typography.Title>
        {children}
      </Card>
    </div>
  );
}

/** Shown when the link has no token parameter (broken / truncated link). */
export function missingTokenBlock(retryHint: string): ReactNode {
  return (
    <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
      链接缺少验证参数，请从邮件中重新打开完整链接。{retryHint}
    </Typography.Paragraph>
  );
}
