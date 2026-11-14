'use client';

import { useState } from 'react';

import { GLOSSARY, TUTORIALS, BRAND } from '@/lib/constants';
import { AppShell } from '@/components/shell/AppShell';

/**
 * §11.1  5-video tutorial hub with the bilingual (EN + اردو) trading glossary.
 */
export default function TutorialsPage() {
  const [activeId, setActiveId] = useState<string>(TUTORIALS[0].id);

  const active = TUTORIALS.find((t) => t.id === activeId) ?? TUTORIALS[0];

  return (
    <AppShell>
      <main className="min-w-0 flex-1 space-y-3 p-3">
        <header className="card p-3">
          <h1 className="text-[18px] font-bold text-white">📘 Alpha X Scanner Tutorial Hub</h1>
          <p className="mt-1 text-[11.5px] text-text-secondary">
            The complete official series from{' '}
            <span className="font-semibold text-white">{BRAND.promoHeadline}</span> — every video with an English and
            Urdu summary.
          </p>
        </header>

        <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
          {/* Player */}
          <section className="space-y-2">
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black">
              <div className="aspect-video w-full">
                <iframe
                  key={active.id}
                  src={`https://www.youtube.com/embed/${active.id}?rel=0`}
                  title={active.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            </div>
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-amber-400">{active.lesson}</div>
              <h2 className="text-[14px] font-bold text-white">{active.title}</h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">{active.summary}</p>
              <p dir="rtl" lang="ur" className="ur mt-1.5 text-[12.5px] text-text-secondary">
                {active.summaryUr}
              </p>
            </div>
          </section>

          {/* Playlist */}
          <aside className="card max-h-[520px] overflow-y-auto p-2">
            <h3 className="mb-2 px-1 text-[12px] font-bold text-white">Playlist · {TUTORIALS.length} videos</h3>
            <ul className="space-y-1">
              {TUTORIALS.map((v, i) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(v.id)}
                    aria-current={activeId === v.id}
                    className={`flex w-full gap-2 rounded p-1.5 text-left transition-colors ${
                      activeId === v.id ? 'bg-amber-500/15 ring-1 ring-amber-500/40' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                      alt=""
                      className="h-[46px] w-[82px] shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                    <span className="min-w-0">
                      <span className="mono-num block text-[9.5px] font-bold text-amber-400">
                        {String(i + 1).padStart(2, '0')} · {v.duration}
                      </span>
                      <span className="block text-[11px] font-semibold leading-snug text-white line-clamp-2">
                        {v.title}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        {/* Glossary */}
        <section className="card p-3">
          <h2 className="text-[14px] font-bold text-white">📖 Bilingual Trading Glossary</h2>
          <p className="mt-0.5 text-[11px] text-text-secondary">
            Every term used across the Heatmap, Pro Table, Coin Finder and the five scanners — in English and اردو.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {GLOSSARY.map((g) => (
              <article key={g.term} className="rounded-lg border border-white/[0.06] bg-bg-card-2 p-2.5">
                <h3 className="text-[12px] font-bold text-amber-400">{g.term}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{g.en}</p>
                <p dir="rtl" lang="ur" className="ur mt-1.5 text-[12px] text-text-secondary">
                  {g.ur}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
