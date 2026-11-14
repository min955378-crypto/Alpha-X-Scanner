'use client';

import { useEffect, useState } from 'react';

import type { BroadcastSeverity, LoginFeatureRow, SystemConfig } from '@/lib/types';
import { Icon } from '@/components/ui/Icons';
import { Btn, Card, CopyBtn, Field, PillSelect, TextInput } from '../shared';

/**
 * MODULE 8  Branding & Global Broadcast Center.
 *
 * Product identity, the owner's WhatsApp contact, the 12 login feature cards
 * and the live announcement banner. Every field persists to SystemConfig and
 * takes effect on the next page load; the broadcast pushes over WebSocket
 * immediately and is replayed to clients that connect later.
 */

const FEATURE_ICONS = [
  'search',
  'layers',
  'spark',
  'bolt',
  'blocks',
  'trending',
  'hidden',
  'crosshair',
  'shieldAlert',
  'activity',
  'candles',
  'volume',
] as const;

const SEVERITIES: Array<{ value: BroadcastSeverity; label: string; tone: string }> = [
  { value: 'INFO', label: 'ℹ Info', tone: 'border-blue-500/50 bg-blue-500/10 text-blue-400' },
  { value: 'BULLISH', label: '📈 Bullish', tone: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' },
  { value: 'WARNING', label: '⚠ Warning', tone: 'border-amber-500/50 bg-amber-500/10 text-amber-400' },
  { value: 'URGENT', label: '🚨 Urgent', tone: 'border-red-500/50 bg-red-500/10 text-red-400' },
];

export function BrandingModule({
  systemConfig,
  reload,
  toast,
}: {
  systemConfig: SystemConfig;
  reload: () => Promise<void>;
  toast: (msg: string, level?: 'ok' | 'warn') => void;
}) {
  const [cfg, setCfg] = useState(systemConfig);
  const [features, setFeatures] = useState<LoginFeatureRow[]>(systemConfig.loginFeaturesJson ?? []);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<BroadcastSeverity>('INFO');
  const [hours, setHours] = useState(24);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setCfg(systemConfig);
    setFeatures(systemConfig.loginFeaturesJson ?? []);
  }, [systemConfig]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/system-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          productName: cfg.productName,
          versionBadge: cfg.versionBadge,
          brandWatermark: cfg.brandWatermark,
          promoTagline: cfg.promoTagline,
          promoHeadline: cfg.promoHeadline,
          whatsappContact: cfg.whatsappContact,
          whatsappMessageTemplate: cfg.whatsappMessageTemplate,
          loginFeaturesJson: features,
        }),
      });
      const json = (await res.json()) as { ok: boolean };
      if (!json.ok) {
        toast('Could not save branding.', 'warn');
        return;
      }
      toast('Branding saved — reloads pick it up immediately.');
      await reload();
    } catch {
      toast('Network error — nothing saved.', 'warn');
    } finally {
      setSaving(false);
    }
  };

  const sendBroadcast = async () => {
    if (!title.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), message: message.trim(), severity, durationHours: hours }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast('Could not send the broadcast.', 'warn');
        return;
      }
      toast(`Broadcast delivered live — ${severity} banner is now on every connected terminal.`);
      setTitle('');
      setMessage('');
      await reload();
    } catch {
      toast('Network error — nothing was sent.', 'warn');
    } finally {
      setSending(false);
    }
  };

  const clearBroadcast = async () => {
    setSending(true);
    try {
      await fetch('/api/admin/broadcast', { method: 'DELETE' });
      toast('Banner cleared everywhere.');
      await reload();
    } catch {
      toast('Network error.', 'warn');
    } finally {
      setSending(false);
    }
  };

  const whatsappHref = `https://wa.me/${cfg.whatsappContact.replace(/[^\d]/g, '').replace(/^0/, '92')}?text=${encodeURIComponent(
    cfg.whatsappMessageTemplate,
  )}`;

  return (
    <div className="space-y-3">
      {/* Broadcast */}
      <Card
        title="Global Broadcast Banner"
        icon="volume"
        subtitle="Delivered instantly over WebSocket to every live terminal, and stored so late-joining clients still see it."
      >
        <div className="space-y-2.5 p-3">
          {cfg.broadcast ? (
            <div className="rounded border border-amber-400/30 bg-amber-400/[0.07] px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">Live now</span>
                  <p className="text-[11px] font-bold text-white">{cfg.broadcast.title}</p>
                  {cfg.broadcast.message ? (
                    <p className="text-[10px] leading-relaxed text-text-secondary">{cfg.broadcast.message}</p>
                  ) : null}
                  <p className="mono-num mt-0.5 text-[9px] text-text-muted">
                    {cfg.broadcast.severity} · by {cfg.broadcast.createdBy} ·{' '}
                    {new Date(cfg.broadcast.createdAt).toLocaleString()}
                    {cfg.broadcast.expiresAt ? ` · expires ${new Date(cfg.broadcast.expiresAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <Btn tone="red" icon="reset" busy={sending} onClick={clearBroadcast}>
                  Clear
                </Btn>
              </div>
            </div>
          ) : (
            <p className="text-[10.5px] text-text-muted">No banner is currently live.</p>
          )}

          <Field label="Headline">
            <TextInput value={title} onChange={setTitle} placeholder="Market update — new Alpha Sniper threshold live" />
          </Field>
          <Field label="Message (optional)">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Extra context your customers should read…"
              className="input w-full resize-y py-1 text-[11px]"
            />
          </Field>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Severity">
              <div className="flex flex-wrap gap-1">
                {SEVERITIES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSeverity(s.value)}
                    aria-pressed={severity === s.value}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                      severity === s.value ? s.tone : 'border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.07]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Visible for">
              <PillSelect
                options={[
                  { value: 1, label: '1h' },
                  { value: 6, label: '6h' },
                  { value: 24, label: '24h' },
                  { value: 72, label: '3d' },
                  { value: 168, label: '7d' },
                ]}
                value={hours}
                onChange={setHours}
              />
            </Field>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <Btn tone="green" icon="volume" busy={sending} disabled={!title.trim()} onClick={sendBroadcast}>
              ⚡ Send Live Broadcast to Every User
            </Btn>
          </div>
        </div>
      </Card>

      {/* Identity */}
      <Card
        title="Product Identity & Owner Contact"
        icon="settings"
        subtitle="Persisted to SystemConfig and applied on the next page load."
        actions={<Btn tone="green" icon="bolt" busy={saving} onClick={save}>💾 Save Branding</Btn>}
      >
        <div className="grid gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Product Name">
            <TextInput value={cfg.productName} onChange={(v) => setCfg({ ...cfg, productName: v })} />
          </Field>
          <Field label="Version Badge">
            <TextInput value={cfg.versionBadge} onChange={(v) => setCfg({ ...cfg, versionBadge: v })} mono />
          </Field>
          <Field label="Owner Name">
            <TextInput value={cfg.brandWatermark} onChange={(v) => setCfg({ ...cfg, brandWatermark: v })} />
          </Field>
          <Field label="Sidebar Promo Headline">
            <TextInput value={cfg.promoHeadline} onChange={(v) => setCfg({ ...cfg, promoHeadline: v })} />
          </Field>
          <Field label="Sidebar Promo Tagline">
            <TextInput value={cfg.promoTagline ?? cfg.promoTagline} onChange={(v) => setCfg({ ...cfg, promoTagline: v })} />
          </Field>
          <Field label="WhatsApp Number" hint="Used for every wa.me deep link.">
            <TextInput value={cfg.whatsappContact} onChange={(v) => setCfg({ ...cfg, whatsappContact: v })} mono />
          </Field>
        </div>

        <div className="border-t border-white/[0.06] p-3">
          <Field
            label="Pre-filled WhatsApp Message Template"
            hint="Sent verbatim when a visitor taps any WhatsApp button on the login page."
          >
            <textarea
              value={cfg.whatsappMessageTemplate}
              onChange={(e) => setCfg({ ...cfg, whatsappMessageTemplate: e.target.value })}
              rows={5}
              className="input mono-num w-full resize-y py-1.5 text-[10.5px] leading-relaxed"
            />
          </Field>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10.5px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
            >
              <Icon name="whatsapp" size={11} />
              Preview the licence-request link ↗
            </a>
            <CopyBtn value={cfg.whatsappMessageTemplate} label="📋 Copy Template" />
          </div>
        </div>
      </Card>

      {/* Feature cards */}
      <Card
        title="Login Page Feature Cards"
        icon="blocks"
        subtitle="The 12 capability cards shown beside the licence gate."
        actions={<Btn tone="green" icon="bolt" busy={saving} onClick={save}>💾 Save Cards</Btn>}
      >
        <div className="grid max-h-[560px] gap-2 overflow-auto p-3 lg:grid-cols-2">
          {features.map((f, i) => (
            <div key={f.id || i} className="rounded border border-white/[0.06] bg-bg-card-2 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-text-muted">Card {i + 1}</span>
                <div className="flex items-center gap-1.5">
                  <Icon name={(FEATURE_ICONS as readonly string[]).includes(f.icon) ? (f.icon as 'bolt') : 'spark'} size={13} className="text-emerald-400" />
                  <select
                    value={f.icon}
                    onChange={(e) => setFeatures((prev) => prev.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)))}
                    className="rounded border border-white/10 bg-bg-card px-1 py-0.5 text-[9.5px] text-text-secondary"
                  >
                    {FEATURE_ICONS.map((ic) => (
                      <option key={ic} value={ic}>
                        {ic}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <input
                value={f.title}
                onChange={(e) => setFeatures((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                placeholder="Title"
                className="input mb-1 h-7 w-full text-[11px] font-semibold"
              />
              <textarea
                value={f.body}
                onChange={(e) => setFeatures((prev) => prev.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                rows={2}
                placeholder="Description"
                className="input w-full resize-y py-1 text-[10.5px]"
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
