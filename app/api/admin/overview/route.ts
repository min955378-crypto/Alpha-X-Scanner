import { NextResponse } from 'next/server';

import { SCANNERS, type AuditLogRow, type EntitlementKey, type Entitlements, type LicenseKeyRow, type ScannerConfigRow } from '@/lib/types';
import { getEngine } from '@/server/engine';
import { getDb } from '@/server/engine/db';
import { activeProviderId } from '@/server/engine/binance';
import { isGuardError, requireAdmin } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** §10 module 1 — System overview + every other module's data in one payload. */
export async function GET(req: Request) {
  const guard = requireAdmin(req);
  if (isGuardError(guard)) return guard.response;

  const db = getDb();
  const engine = getEngine();
  await engine.start();

  const users = [...db.users.values()].map((u) => {
    const lic = db.licenseOf(u);
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      plan: u.plan,
      whatsappNumber: u.whatsappNumber,
      isSuspended: u.isSuspended,
      entitlements: db.entitlementsOf(u),
      licenseKey: lic?.keyString ?? null,
      licenseExpiresAt: lic?.expiresAt ?? null,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
    };
  });

  const licenses: LicenseKeyRow[] = [...db.licenses.values()].map((l) => {
    const assigned = l.assignedUserId ? db.userById(l.assignedUserId) : null;
    return {
      id: l.id,
      keyString: l.keyString,
      status: l.status,
      plan: l.plan,
      durationDays: l.durationDays,
      maxDevices: l.maxDevices,
      grants: {
        canAccessV1Scaling: l.grantV1Scaling,
        canAccessOrderBlock: l.grantOrderBlock,
        canAccessEmaCrossover: l.grantEmaCrossover,
        canAccessHiddenBullish: l.grantHiddenBullish,
        canAccessAlphaSniper: l.grantAlphaSniper,
      } as Entitlements,
      assignedUserId: l.assignedUserId,
      assignedUsername: assigned?.username ?? null,
      /* MODULE 3  Live device occupancy for the vault table. */
      devicesUsed: l.activeDeviceHashes.length,
      activatedAt: l.activatedAt,
      expiresAt: l.expiresAt,
      createdAt: l.createdAt,
    };
  });

  const coins = engine.store.list().map((c) => ({
    symbol: c.entry.symbol,
    baseAsset: c.entry.baseAsset,
    enabled: c.enabled,
    isMonitoringTag: c.isMonitoringTag,
    manualTagOverride: c.manualTagOverride,
    price: c.price,
    changePct24h: c.changePct24h,
    quoteVol24h: c.quoteVol24h,
    hasPerpetual: c.hasPerpetual,
  }));

  const scannerConfigs: ScannerConfigRow[] = [...db.scannerConfigs.values()];
  const auditLogs: AuditLogRow[] = db.auditLogs.slice(0, 60);
  const riskItems = engine.getRiskItems();

  /* ------------------- MODULE 1  executive KPI rollups ------------------- */
  const now = Date.now();
  const DAY = 86_400_000;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);

  let totalCustomers = 0;
  let activeToday = 0;
  for (const u of db.users.values()) {
    if (u.role !== 'ADMIN') totalCustomers += 1;
    if (u.lastSeenAt !== null && u.lastSeenAt >= startOfToday) activeToday += 1;
  }

  let activeKeys = 0;
  let revokedExpired = 0;
  let expiringSoon = 0;
  let activeDevices = 0;
  for (const l of db.licenses.values()) {
    activeDevices += l.activeDeviceHashes.length;
    if (l.status === 'REVOKED') {
      revokedExpired += 1;
      continue;
    }
    if (l.expiresAt !== null && l.expiresAt < now) {
      revokedExpired += 1;
      continue;
    }
    if (l.status === 'ACTIVE') activeKeys += 1;
    if (l.status === 'ACTIVE' && l.expiresAt !== null && l.expiresAt - now < 3 * DAY) expiringSoon += 1;
  }

  const allCoins = engine.store.list();
  const enabledCoins = allCoins.filter((c) => c.enabled);
  const monitoringCount = allCoins.filter((c) => c.isMonitoringTag).length;
  const backfilled = allCoins.filter((c) => c.backfilled500).length;

  const kpis = {
    totalCustomers,
    activeToday,
    activeKeys,
    totalKeys: db.licenses.size,
    expiringSoon,
    revokedExpired,
    onlineWsClients: engine.wsClients,
    activeDevices,
    universeTotal: allCoins.length,
    universeEnabled: enabledCoins.length,
    monitoringCount,
    provider: activeProviderId(),
    dataMode: engine.dataMode,
    wsLatencyMs: engine.wsLatencyMs,
    lastScanDurationMs: engine.lastScanDurationMs,
    backfillReadyPct: allCoins.length ? Math.round((backfilled / allCoins.length) * 100) : 0,
    heapUsedMb: engine.getHealth().heapUsedMb,
    uptimeSec: engine.getHealth().uptimeSec,
  };

  return NextResponse.json({
    ok: true,
    health: engine.getHealth(),
    users,
    licenses,
    coins,
    scannerConfigs,
    auditLogs,
    riskItems,
    systemConfig: db.systemConfig,
    scanners: SCANNERS.map((s) => ({ slug: s.slug, name: s.name, entitlementKey: s.entitlementKey })),
    kpis,
    customSignals: db.listCustomSignals(),
  });
}

export type { EntitlementKey };
