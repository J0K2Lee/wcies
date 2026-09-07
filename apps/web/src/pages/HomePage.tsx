import { Card, Typography } from 'antd';
import { Link } from 'react-router';

/** Sprint 0 placeholder home page - real dashboard comes in later sprints. */
export function HomePage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
      <Card>
        <Typography.Title level={1}>WCIES</Typography.Title>
        <Typography.Paragraph>
          跨境电商综合管理系统
          <br />
          <Link to="/login">登录</Link> · <Link to="/health-test">健康检查</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
