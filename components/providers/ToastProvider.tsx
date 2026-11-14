'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

interface ToastApi {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5200);
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto animate-slide-in rounded-lg border p-3 shadow-2xl backdrop-blur ${
              t.level === 'error'
                ? 'border-red-500/50 bg-red-950/80'
                : t.level === 'warn'
                  ? 'border-amber-500/50 bg-amber-950/80'
                  : t.level === 'success'
                    ? 'border-emerald-500/50 bg-emerald-950/80'
                    : 'border-white/10 bg-[#11141d]/95'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[12px] font-bold text-white">{t.title}</div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-[11px] text-text-muted hover:text-white"
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
            {t.body ? <div className="mt-1 text-[11px] leading-relaxed text-text-secondary">{t.body}</div> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
