'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BRAND, LOGIN_CAROUSEL, TUTORIALS } from '@/lib/constants';
import { LEGAL_EN, LEGAL_UR } from '@/lib/constants';
import { useAuth } from '@/components/providers/AuthProvider';
import { LegalFooter } from '@/components/shell/LegalFooter';
import { CopyButton } from '@/components/ui';

/**
 * §4  Pre-login splash → 3-field License Gate → 12-feature carousel.
 */
export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login, systemConfig, error } = useAuth();

  const [splashDone, setSplashDone] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(user.acceptedDisclaimerAt ? '/dashboard' : '/dashboard');
  }, [loading, user, router]);

  const carousel = useMemo(() => systemConfig.loginCarouselJson ?? LOGIN_CAROUSEL, [systemConfig]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);
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

      <main className="flex min-h-screen flex-col overflow-x-clip bg-bg-canvas dash-tint">
        <div className="flex flex-1 items-start justify-center px-4 py-8">
          <div className="grid w-full max-w-[1080px] gap-5 lg:grid-cols-[420px_1fr]">
            {/* ---------------------------- GATE ---------------------------- */}
            <section className="card p-5" aria-labelledby="login-heading">
              <div className="mb-4 text-center">
                <div className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                    <polyline points="16 7 22 7 22 13" />
                  </svg>
                  <h1 id="login-heading" className="text-[22px] font-extrabold tracking-tight text-white">
                    {BRAND.productName}
                  </h1>
                </div>
                <p className="mt-0.5 text-[12px] font-semibold text-emerald-400">{systemConfig.loginSubtitle}</p>
              </div>

              <form onSubmit={submit} className="space-y-3" noValidate>
                {/* Field 1 */}
                <div>
                  <label htmlFor="username" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input h-9 text-[12.5px]"
                    placeholder="Your ScalpPro username"
                  />
                </div>

                {/* Field 2 */}
                <div>
                  <label htmlFor="password" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input h-9 pr-14 text-[12.5px]"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1 rounded px-1.5 py-1 text-[10px] font-semibold text-text-secondary hover:text-white"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {/* Field 3 */}
                <div>
                  <label htmlFor="licenseKey" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                    License Key
                  </label>
                  <input
                    id="licenseKey"
                    name="licenseKey"
                    type="text"
                    required
                    spellCheck={false}
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                    className="input mono-num h-9 text-[12.5px] tracking-wide"
                    placeholder="SPRO-XXXX-XXXX-XXXX"
                  />
                </div>

                {localError || error ? (
                  <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                    {localError ?? error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 w-full rounded-md bg-emerald-500 text-[13px] font-bold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-text-muted"
                >
                  {submitting ? 'Verifying license…' : 'Open ScalpPro →'}
                </button>
              </form>

              <div className="mt-4 rounded-lg border border-white/[0.06] bg-bg-card-2 p-3">
                <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-text-muted">Demo credentials</div>
                <ul className="space-y-1 text-[11px] text-text-secondary">
                  <li className="flex items-center justify-between gap-2">
                    <span>
                      Admin · <span className="mono-num text-white">admin</span> /{' '}
                      <span className="mono-num text-white">ScalpPro@2026</span>
                    </span>
                    <CopyButton value="SPRO-9F4A-22C1-88E0" label="Ultra Pro key" compact />
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>
                      Trader · <span className="mono-num text-white">demo</span> /{' '}
                      <span className="mono-num text-white">demo1234</span>
                    </span>
                    <CopyButton value="SPRO-TRIAL-AA17-K4M2" label="Lite key" compact />
                  </li>
                </ul>
              </div>

              <a
                href={BRAND.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-400 hover:bg-emerald-500/25"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Get a License Key on WhatsApp ·{' '}
                <span className="mono-num select-all">{systemConfig.whatsappContact}</span>
              </a>
            </section>

            {/* ------------------------- CAROUSEL -------------------------- */}
            <section className="space-y-4" aria-label="Feature showcase">
              <FeatureCarousel slides={carousel} />

              <div className="grid gap-3 sm:grid-cols-2">
                {[TUTORIALS[1], TUTORIALS[0]].map((v) => (
                  <a
                    key={v.id}
                    href={`https://www.youtube.com/watch?v=${v.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group card block overflow-hidden transition-colors hover:border-white/20"
                  >
                    <div className="relative aspect-video w-full bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                        alt=""
                        className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                        loading="lazy"
                      />
                      <span className="mono-num absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 text-[10px] font-semibold text-white">
                        {v.duration}
                      </span>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600/90 text-[14px] text-white shadow-lg">
                          ▶
                        </span>
                      </span>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[9.5px] font-bold uppercase tracking-wider text-amber-400">{v.lesson}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] font-semibold leading-snug text-white">
                        {v.title}
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              <div className="card p-3">
                <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-text-muted">Legal</div>
                <p className="text-[10px] leading-relaxed text-text-muted">{LEGAL_EN}</p>
                <p dir="rtl" lang="ur" className="ur mt-1.5 text-[11px] text-text-muted">
                  {LEGAL_UR}
                </p>
              </div>
            </section>
          </div>
        </div>

        <LegalFooter />
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* §4.1  Pre-login splash — 800–1100ms, skippable, reduced-motion aware.       */
/* -------------------------------------------------------------------------- */

function Splash({ onDone }: { onDone: () => void }) {
  const doneRef = useRef(false);
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      finish();
      return;
    }
    const t = setTimeout(finish, 950);
    return () => clearTimeout(t);
  }, [finish]);

  return (
    <div
      role="presentation"
      onClick={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finish();
      }}
      className="fixed inset-0 z-[300] flex cursor-pointer flex-col items-center justify-center gap-3 bg-bg-0"
    >
      <div className="flex items-center gap-2">
        <svg className="h-8 w-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        <span className="text-[26px] font-extrabold tracking-tight text-white">WELCOME TO SCALPPRO</span>
      </div>
      <p className="text-[12px] text-text-secondary">Your trading dashboard is getting ready</p>
      <div className="mt-1 h-[3px] w-52 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-500" />
      </div>
      <p className="mt-1 text-[10px] text-text-muted">Click anywhere to skip</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §4.2  12-slide feature carousel                                             */
/* -------------------------------------------------------------------------- */

function FeatureCarousel({ slides }: { slides: Array<{ title: string; body: string }> }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), 4200);
    return () => clearInterval(t);
  }, [paused, slides.length]);

  const slide = slides[index] ?? slides[0];

  return (
    <div
      className="card relative overflow-hidden p-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="ScalpPro features"
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl" />
      <div className="mb-3 flex items-center justify-between">
        <span className="mono-num text-[10px] font-bold text-amber-400">
          {String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            aria-label="Previous feature"
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-white"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            aria-label="Next feature"
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-white"
          >
            ›
          </button>
        </div>
      </div>

      <div key={index} className="animate-fade-in min-h-[92px]">
        <h2 className="text-[17px] font-bold leading-snug text-white">{slide.title}</h2>
        <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-text-secondary">{slide.body}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="Feature slides">
        {slides.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Feature ${i + 1}: ${s.title}`}
            onClick={() => setIndex(i)}
            className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-amber-400' : 'w-1.5 bg-white/20 hover:bg-white/40'}`}
          />
        ))}
      </div>
    </div>
  );
}
