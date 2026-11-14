'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { SessionUser, SystemConfig } from '@/lib/types';
import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';

export interface LoginPayload {
  username: string;
  password: string;
  licenseKey: string;
}

interface AuthApi {
  user: SessionUser | null;
  systemConfig: SystemConfig;
  loading: boolean;
  error: string | null;
  login: (payload: LoginPayload) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: SessionUser) => void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(DEFAULT_SYSTEM_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = (await res.json()) as { user: SessionUser | null; systemConfig?: SystemConfig };
      setUser(data.user ?? null);
      if (data.systemConfig) setSystemConfig({ ...DEFAULT_SYSTEM_CONFIG, ...data.systemConfig });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (payload: LoginPayload) => {
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; message?: string; user?: SessionUser };
    if (!data.ok) {
      setError(data.message ?? 'Login failed.');
      return false;
    }
    setUser(data.user ?? null);
    return true;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, systemConfig, loading, error, login, logout, refresh, setUser }),
    [user, systemConfig, loading, error, login, logout, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
