'use client';

import { useMemo, useState } from 'react';

import { BRAND, GLOSSARY } from '@/lib/constants';
import { ACADEMY_AUTHOR, PLAYBOOKS } from '@/lib/academy';
import { AppShell } from '@/components/shell/AppShell';
import { StrategyDiagram } from '@/components/academy/StrategyDiagram';
import { TiltCard } from '@/components/ui/Motion3D';
import { Icon, type IconName } from '@/components/ui/Icons';

/**
 * §6  ALPHA X STRATEGY ACADEMY.
 *
 * Replaces the five legacy YouTube embeds with a native, searchable playbook:
 * six institutional blueprints (each with a schematic SVG diagram), the
 * trading glossary, and a direct support banner for Muhammad Ibrahim.
 */
export default function TutorialsPage() {
  const [activeId, setActiveId] = useState<string>(PLAYBOOKS[0].id);
  const [query, setQuery] = useState('');

  const active = PLAYBOOKS.find((p) => p.id === activeId) ?? PLAYBOOKS[0];

  const glossary = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GLOSSARY;
    return GLOSSARY.filter((g) => g.term.toLowerCase().includes(q) || g.en.toLowerCase().includes(q));
  }, [query]);

  return (
    <AppShell>
      <main className="min-w-0 flex-1 space-y-3 p-3">
        <header className="card p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-400">
                Alpha X Strategy Academy
              </div>
              <h1 className="mt-0.5 text-[18px] font-bold text-white">
                The Playbook Behind Every Scanner
              </h1>
              <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-text-secondary">
                Six institutional blueprints authored by{' '}
                <span className="font-semibold text-white">{ACADEMY_AUTHOR}</span> — the exact entry trigger,
                invalidation level and TP1 / TP2 ladder each scanner automates. Every level is expressed in R
                multiples so the blueprint scales to any timeframe and any account size.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-emerald-500/45 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
                {PLAYBOOKS.length} modules
              </span>
              <span className="rounded-full border border-violet-500/45 bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-300">
                {GLOSSARY.length} glossary terms
              </span>
            </div>
          </div>
        </header>

        <div className="grid gap-3 xl:grid-cols-[260px_1fr]">
          {/* Module rail */}
          <aside className="card h-fit overflow-hidden p-2">
            <h2 className="px-1 pb-2 text-[12px] font-bold text-white">Modules</h2>
            <ul className="space-y-1">
              {PLAYBOOKS.map((p) => {
                const on = p.id === activeId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(p.id)}
                      aria-current={on}
                      className={`flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors ${
                        on ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <span
                        className={`mono-num mt-0.5 shrink-0 text-[9.5px] font-bold ${
                          on ? 'text-emerald-400' : 'text-text-muted'
                        }`}
                      >
                        {p.lesson.replace('Module ', '')}
                      </span>
                      <span className={`min-w-0 text-[11px] font-semibold leading-snug ${on ? 'text-white' : 'text-text-secondary'}`}>
                        {p.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Active blueprint */}
          <section className="space-y-3">
            <article className="card overflow-hidden">
              <header className="border-b border-white/[0.06] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono-num text-[9.5px] font-bold uppercase tracking-wider text-emerald-400">
                    {active.lesson}
                  </span>
                  {active.scanner ? (
                    <span className="rounded-full border border-violet-500/45 bg-violet-500/10 px-2 py-0.5 text-[9.5px] font-bold text-violet-300">
                      Automated by {active.scanner}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-1 text-[15px] font-bold text-white">{active.title}</h2>
                <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">{active.summary}</p>
              </header>

              {/* Schematic blueprint */}
              <div className="border-b border-white/[0.06] bg-black/40 p-3">
                <StrategyDiagram kind={active.diagram} />
              </div>

              {/* Confluence checklist */}
              <div className="grid gap-3 border-b border-white/[0.06] p-3 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-white">
                    <Icon name="check" className="h-3.5 w-3.5 text-emerald-400" />
                    Confluence checklist
                  </h3>
                  <ul className="space-y-1.5">
                    {active.checklist.map((c) => (
                      <li key={c} className="flex gap-2 text-[11px] leading-relaxed text-text-secondary">
                        <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-white">
                    <Icon name="crosshair" className="h-3.5 w-3.5 text-emerald-400" />
                    Execution rules
                  </h3>
                  <dl className="space-y-1.5">
                    {active.rules.map((r) => (
                      <div key={r.label} className="rounded-lg border border-white/[0.06] bg-bg-card-2 px-2.5 py-1.5">
                        <dt className="text-[9.5px] font-bold uppercase tracking-wider text-text-muted">
                          {r.label}
                        </dt>
                        <dd className="mono-num mt-0.5 text-[11px] leading-relaxed text-text-bright">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              {/* Invalidation */}
              <div className="p-3">
                <div className="rounded-lg border border-red-500/40 bg-red-500/[0.07] p-2.5">
                  <div className="text-[9.5px] font-bold uppercase tracking-wider text-red-400">
                    What invalidates this
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{active.invalidation}</p>
                </div>
              </div>
            </article>

            {/* Glossary */}
            <section className="card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[14px] font-bold text-white">📖 Institutional Trading Glossary</h2>
                <label className="relative">
                  <span className="sr-only">Search the glossary</span>
                  <Icon
                    name="search"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search terms…"
                    className="input w-56 pl-8 text-[11px]"
                  />
                </label>
              </div>
              <p className="mt-0.5 text-[10.5px] text-text-muted">
                {glossary.length} of {GLOSSARY.length} terms
                {query ? ` matching “${query}”` : ''}.
              </p>

              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {glossary.map((g) => (
                  <article key={g.term} className="rounded-lg border border-white/[0.06] bg-bg-card-2 p-2.5">
                    <h3 className="text-[12px] font-bold text-amber-400">{g.term}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{g.en}</p>
                  </article>
                ))}
                {glossary.length === 0 ? (
                  <p className="col-span-full py-6 text-center text-[11px] text-text-muted">
                    No glossary terms match “{query}”.
                  </p>
                ) : null}
              </div>
            </section>
          </section>
        </div>

        {/* Support banner */}
        <TiltCard className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}
              >
                <Icon name="volume" className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[13px] font-bold text-white">Need the blueprints walked through live?</div>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  Message {ACADEMY_AUTHOR} on WhatsApp for one-to-one guidance, licence keys and renewal.
                </p>
              </div>
            </div>
            <a
              href={BRAND.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-green whitespace-nowrap"
            >
              Contact {ACADEMY_AUTHOR} ({BRAND.whatsappContact}) ↗
            </a>
          </div>
        </TiltCard>
      </main>
    </AppShell>
  );
}
