'use client';

import Link from 'next/link';

import { BRAND } from '@/lib/constants';
import { Icon } from '@/components/ui/Icons';
import { Btn, Card, Kpi, Row } from '../shared';
import type { Overview } from '../types';

/**
 * MODULE 1  Overview & Data Plane Health.
 *
 * Eight executive KPI cards plus the quick-action command strip. The strip is
 * intentionally NOT decorative: each button drives a real module or a real
 * endpoint, so nothing here is a mock control.
 */
export function OverviewModule({
  data,
  onQuickAction,
}: {
  data: Overview;
  onQuickAction: (target: 'onboarding' | 'licenses' | 'branding' | 'security' | 'reseed') => void;
}) {
  const k = data.kpis;
  const h = data.health;

  return (
    <div className="space-y-3">
      {/* Quick-action command strip */}
      <Card
        title="Quick Actions"
        icon="bolt"
        subtitle="Every button below is wired to a live endpoint — no placeholders."
        actions={
          <>
            <Btn tone="green" icon="user" onClick={() => onQuickAction('onboarding')}>
              + New Customer &amp; Key
            </Btn>
            <Btn tone="violet" icon="key" onClick={() => onQuickAction('licenses')}>
              Batch Mint Keys
            </Btn>
            <Btn tone="amber" icon="refresh" onClick={() => onQuickAction('reseed')}>
              Force Market Reseed
            </Btn>
            <Btn tone="blue" icon="volume" onClick={() => onQuickAction('branding')}>
              Send Global Broadcast
            </Btn>
            <Btn icon="download" onClick={() => onQuickAction('security')}>
              Backup State
            </Btn>
            {/* §2.2  Emerald exit to the customer-facing website. */}
            <Link
              href="/dashboard"
              title="Leave the admin portal and open the customer trading website"
              className="flex items-center gap-1.5 rounded border border-emerald-500/55 bg-emerald-500/10 px-2.5 py-1 text-[10.5px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20"
              style={{ boxShadow: '0 0 10px rgba(16, 185, 129, 0.22)' }}
            >
              <Icon name="external" size={11} />
              🌐 View Main Website
            </Link>
          </>
        }
      >
        <div />
      </Card>

      {/* 8 KPI cards */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total Customers"
          value={k.totalCustomers}
          hint={`${k.activeToday} active today · ${data.users.length} accounts incl. admin`}
          icon="user"
          tone="white"
          onClick={() => onQuickAction('onboarding')}
        />
        <Kpi
          label="Active License Keys"
          value={`${k.activeKeys}/${k.totalKeys}`}
          hint="ACTIVE vs total minted"
          icon="key"
          tone="emerald"
          onClick={() => onQuickAction('licenses')}
        />
        <Kpi
          label="Expiring Soon (<72h)"
          value={k.expiringSoon}
          hint="Renewal follow-up queue"
          icon="clock"
          tone={k.expiringSoon > 0 ? 'amber' : 'white'}
          onClick={() => onQuickAction('licenses')}
        />
        <Kpi
          label="Revoked / Expired"
          value={k.revokedExpired}
          hint="Keys no longer usable"
          icon="shieldAlert"
          tone={k.revokedExpired > 0 ? 'red' : 'white'}
          onClick={() => onQuickAction('licenses')}
        />
        <Kpi
          label="Online Terminal Sessions"
          value={k.onlineWsClients}
          hint={`${k.activeDevices} registered device(s)`}
          icon="activity"
          tone="blue"
        />
        <Kpi
          label="Market Universe"
          value={`${k.universeEnabled}`}
          hint={`${k.universeTotal} USDT pairs tracked · ${k.monitoringCount} ⚠ monitoring tags`}
          icon="layers"
          tone="violet"
        />
        <Kpi
          label="Feed & API Health"
          value={k.dataMode}
          hint={`REST ${k.provider} · WS ${k.wsLatencyMs === null ? 'n/a' : `${k.wsLatencyMs}ms`} · Bybit fallback ready`}
          icon="trending"
          tone={k.dataMode === 'LIVE' ? 'emerald' : 'amber'}
        />
        <Kpi
          label="Engine Performance"
          value={k.lastScanDurationMs === null ? '—' : `${k.lastScanDurationMs}ms`}
          hint={`500-candle cache ${k.backfillReadyPct}% · heap ${k.heapUsedMb}MB`}
          icon="candles"
          tone="white"
        />
      </div>

      {/* Data-plane detail */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Data Plane Detail" icon="activity" subtitle="Live engine telemetry">
          <dl className="divide-y divide-white/[0.05]">
            <Detail label="Market data mode" value={k.dataMode} tone={k.dataMode === 'LIVE' ? 'emerald' : 'amber'} />
            <Detail label="Active upstream provider" value={k.provider} tone={k.provider === 'binance' ? 'emerald' : 'amber'} />
            <Detail label="WebSocket latency" value={k.wsLatencyMs === null ? 'not measured' : `${k.wsLatencyMs} ms`} />
            <Detail label="Last full scan sweep" value={k.lastScanDurationMs === null ? 'pending first cycle' : `${k.lastScanDurationMs} ms`} />
            <Detail label="500-candle backfill" value={`${k.backfillReadyPct}% ready`} tone={k.backfillReadyPct === 100 ? 'emerald' : 'amber'} />
            <Detail label="Weight used / cap" value={`${h.binanceWeightUsed} / ${h.binanceWeightCap} per min`} />
            <Detail label="Engine uptime" value={formatUptime(k.uptimeSec)} />
            <Detail label="Heap used" value={`${k.heapUsedMb} MB`} />
          </dl>
        </Card>

        <Card title="Boot & Coverage" icon="layers" subtitle="Cold-start phases and universe coverage">
          <dl className="divide-y divide-white/[0.05]">
            <Detail label="Coins tracked" value={String(k.universeTotal)} />
            <Detail label="Enabled for heatmap & scanners" value={String(k.universeEnabled)} />
            <Detail label="Monitoring Tag (⚠) coins" value={String(k.monitoringCount)} tone={k.monitoringCount > 0 ? 'amber' : 'white'} />
            <Detail label="Phase A (indicator warm-up)" value={h.phaseAReady ? `ready in ${h.phaseAElapsedSec ?? '—'}s` : 'in progress'} tone={h.phaseAReady ? 'emerald' : 'amber'} />
            <Detail label="Phase B (500-candle backfill)" value={h.phaseBReady ? 'ready' : 'in progress'} tone={h.phaseBReady ? 'emerald' : 'amber'} />
            <Detail label="Connected sockets" value={String(h.onlineWsClients)} />
            <Detail label="Scan cycle" value={`#${h.scanCycle}`} />
            <Detail label="Signals published (admin VIP)" value={String(data.customSignals.length)} tone={data.customSignals.length > 0 ? 'violet' : 'white'} />
          </dl>
        </Card>
      </div>

      <Row>
        <span className="text-[10px] text-text-muted">
          Owner · {BRAND.brandWatermark} ({BRAND.whatsappContact}) ·{' '}
          <span className="mono-num">{BRAND.productName}</span>
        </span>
      </Row>
    </div>
  );
}

function Detail({ label, value, tone = 'white' }: { label: string; value: string; tone?: 'white' | 'emerald' | 'amber' | 'violet' }) {
  const map = { white: 'text-white', emerald: 'text-emerald-400', amber: 'text-amber-400', violet: 'text-violet-300' };
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <dt className="text-[10.5px] text-text-muted">{label}</dt>
      <dd className={`mono-num text-[11px] font-semibold ${map[tone]}`}>{value}</dd>
    </div>
  );
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function OverviewSkeleton() {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card h-[92px] animate-pulse bg-bg-card/60" />
      ))}
    </div>
  );
}

export function QuickActionIcon() {
  return <Icon name="bolt" size={11} />;
}
