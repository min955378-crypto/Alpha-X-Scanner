'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { BRAND, LOGIN_FEATURES } from '@/lib/constants';
import { useAuth } from '@/components/providers/AuthProvider';
import { AuroraBackground, TiltCard } from '@/components/ui/Motion3D';
import { Icon } from '@/components/ui/Icons';

/**
 * §3 / §4  Pre-login splash → 3-field License Gate → 12-feature 3D showcase.
 *
 * Strictly no demo credentials, no admin references, no video embeds and no
 * legal/Urdu text blocks below the gate (Directive §2 and §3.1). Every
 * WhatsApp surface routes through BRAND.whatsappHref so the pre-filled licence
 * request is identical across the product.
 */
export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login, error } = useAuth();

  const [splashDone, setSplashDone] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      const ok = await login({ username, password, licenseKey });
      setSubmitting(false);
      if (ok) router.replace('/dashboard');
    },
    [login, username, password, licenseKey, router],
  );

  return (
    <>
      {!splashDone ? <Splash onDone={() => setSplashDone(true)} /> : null}

      <main className="relative min-h-screen overflow-x-clip bg-bg-0">
        {/* §5.2  60fps 3D perspective grid + volumetric orbs. */}
        <AuroraBackground />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1240px] flex-col px-4 py-8 lg:flex-row lg:items-center lg:gap-8 lg:py-12">
          {/* ------------------------- 3-FIELD GATE ------------------------- */}
          <div className="w-full lg:max-w-[420px]">
            <TiltCard max={6} className="rounded-2xl">
              <section
                className="glass laser-border rounded-2xl p-6"
                aria-labelledby="login-heading"
              >
                <div className="mb-5 text-center">
                  <div className="mb-3 flex items-center justify-center">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-400 ring-1 ring-emerald-400/30">
                      <Icon name="activity" size={22} />
                    </span>
                  </div>
                  <h1
                    id="login-heading"
                    className="font-display heading-gradient text-[26px] font-bold leading-tight"
                  >
                    Alpha X Scanner
                  </h1>
                  <p className="mt-1 text-[11.5px] font-medium text-text-secondary">
                    {BRAND.loginSubtitle}
                  </p>
                </div>

                <form onSubmit={submit} className="space-y-3">
                  <Field
                    id="username"
                    label="Username"
                    icon="user"
                    value={username}
                    onChange={setUsername}
                    placeholder="Your username"
                    autoComplete="username"
                  />

                  <div>
                    <Label htmlFor="password" icon="lock" text="Password" />
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                        placeholder="••••••••"
                        className="input pr-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-text-muted transition-colors hover:text-white"
                      >
                        <Icon name={showPassword ? 'hidden' : 'crosshair'} size={16} />
                      </button>
                    </div>
                  </div>

                  <Field
                    id="license"
                    label="License Key"
                    icon="key"
                    value={licenseKey}
                    onChange={setLicenseKey}
                    placeholder="APS-XXXX-XXXX-XXXX"
                    mono
                  />

                  {error ? (
                    <p
                      role="alert"
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-medium text-red-300"
                    >
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting || !username || !password || !licenseKey}
                    className="btn-primary w-full justify-center py-2.5 text-[13px]"
                  >
                    {submitting ? 'Verifying…' : 'Enter Terminal'}
                    {!submitting ? <Icon name="external" size={14} /> : null}
                  </button>
                </form>

                {/* §3.3  Luxury emerald-and-gold WhatsApp CTA inside the card. */}
                <a
                  href={BRAND.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/35 bg-gradient-to-r from-emerald-500/18 via-emerald-400/10 to-amber-400/16 px-4 py-2.5 text-[11.5px] font-semibold text-emerald-200 transition-all hover:border-emerald-300/60 hover:from-emerald-500/28 hover:to-amber-400/24"
                >
                  <Icon name="whatsapp" size={16} />
                  <span>
                    Need a License Key? Contact <span className="text-white">Muhammad Ibrahim</span>{' '}
                    (<span className="mono-num">0348-5581969</span>)
                  </span>
                </a>

                <p className="mt-3 text-center text-[11.5px] text-text-muted">
                  <span className="mono-num">+92 348 5581969</span>
                </p>
              </section>
            </TiltCard>
          </div>

          {/* ---------------------- 12-FEATURE 3D SHOWCASE ---------------------- */}
          <div className="mt-8 min-w-0 flex-1 lg:mt-0">
            <header className="mb-4">
              <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
                Institutional Crypto Terminal
              </p>
              <h2 className="font-display heading-gradient mt-1 text-[21px] font-bold leading-tight lg:text-[25px]">
                Everything inside Alpha X Scanner
              </h2>
              <p className="mt-1.5 max-w-[62ch] text-[12px] text-text-secondary">
                Twelve capabilities running on one unified Binance terminal. Hover any card to pause
                the showcase.
              </p>
            </header>

            <FeatureShowcase />
          </div>
        </div>
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* §3.2  3D perspective Bento grid with smooth auto-scroll                    */
/* -------------------------------------------------------------------------- */

/**
 * Two duplicated columns scrolled by a CSS marquee. Duplicating is what makes
 * the loop seamless; the track pauses on hover/focus so a customer can read.
 */
function FeatureShowcase() {
  const track = [...LOGIN_FEATURES, ...LOGIN_FEATURES];

  return (
    <div
      className="relative h-[440px] overflow-hidden lg:h-[520px]"
      style={{
        maskImage: 'linear-gradient(180deg, transparent, #000 8%, #000 92%, transparent)',
        WebkitMaskImage: 'linear-gradient(180deg, transparent, #000 8%, #000 92%, transparent)',
      }}
    >
      <div className="marquee-vertical grid grid-cols-1 gap-3 sm:grid-cols-2">
        {track.map((f, i) => (
          <TiltCard key={`${f.id}-${i}`} max={5} className="rounded-xl">
            <article
              className="glass laser-border h-full rounded-xl p-3.5"
              style={{ ['--laser-color' as string]: '#00d26a' }}
            >
              <div className="mb-2 flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-400 ring-1 ring-emerald-400/25">
                  <Icon name={f.icon} size={15} />
                </span>
                <h3 className="font-display text-[12.5px] font-bold leading-snug text-white">
                  {f.title}
                </h3>
              </div>
              <p className="text-[11px] leading-relaxed text-text-secondary">{f.body}</p>
            </article>
          </TiltCard>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Splash                                                                     */
/* -------------------------------------------------------------------------- */

function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg-0" role="status">
      <AuroraBackground />
      <div className="relative z-10 text-center">
        <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-400 ring-1 ring-emerald-400/30">
          <Icon name="activity" size={28} />
        </span>
        <p className="font-display text-[10.5px] font-bold uppercase tracking-[0.32em] text-emerald-400">
          WELCOME TO ALPHA X SCANNER
        </p>
        <h1 className="font-display heading-gradient mt-2 text-[34px] font-extrabold tracking-tight sm:text-[42px]">
          Alpha X Scanner
        </h1>
        <p className="mt-2 text-[12px] text-text-secondary">{BRAND.loginSubtitle}</p>
        <div className="mx-auto mt-5 h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400" />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field primitives                                                           */
/* -------------------------------------------------------------------------- */

function Label({
  htmlFor,
  icon,
  text,
}: {
  htmlFor: string;
  icon: 'user' | 'lock' | 'key';
  text: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-text-secondary"
    >
      <Icon name={icon} size={13} className="text-emerald-400" />
      {text}
    </label>
  );
}

function Field({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
  mono = false,
  autoComplete,
}: {
  id: string;
  label: string;
  icon: 'user' | 'lock' | 'key';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  mono?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} icon={icon} text={label} />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className={`input ${mono ? 'mono-num tracking-wide' : ''}`}
      />
    </div>
  );
}
