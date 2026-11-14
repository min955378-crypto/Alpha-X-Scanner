'use client';

import { useCallback, useEffect, useState } from 'react';

import { BRAND, LOGIN_CAROUSEL } from '@/lib/constants';
import { formatDateShort, formatPct } from '@/lib/format';
import { planLabel } from '@/lib/license';
import { SCANNERS, TIMEFRAMES, type AuditLogRow, type EntitlementKey, type LicenseKeyRow, type ScannerConfigRow, type ScannerSlug, type SystemConfig, type SystemHealth, type Timeframe } from '@/lib/types';
import { CopyButton, Pill, Segmented, Toggle } from '@/components/ui';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/providers/ToastProvider';

/**
 * §10  Complete Admin Portal — 7 modules.
 * Only reachable when `user.role === 'ADMIN'` (AppShell also guards the route).
 */

interface CoinRow {
  symbol: string;
  baseAsset: string;
  enabled: boolean;
  isMonitoringTag: boolean;
  price: number;
  changePct24h: number;
  quoteVol24h: number;
}

interface UserRow {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
  plan: 'LITE' | 'ULTRA_PRO';
  isSuspended: boolean;
  entitlements: Record<EntitlementKey, boolean>;
  licenseKey: string | null;
  createdAt: number;
}

interface Overview {
  health: SystemHealth;
  users: UserRow[];
  licenses: LicenseKeyRow[];
  coins: CoinRow[];
  scannerConfigs: ScannerConfigRow[];
  auditLogs: AuditLogRow[];
  systemConfig: SystemConfig;
  riskCount: number;
}

const MODULES = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: '👥 Users' },
  { id: 'licenses', label: '🔑 Licenses' },
  { id: 'coins', label: '🪙 Coins' },
  { id: 'scanners', label: 'Scanner Math' },
  { id: 'risk', label: '⚠ Risk Watch' },
  { id: 'branding', label: '📢 Branding' },
] as const;

type ModuleId = (typeof MODULES)[number]['id'];

