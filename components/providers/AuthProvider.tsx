'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { SessionUser, SystemConfig } from '@/lib/types';
import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';
import { clearRememberedSession, rememberSession } from '@/lib/storage';

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
  /** §1.2  Non-destructive merge of the disclaimer acknowledgement only. */
  markDisclaimerAccepted: () => void;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(DEFAULT_SYSTEM_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * §1.3  A failed session refresh must NEVER clear the session.
   *
   * The old implementation called `setUser(null)` in its catch block, and the
   * route guard turns a null user into `router.replace('/login')` — so a
   * single transient network blip (backgrounded tab, flaky Wi-Fi, server
   * restart) signed the user out with no action on their part. That is the
   * "Enter the Terminal kicks me back to /login" bug.
   *
   * We only clear the session when the server definitively says there isn't
   * one (HTTP 200 with `user: null`). Transport failures keep the current
   * session object untouched.
   */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!res.ok) throw new Error(`session ${res.status}`);
      const data = (await res.json()) as { user: SessionUser | null; systemConfig?: SystemConfig };
      setUser(data.user ?? null);
      if (data.systemConfig) setSystemConfig({ ...DEFAULT_SYSTEM_CONFIG, ...data.systemConfig });
    } catch {
      /* Transport/5xx — keep whatever session we already have. */
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
    if (data.user) rememberSession(data.user.username);
    return true;
  }, []);

  /**
   * §1.2  Merge ONLY the disclaimer fields into the existing session.
   * Everything else — role, plan, licenseKey and all five entitlement flags —
   * is carried over untouched, so accepting the disclaimer can never downgrade
   * or lock the user out of scanners they are entitled to.
   */
  const markDisclaimerAccepted = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev;
      return { ...prev, acceptedDisclaimerAt: prev.acceptedDisclaimerAt ?? Date.now() };
    });
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearRememberedSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, systemConfig, loading, error, login, logout, refresh, setUser, markDisclaimerAccepted }),
    [user, systemConfig, loading, error, login, logout, refresh, markDisclaimerAccepted],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
