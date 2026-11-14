'use client';

import { useState } from 'react';

import type { RiskCategory, RiskWatchItem } from '@/lib/types';
import { Btn, Card, Empty, Field, TextInput } from '../shared';
import type { Overview } from '../types';

/**
 * MODULE 7  Binance Risk Watch CMS.
 *
 * Live Binance API status for the two feeds that drive the customer's risk
 * panel (catalogId 161 delistings, catalogId 48 spot news), a force-sync
 * control, and full CRUD over the notices including pinning custom entries.
 */

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  DELISTING_NOTICE: 'Delisting',
  SPOT_NEWS: 'Spot News',
  MONITORING_TAG: 'Monitoring',
};

const CATEGORY_TONE: Record<RiskCategory, string> = {
  DELISTING_NOTICE: 'border-red-500/50 bg-red-500/10 text-red-400',
  SPOT_NEWS: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  MONITORING_TAG: 'border-violet-500/50 bg-violet-500/10 text-violet-300',
};

const BADGE_TONE: Record<string, string> = {
  Monitoring: 'border-violet-500/50 bg-violet-500/10 text-violet-300',
  Notice: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  'Trading Pairs': 'border-white/15 bg-white/[0.04] text-text-secondary',
  Delisting: 'border-red-500/50 bg-red-500/10 text-red-400',
};

export function RiskModule({
  data,
  reload,
  toast,
}: {
  data: Overview;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<'LIVE_BAPI' | 'CACHED_SNAPSHOT' | null>(null);

  const items = data.riskItems;

  const act = async (body: Record<string, unknown>, okMsg: string): Promise<void | null> => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/risk-watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; source?: 'LIVE_BAPI' | 'CACHED_SNAPSHOT' };
      if (!json.ok) {
        toast('Risk Watch action failed.', 'warn');
        return null;
      }
      if (json.source) setSource(json.source);
      toast(okMsg);
      await reload();
      return null;
    } catch {
      toast('Network error — nothing changed.', 'warn');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const forceSync = async () => {
    setSyncing(true);
    await act({ action: 'sync' }, 'Risk Watch synced from Binance.');
    setSyncing(false);
  };

  return (
    <div className="space-y-3">
      <Card
        title="Binance Risk Watch — Live API Status"
        icon="shieldAlert"
        subtitle="catalogId 161 (delistings) · catalogId 48 (spot news)"
        actions={
          <>
            <span className="mono-num rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-text-secondary">
              {source ? `last sync: ${source}` : `${items.length} rows cached`}
            </span>
            <Btn tone="amber" icon="refresh" busy={syncing} onClick={forceSync}>
              ↻ Force Sync
            </Btn>
          </>
        }
      >
        <div className="grid gap-2 p-3 sm:grid-cols-3">
          <Stat label="Total Notices" value={String(items.length)} />
          <Stat label="Pinned to Top" value={String(items.filter((i) => i.isPinned).length)} tone="text-amber-400" />
          <Stat
            label="Delistings"
            value={String(items.filter((i) => i.category === 'DELISTING_NOTICE').length)}
            tone="text-red-400"
          />
        </div>
      </Card>

      <AddNoticeCard busy={busy} onCreate={(b) => act(b, 'Notice published to every customer.')} />

      <Card title="Notices" icon="layers" subtitle="Pinned rows float to the top of the customer's Risk Watch panel.">
        {items.length === 0 ? (
          <Empty>No risk notices yet — force a sync or add a custom notice.</Empty>
        ) : (
          <ul className="max-h-[520px] divide-y divide-white/[0.04] overflow-auto">
            {items.map((item) => (
              <RiskRow key={item.id} item={item} busy={busy} act={act} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-white/[0.06] bg-bg-card-2 px-2.5 py-2">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mono-num mt-0.5 text-[18px] font-bold leading-none ${tone}`}>{value}</div>
    </div>
  );
}

function RiskRow({
  item,
  busy,
  act,
}: {
  item: RiskWatchItem;
  busy: boolean;
  act: (body: Record<string, unknown>, okMsg: string) => Promise<unknown>;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-white/[0.02]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-1.5 py-px text-[8.5px] font-bold ${CATEGORY_TONE[item.category]}`}>
            {CATEGORY_LABEL[item.category]}
          </span>
          <span className={`rounded-full border px-1.5 py-px text-[8.5px] font-bold ${BADGE_TONE[item.badgeType] ?? BADGE_TONE.Notice}`}>
            {item.badgeType}
          </span>
          {item.symbol ? <span className="mono-num text-[9.5px] font-semibold text-emerald-400">{item.symbol}</span> : null}
          {item.isPinned ? (
            <span className="rounded-full border border-amber-400/60 bg-amber-400/15 px-1.5 py-px text-[8.5px] font-bold text-amber-300">
              📌 PINNED
            </span>
          ) : null}
          <span className="mono-num text-[10px] font-bold text-white">{item.title}</span>
        </div>
        <p className="mono-num mt-0.5 text-[9px] text-text-muted">
          {new Date(item.publishedAt).toLocaleString()}
          {item.effectiveDelistDate ? ` · delists ${new Date(item.effectiveDelistDate).toLocaleDateString()}` : ''}
          {item.sourceUrl ? ' · ' : ''}
          {item.sourceUrl ? (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              source ↗
            </a>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 gap-1">
        <Btn
          tone={item.isPinned ? 'amber' : 'ghost'}
          disabled={busy}
          onClick={() => void act({ action: 'pin', id: item.id, pinned: !item.isPinned }, item.isPinned ? 'Notice unpinned.' : 'Notice pinned to top.')}
        >
          {item.isPinned ? 'Unpin' : '📌 Pin to Top'}
        </Btn>
        <Btn tone="red" icon="download" disabled={busy} onClick={() => void act({ action: 'delete', id: item.id }, 'Notice deleted.')}>
          🗑
        </Btn>
      </div>
    </li>
  );
}

function AddNoticeCard({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  const [symbol, setSymbol] = useState('');
  const [category, setCategory] = useState<RiskCategory>('SPOT_NEWS');
  const [pinned, setPinned] = useState(true);

  const submit = async () => {
    if (!title.trim()) return;
    await onCreate({
      action: 'create',
      title: title.trim(),
      category,
      badgeType: category === 'DELISTING_NOTICE' ? 'Delisting' : 'Notice',
      symbol: symbol.trim().toUpperCase() || null,
      pinned,
    });
    setTitle('');
    setSymbol('');
  };

  return (
    <Card title="Add Custom Notice" icon="volume" subtitle="Immediately visible on every customer's Risk Watch panel.">
      <div className="space-y-2.5 p-3">
        <Field label="Title">
          <TextInput value={title} onChange={setTitle} placeholder="Scheduled maintenance — Saturday 02:00 UTC" />
        </Field>
        <Field label="Symbol (optional)" hint="e.g. BTCUSDT — renders as a clickable pair tag.">
          <TextInput value={symbol} onChange={setSymbol} placeholder="BTCUSDT" mono />
        </Field>
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as RiskCategory)}
            className="input h-7 w-full sm:w-56"
          >
            {(Object.keys(CATEGORY_LABEL) as RiskCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] font-semibold text-text-secondary">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-3 w-3 accent-amber-500"
          />
          Pin to top immediately
        </label>
        <div className="border-t border-white/[0.06] pt-2.5">
          <Btn tone="green" icon="bolt" busy={busy} disabled={!title.trim()} onClick={submit}>
            ⚡ Publish Notice
          </Btn>
        </div>
      </div>
    </Card>
  );
}
