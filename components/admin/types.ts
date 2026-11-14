import type {
  AuditLogRow,
  CustomSignal,
  Entitlements,
  LicenseKeyRow,
  RiskWatchItem,
  ScannerConfigRow,
  ScannerSlug,
  SystemConfig,
  SystemHealth,
  Timeframe,
} from '@/lib/types';

/** Shape returned by GET /api/admin/overview — the single source for all 9 modules. */
export interface Overview {
  ok: boolean;
  health: SystemHealth;
  users: UserRow[];
  licenses: LicenseKeyRow[];
  coins: CoinRow[];
  scannerConfigs: ScannerConfigRow[];
  auditLogs: AuditLogRow[];
  riskItems: RiskWatchItem[];
  systemConfig: SystemConfig;
  scanners: Array<{ slug: ScannerSlug; name: string; entitlementKey: string }>;
  customSignals: CustomSignal[];
  kpis: Kpis;
}

export interface UserRow {
  id: string;
  username: string;
  role: 'ADMIN' | 'USER';
  plan: 'LITE' | 'ULTRA_PRO';
  whatsappNumber: string | null;
  isSuspended: boolean;
  entitlements: Entitlements;
  licenseKey: string | null;
  licenseExpiresAt: number | null;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface CoinRow {
  symbol: string;
  baseAsset: string;
  enabled: boolean;
  isMonitoringTag: boolean;
  manualTagOverride: boolean;
  price: number;
  changePct24h: number;
  quoteVol24h: number;
  hasPerpetual: boolean;
}

export interface Kpis {
  totalCustomers: number;
  activeToday: number;
  activeKeys: number;
  totalKeys: number;
  expiringSoon: number;
  revokedExpired: number;
  onlineWsClients: number;
  activeDevices: number;
  universeTotal: number;
  universeEnabled: number;
  monitoringCount: number;
  provider: 'binance' | 'bybit' | 'coincap' | 'NONE';
  dataMode: 'LIVE' | 'SIMULATED';
  wsLatencyMs: number | null;
  lastScanDurationMs: number | null;
  backfillReadyPct: number;
  heapUsedMb: number;
  uptimeSec: number;
}

/** Per-module nav descriptor used by the sidebar + tab bar. */
export interface ModuleDef {
  id: string;
  label: string;
  icon: string;
  blurb: string;
}

export const MODULES: ModuleDef[] = [
  { id: 'overview', label: 'Overview & Data Plane Health', icon: '📊', blurb: 'Executive KPIs and feed status' },
  { id: 'onboarding', label: 'Customer Onboarding Studio', icon: '🚀', blurb: 'Create a customer + key in one click' },
  { id: 'licenses', label: 'License Key Vault', icon: '🔑', blurb: 'Batch mint, extend, revoke, device locks' },
  { id: 'users', label: 'Users & Session Matrix', icon: '👥', blurb: 'Passwords, keys, suspension' },
  { id: 'security2fa', label: 'Authenticator 2FA & Admin Security', icon: '📲', blurb: 'Pair your app, rotate secrets, change credentials' },
  { id: 'scanners', label: 'Scanner Math Tuner', icon: '⚙', blurb: 'Strategy parameters & hot-reload' },
  { id: 'coins', label: 'Coin Universe & VIP Signals', icon: '🪙', blurb: 'Monitoring tags and manual signals' },
  { id: 'risk', label: 'Binance Risk Watch CMS', icon: '⚠', blurb: 'Delistings, notices and spot news' },
  { id: 'branding', label: 'Branding & Broadcasts', icon: '📢', blurb: 'Identity, login features, announcements' },
  { id: 'security', label: 'Audit Logs & Cloud Backup', icon: '🛡', blurb: 'Audit trail, export, restore' },
];

export type ModuleId = (typeof MODULES)[number]['id'];

export const TIMEFRAME_OPTIONS: Timeframe[] = ['15M', '30M', '1H', '4H', '1D'];
