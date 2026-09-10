import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Spin } from 'antd';
import { colors } from '../design-system';
import { apiClient } from '../api/client';

export interface CurrentUser {
  id: string;
  username: string;
  role: string;
}

interface AuthContextValue {
  user: CurrentUser;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Current session user; only reachable below AuthGate (decision 0004). */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used inside AuthGate');
  }
  return value;
}

/** Layout-route auth gate (decision 0004): guards every nested route. */
export function AuthGate() {
  const location = useLocation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data: body, error } = await apiClient.GET('/api/v1/auth/me');
      if (error !== undefined) {
        throw new Error(error.error.code);
      }
      return body.data;
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          background: colors.canvas,
        }}
      >
        <Spin size="large" />
        <span style={{ color: colors.textTertiary, fontSize: 13 }}>正在验证登录状态…</span>
      </div>
    );
  }

  if (isError || data === undefined) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirectTo}`} replace />;
  }

  return (
    <AuthContext.Provider value={{ user: data }}>
      <Outlet />
    </AuthContext.Provider>
  );
}
