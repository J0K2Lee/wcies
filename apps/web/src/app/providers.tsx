import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { wciesTheme } from '../design-system';
import { isAuthError } from '../api/hooks';

/**
 * Session-expiry handling (decision 0004): a 401 on any GET means the cookie
 * session is gone - retrying would only fetch another 401, so queries stop,
 * the cache is dropped and the user lands on /login with a redirect back
 * (the login route's own 401 - wrong password - never passes through here
 * because it is a mutation handled inside LoginPage).
 */
function handleAuthExpiry(): void {
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?reason=expired&redirect=${redirect}`);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isAuthError(error)) {
          return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (isAuthError(error)) {
        queryClient.clear();
        handleAuthExpiry();
      }
    },
  }),
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
        {/* autoInsertSpace=false：双字按钮文案（如「登录」）禁止自动加空格（UI 规范 §3.4）。 */}
        <ConfigProvider locale={zhCN} theme={wciesTheme} button={{ autoInsertSpace: false }}>
          <AntdApp>
            <BrowserRouter>{children}</BrowserRouter>
          </AntdApp>
        </ConfigProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
