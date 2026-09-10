import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { wciesTheme } from '../design-system';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/**
 * Single place where global providers are initialized (Sprint 0 task §8):
 * TanStack Query, Router, the one WCIES AntD theme (redesign task §11),
 * Error Boundary. Pages must never nest their own ConfigProvider theme.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={zhCN} theme={wciesTheme}>
          <AntdApp>
            <BrowserRouter>{children}</BrowserRouter>
          </AntdApp>
        </ConfigProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
