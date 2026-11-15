'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { BRAND } from '@/lib/constants';
import { Icon } from '@/components/ui/Icons';
import { Btn, Card, Empty } from './shared';
import { MODULES, type ModuleId, type Overview } from './types';

import { OverviewModule } from './modules/OverviewModule';
import { OnboardingModule } from './modules/OnboardingModule';
import { LicensesModule } from './modules/LicensesModule';
import { UsersModule } from './modules/UsersModule';
import { ScannersModule } from './modules/ScannersModule';
import { CoinsModule } from './modules/CoinsModule';
import { RiskModule } from './modules/RiskModule';
import { BrandingModule } from './modules/BrandingModule';
import { SecurityModule } from './modules/SecurityModule';
import { AuthenticatorModule } from './modules/AuthenticatorModule';

/**
 * The 100%-complete Admin Command Center.
 *
 * Nine modules, every control wired to a real endpoint. State comes from
 * GET /api/admin/overview and is refetched after every mutation so the tables
 * always mirror server truth rather than optimistic guesses.
 */
export function AdminPortal() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* §3.2  Module 2 (1-Click Add Customer) is the action the owner performs
     most, so it is the module the portal opens on. */
  const [active, setActive] = useState<ModuleId>('onboarding');
  const [toastMsg, setToastMsg] = useState<{ text: string; level: 'ok' | 'warn' } | null>(null);

  const toast = useCallback((text: string, level: 'ok' | 'warn' = 'ok') => {
    setToastMsg({ text, level });
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' });
      const json = (await res.json()) as Overview & { error?: string };
      if (!json.ok) {
        setError(json.error ?? 'LOAD_FAILED');
        return;
      }
      setData(json);
      setError(null);
    } catch {
      setError('NETWORK');
    }
  }, []);

  useEffect(() => {
    void reload();
    /* Overview polls so KPI cards and live counters stay truthful. */
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const moduleDef = useMemo(() => MODULES.find((m) => m.id === active) ?? MODULES[0], [active]);

  if (error) {
    return (
      <Card title="Command Center Unavailable" icon="shieldAlert">
        <div className="space-y-3 p-4">
          <p className="text-[11.5px] text-text-secondary">
            The overview endpoint returned <span className="mono-num text-red-400">{error}</span>.
            {error === 'FORBIDDEN' ? ' Your session is not an admin session.' : ''}
          </p>
          <Btn tone="green" icon="refresh" onClick={() => void reload()}>
            Retry
          </Btn>
        </div>
      </Card>
    );
  }

  if (!data) return <LoadingSkeleton />;

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      {/* -------------------------------- sidebar ------------------------------- */}
      <aside className="w-full shrink-0 lg:w-60">
        <nav className="card sticky top-14 overflow-hidden">
          <div className="border-b border-white/[0.06] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400">Command Center</p>
            <p className="mono-num mt-0.5 text-[10px] text-text-muted">
              {BRAND.productName} · {data.systemConfig.versionBadge}
            </p>
          </div>
          <ul className="p-1.5">
            {MODULES.map((m) => {
              const on = m.id === active;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setActive(m.id)}
                    aria-current={on ? 'page' : undefined}
                    className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      on ? 'bg-amber-400/10 text-amber-300' : 'text-text-secondary hover:bg-white/[0.05] hover:text-white'
                    }`}
                  >
                    <span className="mt-px text-[12px] leading-none">{m.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold leading-tight">{m.label}</span>
                      <span className="block text-[9px] leading-tight text-text-muted">{m.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-white/[0.06] px-3 py-2">
            <p className="text-[9px] leading-relaxed text-text-muted">
              Owner · <span className="font-semibold text-text-secondary">{data.systemConfig.brandWatermark}</span>
              <br />
              <span className="mono-num">{data.systemConfig.whatsappContact}</span>
            </p>
          </div>
        </nav>
      </aside>

      {/* --------------------------------- body -------------------------------- */}
      <div className="min-w-0 flex-1">
        {/* Mobile / tablet tab strip */}
        <div className="mb-2 flex gap-1 overflow-x-auto lg:hidden">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setActive(m.id)}
              aria-current={m.id === active ? 'page' : undefined}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                m.id === active
                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                  : 'border-white/10 bg-white/[0.03] text-text-secondary'
              }`}
            >
              <span className="mr-1">{m.icon}</span>
              {m.label.split(' ')[0]}
            </button>
          ))}
        </div>

        <header className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-display flex items-center gap-2 text-[18px] font-bold leading-tight text-white">
              <span>{moduleDef.icon}</span>
              {moduleDef.label}
            </h1>
            <p className="text-[10.5px] text-text-muted">{moduleDef.blurb}</p>
          </div>
          <Btn icon="refresh" onClick={() => void reload()}>
            Refresh Data
          </Btn>
        </header>

        {active === 'overview' ? (
          <OverviewModule
            data={data}
            onQuickAction={(target) => {
              if (target === 'reseed') {
                void (async () => {
                  try {
                    const res = await fetch('/api/admin/reseed', { method: 'POST' });
                    const json = (await res.json()) as { ok: boolean; coins?: number; mode?: string };
                    toast(
                      json.ok
                        ? `Market reseeded — ${json.coins} pairs in ${json.mode} mode; warm-up restarted.`
                        : 'Reseed failed — the engine kept the previous universe.',
                      json.ok ? 'ok' : 'warn',
                    );
                  } catch {
                    toast('Network error — reseed did not run.', 'warn');
                  }
                  await reload();
                })();
                return;
              }
              setActive(target);
            }}
          />
        ) : null}
        {active === 'onboarding' ? <OnboardingModule /> : null}
        {active === 'licenses' ? <LicensesModule data={data} reload={reload} toast={toast} /> : null}
        {active === 'users' ? <UsersModule data={data} reload={reload} toast={toast} /> : null}
        {active === 'security2fa' ? <AuthenticatorModule data={data} reload={reload} toast={toast} /> : null}
        {active === 'scanners' ? <ScannersModule configs={data.scannerConfigs} reload={reload} toast={toast} /> : null}
        {active === 'coins' ? <CoinsModule data={data} reload={reload} toast={toast} /> : null}
        {active === 'risk' ? <RiskModule data={data} reload={reload} toast={toast} /> : null}
        {active === 'branding' ? <BrandingModule systemConfig={data.systemConfig} reload={reload} toast={toast} /> : null}
        {active === 'security' ? <SecurityModule data={data} reload={reload} toast={toast} /> : null}
      </div>

      {/* --------------------------------- toast -------------------------------- */}
      {toastMsg ? (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-[300] max-w-[92vw] -translate-x-1/2 rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-xl ${
            toastMsg.level === 'ok'
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
              : 'border-amber-500/50 bg-amber-500/15 text-amber-300'
          }`}
          style={{ boxShadow: '0 0 24px rgba(0,0,0,0.6)' }}
        >
          <span className="flex items-center gap-1.5">
            <Icon name={toastMsg.level === 'ok' ? 'check' : 'shieldAlert'} size={12} />
            {toastMsg.text}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="w-full shrink-0 lg:w-60">
        <div className="card h-[420px] animate-pulse bg-bg-card/50" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="card h-16 animate-pulse bg-bg-card/50" />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-[92px] animate-pulse bg-bg-card/50" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdminEmpty() {
  return <Empty>Nothing to show.</Empty>;
}