export function AdminPortal() {
  const { push } = useToast();
  const [active, setActive] = useState<ModuleId>('overview');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [riskCount, setRiskCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' });
      const json = (await res.json()) as Omit<Overview, 'riskCount'> & { riskItems: unknown[] };
      setData({ ...json, riskCount: json.riskItems?.length ?? 0 });
      setRiskCount(json.riskItems?.length ?? 0);
    } catch {
      push({ title: 'Admin data unavailable', level: 'error' });
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; error?: string; keys?: string[] };
    if (!json.ok) {
      push({ title: 'Action failed', body: json.error ?? 'Unknown error', level: 'error' });
      return json;
    }
    await load();
    return json;
  };

  return (
    <div className="space-y-3">
      <header className="card p-3">
        <h1 className="text-[18px] font-bold text-white">🛠 Admin Portal</h1>
        <p className="mt-1 text-[11.5px] text-text-secondary">
          System overview, user entitlements, license generation, coin overrides, scanner math tuning, Risk Watch CMS
          control and branding.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={active === m.id}
              onClick={() => setActive(m.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active === m.id
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {loading && !data ? <Skeleton /> : null}

      {data ? (
        <>
          {active === 'overview' ? <OverviewModule data={data} riskCount={riskCount} onRefresh={load} /> : null}
          {active === 'users' ? <UsersModule data={data} mutate={mutate} /> : null}
          {active === 'licenses' ? <LicensesModule data={data} mutate={mutate} /> : null}
          {active === 'coins' ? <CoinsModule data={data} mutate={mutate} /> : null}
          {active === 'scanners' ? <ScannersModule data={data} mutate={mutate} /> : null}
          {active === 'risk' ? <RiskModule data={data} mutate={mutate} onReload={load} /> : null}
          {active === 'branding' ? <BrandingModule data={data} mutate={mutate} /> : null}
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1 — System overview                                                        */
/* -------------------------------------------------------------------------- */

function OverviewModule({ data, riskCount, onRefresh }: { data: Overview; riskCount: number; onRefresh: () => void }) {
  const h = data.health;
  const weightPct = Math.min(100, (h.binanceWeightUsed / h.binanceWeightCap) * 100);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Total Users" value={h.totalUsers} />
        <Kpi label="Active License Keys" value={data.licenses.filter((l) => l.status === 'ACTIVE').length} />
        <Kpi label="Online WS Clients" value={h.onlineWsClients} />
        <Kpi label="Coins Tracked" value={h.coinsTracked} />
      </div>

      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-bold text-white">Data Plane Health</h2>
          <button type="button" onClick={onRefresh} className="btn-ghost">
            ↻ Refresh
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <HealthRow label="Mode" value={h.dataMode} tone={h.dataMode === 'LIVE' ? 'green' : 'amber'} />
            <HealthRow label="Phase A (limit=99, weight 1)" value={h.phaseAReady ? 'READY' : 'SEEDING'} tone={h.phaseAReady ? 'green' : 'amber'} />
            <HealthRow label="Phase B (limit=500, weight 5)" value={h.phaseBReady ? 'READY' : 'BACKFILLING'} tone={h.phaseBReady ? 'green' : 'amber'} />
            <HealthRow label="Scan cycle" value={`#${h.scanCycle}`} />
            <HealthRow label="Uptime" value={`${Math.floor(h.uptimeSec / 60)}m ${h.uptimeSec % 60}s`} />
            <HealthRow label="Heap" value={`${h.heapUsedMb} MB`} />
          </div>

          <div className="space-y-2">
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-text-secondary">Binance REST weight (last min)</span>
                <span className="mono-num text-white">
                  {h.binanceWeightUsed} / {h.binanceWeightCap}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full ${weightPct > 80 ? 'bg-red-500' : weightPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${weightPct}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-text-muted">
                Budget is 20% of Binance&apos;s 6,000/min IP cap. Phase A costs 1 weight/coin; Phase B costs 5.
              </p>
            </div>

            <div>
              <div className="mb-1 text-[11px] text-text-secondary">WebSocket pool</div>
              <div className="mono-num rounded bg-white/[0.03] p-2 text-[10.5px] text-text-bright">
                <div>connections: {h.wsPool.connections}</div>
                <div>streams: {h.wsPool.streams.toLocaleString()} (!miniTicker@arr + {Object.keys(h.wsPool.subscriptions).length} kline TF)</div>
                <div>subscriptions: {JSON.stringify(h.wsPool.subscriptions)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-3">
        <h2 className="mb-2 text-[13px] font-bold text-white">📜 Audit Log</h2>
        <div className="mono-num max-h-[240px] space-y-0.5 overflow-y-auto text-[10.5px]">
          {data.auditLogs.length === 0 ? <div className="text-text-muted">No admin actions yet.</div> : null}
          {data.auditLogs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-text-muted">{new Date(l.createdAt).toLocaleString('en-US', { hour12: false })}</span>
              <span className="font-semibold text-amber-400">{l.adminUsername}</span>
              <span className="text-text-secondary">{l.action}</span>
              {l.targetId ? <span className="text-text-muted">{l.targetId.slice(0, 12)}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="mono-num text-[22px] font-extrabold leading-none text-white">{value}</div>
      <div className="mt-1 text-[10.5px] font-semibold text-text-secondary">{label}</div>
    </div>
  );
}

function HealthRow({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : tone === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-white/[0.03] px-2 py-1.5 text-[11px]">
      <span className="text-text-secondary">{label}</span>
      <span className={`mono-num font-semibold ${color}`}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2 — Users & entitlements                                                   */
/* -------------------------------------------------------------------------- */

function UsersModule({ data, mutate }: { data: Overview; mutate: (u: string, b: unknown) => Promise<{ keys?: string[] }> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const { push } = useToast();

  return (
    <div className="space-y-3">
      <div className="card grid gap-2 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="input" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="input" />
        <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp (optional)" className="input mono-num" />
        <button
          type="button"
          onClick={async () => {
            const res = await mutate('/api/admin/users', { action: 'create', username, password, whatsappNumber: whatsapp });
            if (res && !('error' in res && res.error)) {
              push({ title: 'User created', body: username, level: 'success' });
              setUsername('');
              setPassword('');
              setWhatsapp('');
            }
          }}
          className="btn-green whitespace-nowrap"
        >
          + Create user
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="bg-bg-card-2 text-[10.5px] font-bold text-text-secondary">
            <tr>
              <th className="px-2 py-1.5 text-left">User</th>
              <th className="px-2 py-1.5 text-left">Plan</th>
              <th className="px-2 py-1.5 text-left">License</th>
              {SCANNERS.map((s) => (
                <th key={s.slug} className="px-1 py-1.5 text-center" title={s.name}>
                  {s.emoji}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-b border-white/[0.03]">
                <td className="px-2 py-1.5">
                  <div className="select-all font-bold text-white">{u.username}</div>
                  <div className="text-[10px] text-text-muted">
                    {u.role} · joined {formatDateShort(u.createdAt, 'UTC')}
                    {u.isSuspended ? ' · SUSPENDED' : ''}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <Pill tone={u.plan === 'ULTRA_PRO' ? 'green' : 'gray'}>{planLabel()}</Pill>
                </td>
                <td className="px-2 py-1.5">
                  {u.licenseKey ? (
                    <span className="inline-flex items-center gap-1">
                      <code className="mono-num select-all text-[10.5px] text-amber-300">{u.licenseKey}</code>
                      <CopyButton value={u.licenseKey} label="key" compact />
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                {SCANNERS.map((s) => (
                  <td key={s.slug} className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      aria-pressed={u.entitlements[s.entitlementKey]}
                      aria-label={`${s.name} for ${u.username}`}
                      onClick={() =>
                        void mutate('/api/admin/users', {
                          action: 'toggle-entitlement',
                          userId: u.id,
                          entitlement: s.entitlementKey,
                          value: !u.entitlements[s.entitlementKey],
                        })
                      }
                      className={`h-4 w-4 rounded border ${
                        u.entitlements[s.entitlementKey] ? 'border-emerald-500 bg-emerald-500/40' : 'border-white/20 bg-white/[0.04]'
                      }`}
                    >
                      {u.entitlements[s.entitlementKey] ? <span className="text-[9px] text-emerald-300">✓</span> : null}
                    </button>
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void mutate('/api/admin/users', { action: 'grant-full', userId: u.id })}
                      className="btn-ghost px-1.5 py-0.5 text-[10px]"
                    >
                      Grant Full Alpha X Pro
                    </button>
                    <button
                      type="button"
                      onClick={() => void mutate('/api/admin/users', { action: 'suspend', userId: u.id, value: !u.isSuspended })}
                      className="btn-red px-1.5 py-0.5 text-[10px]"
                    >
                      {u.isSuspended ? 'Unsuspend' : 'Suspend'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3 — License generator                                                      */
/* -------------------------------------------------------------------------- */

function LicensesModule({ data, mutate }: { data: Overview; mutate: (u: string, b: unknown) => Promise<{ keys?: string[] }> }) {
  const [count, setCount] = useState(5);
  const [duration, setDuration] = useState(30);
  const [plan, setPlan] = useState<'LITE' | 'ULTRA_PRO'>('ULTRA_PRO');
  const [generated, setGenerated] = useState<string[]>([]);

  const welcome = (key: string) =>
    `Assalam-o-Alaikum! Your Alpha X Scanner access is ready.\nLicense Key: ${key}\nUsername: <set by you>\nOpen: https://alpha-x-scanner.com/login\nYour key unlocks all five institutional scanners.\n— ${BRAND.brandWatermark} (${BRAND.whatsappContact})`;

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <h2 className="text-[13px] font-bold text-white">🔑 Batch generator</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-text-secondary">Count (1–50)</span>
            <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-text-secondary">Duration</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input">
              <option value={7}>7d Trial</option>
              <option value={30}>30d Alpha X Pro</option>
              <option value={90}>90d Alpha X Pro</option>
              <option value={3650}>Lifetime</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-text-secondary">Plan</span>
            <select value={plan} onChange={(e) => setPlan(e.target.value as 'LITE' | 'ULTRA_PRO')} className="input">
              <option value="ULTRA_PRO">Alpha X Pro (all 5 scanners)</option>
              <option value="LITE">Lite (V1 Scaling only)</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          onClick={async () => {
            const res = await mutate('/api/admin/licenses', { action: 'generate', count, durationDays: duration, plan });
            if (res?.keys) setGenerated(res.keys);
          }}
          className="btn-green"
        >
          Generate keys
        </button>

        {generated.length > 0 ? (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10.5px] font-bold text-emerald-400">{generated.length} keys generated</span>
              <CopyButton value={generated.join('\n')} label="all keys" />
            </div>
            <ul className="space-y-1">
              {generated.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <code className="mono-num select-all text-[11.5px] text-white">{k}</code>
                  <span className="flex gap-1">
                    <CopyButton value={k} label="key" compact />
                    <CopyButton value={welcome(k)} label="WhatsApp welcome" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="bg-bg-card-2 text-[10.5px] font-bold text-text-secondary">
            <tr>
              <th className="px-2 py-1.5 text-left">Key</th>
              <th className="px-2 py-1.5 text-left">Plan</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Assigned</th>
              <th className="px-2 py-1.5 text-left">Expires</th>
              <th className="px-2 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.licenses.map((l) => (
              <tr key={l.id} className="border-b border-white/[0.03]">
                <td className="px-2 py-1.5">
                  <code className="mono-num select-all text-white">{l.keyString}</code>
                </td>
                <td className="px-2 py-1.5">
                  <Pill tone={l.plan === 'ULTRA_PRO' ? 'green' : 'gray'}>{planLabel()}</Pill>
                </td>
                <td className="px-2 py-1.5">
                  <Pill tone={l.status === 'ACTIVE' ? 'green' : 'red'}>{l.status}</Pill>
                </td>
                <td className="px-2 py-1.5 text-text-secondary">{l.assignedUsername ?? '—'}</td>
                <td className="mono-num px-2 py-1.5 text-text-secondary">
                  {l.expiresAt ? formatDateShort(l.expiresAt, 'UTC') : 'not activated'}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end gap-1">
                    <CopyButton value={l.keyString} label="key" compact />
                    <button
                      type="button"
                      disabled={l.status !== 'ACTIVE'}
                      onClick={() => void mutate('/api/admin/licenses', { action: 'revoke', licenseId: l.id })}
                      className="btn-red px-1.5 py-0.5 text-[10px] disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4 — Coin universe                                                          */
/* -------------------------------------------------------------------------- */

function CoinsModule({ data, mutate }: { data: Overview; mutate: (u: string, b: unknown) => Promise<unknown> }) {
  const [query, setQuery] = useState('');
  const [onlyTagged, setOnlyTagged] = useState(false);

  const rows = data.coins
    .filter((c) => (query ? c.symbol.includes(query.toUpperCase()) || c.baseAsset.includes(query.toUpperCase()) : true))
    .filter((c) => (onlyTagged ? c.isMonitoringTag : true))
    .slice(0, 300);

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          data-search-input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any *USDT pair"
          className="input mono-num w-[240px]"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <input type="checkbox" checked={onlyTagged} onChange={(e) => setOnlyTagged(e.target.checked)} className="h-3 w-3 accent-amber-500" />
          Only ⚠ Monitoring Tag coins
        </label>
        <span className="mono-num text-[10.5px] text-text-muted">
          {rows.length} shown · {data.coins.length} tracked
        </span>
      </div>

      <div className="card max-h-[520px] overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 bg-bg-card-2 text-[10.5px] font-bold text-text-secondary">
            <tr>
              <th className="px-2 py-1.5 text-left">Symbol</th>
              <th className="px-2 py-1.5 text-right">Price</th>
              <th className="px-2 py-1.5 text-right">24h %</th>
              <th className="px-2 py-1.5 text-center">Enabled</th>
              <th className="px-2 py-1.5 text-center">⚠ Tag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.symbol} className="border-b border-white/[0.03]">
                <td className="px-2 py-1.5">
                  <span className="select-all font-bold text-white">{c.baseAsset}</span>
                  <span className="text-[10px] text-text-muted">/USDT</span>
                </td>
                <td className="mono-num px-2 py-1.5 text-right">{c.price < 1 ? c.price.toPrecision(4) : c.price.toFixed(2)}</td>
                <td className={`mono-num px-2 py-1.5 text-right ${c.changePct24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPct(c.changePct24h, 1)}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => void mutate('/api/admin/coins', { symbol: c.symbol, enabled: !c.enabled })}
                    aria-pressed={c.enabled}
                    className={`h-4 w-4 rounded border ${c.enabled ? 'border-emerald-500 bg-emerald-500/40' : 'border-white/20 bg-white/[0.04]'}`}
                    aria-label={`${c.enabled ? 'Disable' : 'Enable'} ${c.symbol}`}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => void mutate('/api/admin/coins', { symbol: c.symbol, isMonitoringTag: !c.isMonitoringTag })}
                    aria-pressed={c.isMonitoringTag}
                    className={`h-4 w-4 rounded border ${c.isMonitoringTag ? 'border-amber-500 bg-amber-500/40' : 'border-white/20 bg-white/[0.04]'}`}
                    aria-label={`${c.isMonitoringTag ? 'Clear' : 'Set'} monitoring tag on ${c.symbol}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5 — Scanner math                                                           */
/* -------------------------------------------------------------------------- */

function ScannersModule({ data, mutate }: { data: Overview; mutate: (u: string, b: unknown) => Promise<unknown> }) {
  const [editing, setEditing] = useState<ScannerSlug>(data.scannerConfigs[0]?.slug ?? 'v1-scaling');
  const [draft, setDraft] = useState<Record<string, Record<string, number>>>({});

  const cfg = data.scannerConfigs.find((c) => c.slug === editing);
  const values = { ...(cfg?.parametersJson ?? {}), ...(draft[editing] ?? {}) };

  const setParam = (key: string, value: number) =>
    setDraft((prev) => ({ ...prev, [editing]: { ...(prev[editing] ?? {}), [key]: value } }));

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap gap-1 p-3">
        {data.scannerConfigs.map((c) => (
          <button
            key={c.slug}
            type="button"
            aria-pressed={editing === c.slug}
            onClick={() => setEditing(c.slug)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              editing === c.slug
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-white/10 bg-white/[0.03] text-text-secondary hover:text-white'
            }`}
          >
            {SCANNERS.find((s) => s.slug === c.slug)?.emoji} {c.displayName}
          </button>
        ))}
      </div>

      {cfg ? (
        <div className="card space-y-3 p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-text-secondary">Display name</span>
              <input value={cfg.displayName} readOnly className="input opacity-70" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-text-secondary">Default timeframe</span>
              <select
                value={cfg.defaultTimeframe}
                onChange={(e) => void mutate('/api/admin/scanner-config', { slug: cfg.slug, defaultTimeframe: e.target.value as Timeframe })}
                className="input"
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-text-secondary">Scan interval (s)</span>
              <input
                type="number"
                defaultValue={cfg.scanIntervalSec}
                onBlur={(e) => void mutate('/api/admin/scanner-config', { slug: cfg.slug, scanIntervalSec: Number(e.target.value) })}
                className="input"
              />
            </label>
          </div>

          <Toggle
            id="scanner-enabled"
            checked={cfg.enabled}
            onChange={(v) => void mutate('/api/admin/scanner-config', { slug: cfg.slug, enabled: v })}
            label="Scanner enabled"
          />

          <div>
            <h3 className="mb-2 text-[12px] font-bold text-white">Parameters</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(values).map(([key, val]) => (
                <label key={key} className="block">
                  <span className="mono-num mb-1 block text-[10.5px] text-text-secondary">{key}</span>
                  <input
                    type="number"
                    step="any"
                    value={val}
                    onChange={(e) => setParam(key, Number(e.target.value))}
                    className="input mono-num"
                  />
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              void mutate('/api/admin/scanner-config', { slug: cfg.slug, parametersJson: draft[editing] ?? {} });
              setDraft((prev) => ({ ...prev, [editing]: {} }));
            }}
            className="btn-green"
          >
            💾 Save parameters
          </button>
          <p className="text-[10px] text-text-muted">
            Changes apply on the next 60-second scan cycle — no redeploy required.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 6 — Risk Watch CMS                                                         */
/* -------------------------------------------------------------------------- */

function RiskModule({ data, mutate, onReload }: { data: Overview; mutate: (u: string, b: unknown) => Promise<unknown>; onReload: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <h2 className="text-[13px] font-bold text-white">⚠ Binance CMS sync</h2>
        <p className="text-[11px] leading-relaxed text-text-secondary">
          Delistings are pulled from <code className="mono-num text-amber-300">catalogId=161</code> and new listings
          from <code className="mono-num text-amber-300">catalogId=48</code>. The pipeline handles all four production
          gotchas: null <code className="mono-num">publishDate</code>, server-clamped{' '}
          <code className="mono-num">pageSize</code>, null article bodies, and non-destructive upserts keyed by{' '}
          <code className="mono-num">@@unique([sourceUrl])</code>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await fetch('/api/risk-watch', { method: 'POST' });
              const json = (await res.json()) as { ok: boolean; source?: string; error?: string; retryAfterSec?: number };
              if (json.ok) push({ title: 'CMS sync complete', body: `Source: ${json.source}`, level: 'success' });
              else push({ title: 'Sync blocked', body: json.error === 'RATE_LIMITED' ? `Retry in ${json.retryAfterSec}s` : json.error, level: 'warn' });
              setBusy(false);
              onReload();
            }}
            className="btn-amber"
          >
            ↻ {busy ? 'Syncing…' : 'Trigger manual sync'}
          </button>
          <span className="mono-num text-[11px] text-text-secondary">{data.riskCount} rows stored</span>
        </div>
      </div>

      <div className="card p-3">
        <h3 className="mb-2 text-[12px] font-bold text-white">Live BAPI endpoints</h3>
        <ul className="mono-num space-y-1 text-[10.5px] text-text-secondary">
          <li className="select-all">GET /bapi/composite/v1/public/cms/article/catalog/list/query?type=1&amp;catalogId=161&amp;pageNo=1&amp;pageSize=20</li>
          <li className="select-all">GET /bapi/composite/v1/public/cms/article/catalog/list/query?type=1&amp;catalogId=48&amp;pageNo=1&amp;pageSize=20</li>
          <li className="select-all">https://www.binance.com/en/support/announcement/&lt;article.code&gt;</li>
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 7 — Branding & broadcast                                                   */
/* -------------------------------------------------------------------------- */

function BrandingModule({ data, mutate }: { data: Overview; mutate: (u: string, b: unknown) => Promise<unknown> }) {
  const [cfg, setCfg] = useState<SystemConfig>(data.systemConfig);
  const [slides, setSlides] = useState(data.systemConfig.loginCarouselJson ?? LOGIN_CAROUSEL);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const { push } = useToast();

  useEffect(() => {
    setCfg(data.systemConfig);
    setSlides(data.systemConfig.loginCarouselJson ?? LOGIN_CAROUSEL);
  }, [data.systemConfig]);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="card space-y-2 p-3">
        <h2 className="text-[13px] font-bold text-white">📢 Branding</h2>
        {(
          [
            ['versionBadge', 'Version pill'],
            ['loginPageTitle', 'Login page title'],
            ['loginSubtitle', 'Login subtitle'],
            ['brandWatermark', 'Brand watermark'],
            ['promoHeadline', 'Promo headline'],
            ['promoTagline', 'Promo tagline'],
            ['whatsappContact', 'WhatsApp contact'],
            ['tutorialVideo1Url', 'Onboarding video 1'],
            ['tutorialVideo2Url', 'Onboarding video 2'],
          ] as Array<[keyof SystemConfig, string]>
        ).map(([key, label]) => (
          <label key={String(key)} className="block">
            <span className="mb-1 block text-[10.5px] text-text-secondary">{label}</span>
            <input
              value={String(cfg[key] ?? '')}
              onChange={(e) => setCfg((prev) => ({ ...prev, [key]: e.target.value } as SystemConfig))}
              className="input"
            />
          </label>
        ))}
        <button type="button" onClick={() => void mutate('/api/admin/system-config', cfg)} className="btn-green w-full">
          💾 Save branding
        </button>
      </div>

      <div className="space-y-3">
        <div className="card space-y-2 p-3">
          <h2 className="text-[13px] font-bold text-white">🖼 Login carousel ({slides.length} slides)</h2>
          <p className="text-[10.5px] text-text-muted">
            Slide 1 is [LIVE-VERIFIED] as “🔍Smart Binance USDT Coin Scanner”. Slides 2–12 are editable copy.
          </p>
          <div className="max-h-[280px] space-y-1.5 overflow-y-auto">
            {slides.map((s, i) => (
              <div key={`${s.title}-${i}`} className="rounded border border-white/[0.06] bg-white/[0.02] p-1.5">
                <input
                  value={s.title}
                  onChange={(e) =>
                    setSlides((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                  className="input mb-1 text-[11px] font-semibold"
                  aria-label={`Slide ${i + 1} title`}
                />
                <textarea
                  value={s.body}
                  onChange={(e) => setSlides((prev) => prev.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                  className="input mono-num h-12 resize-none text-[10.5px]"
                  aria-label={`Slide ${i + 1} body`}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void mutate('/api/admin/system-config', { loginCarouselJson: slides })}
            className="btn-green w-full"
          >
            💾 Save carousel
          </button>
        </div>

        <div className="card space-y-2 p-3">
          <h2 className="text-[13px] font-bold text-white">📣 Broadcast announcement</h2>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="input" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" className="input h-16 resize-none" />
          <button
            type="button"
            onClick={async () => {
              if (!title.trim()) return;
              await mutate('/api/admin/broadcast', { title, body, level: 'warn' });
              push({ title: 'Broadcast sent', level: 'success' });
              setTitle('');
              setBody('');
            }}
            className="btn-amber w-full"
          >
            📣 Push to all connected clients
          </button>
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="h-64 animate-pulse rounded-xl bg-white/[0.04]" />
    </div>
  );
}

export type { EntitlementKey };
