import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Descriptions, Spin, Typography } from 'antd';
import { apiClient } from '../api/client';

/**
 * Sprint 0 wiring check: web -> generated api-client -> GET /health on the API.
 */
export function HealthTestPage() {
  const liveness = useQuery({
    queryKey: ['health', 'live'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/health');
      if (error !== undefined) {
        throw new Error('Health request failed');
      }
      return data;
    },
  });

  const readiness = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/health/ready');
      if (error !== undefined) {
        throw new Error('Readiness request failed');
      }
      return data;
    },
  });

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
      <Card style={{ width: 640 }}>
        <Typography.Title level={3}>Health Check 测试</Typography.Title>

        <Card type="inner" title="GET /health/live" style={{ marginBottom: 16 }}>
          {liveness.isPending ? <Spin /> : null}
          {liveness.isError ? (
            <Alert type="error" title={`请求失败: ${liveness.error.message}`} />
          ) : null}
          {liveness.data !== undefined ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="status">
                {String(liveness.data.data.status)}
              </Descriptions.Item>
            </Descriptions>
          ) : null}
        </Card>

        <Card type="inner" title="GET /health/ready">
          {readiness.isPending ? <Spin /> : null}
          {readiness.isError ? (
            <Alert type="error" title={`请求失败: ${readiness.error.message}`} />
          ) : null}
          {readiness.data !== undefined ? (
            <Descriptions column={1} size="small">
              <Descriptions.Item label="status">
                {String(readiness.data.data.status)}
              </Descriptions.Item>
              <Descriptions.Item label="postgres">
                {String(readiness.data.data.checks.postgres)}
              </Descriptions.Item>
              <Descriptions.Item label="redis">
                {String(readiness.data.data.checks.redis)}
              </Descriptions.Item>
            </Descriptions>
          ) : null}
        </Card>
      </Card>
    </div>
  );
}
