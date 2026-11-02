'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { computeSignals } from '@/lib/patterns';
import type { Highlight, HighlightKind } from '@/lib/highlights';
import type { Note } from '@/lib/types';

const KIND_STYLE: Record<HighlightKind, { label: string; color: string }> = {
  theme: { label: 'theme', color: 'var(--accent)' },
  shift: { label: 'shift', color: 'var(--cyan)' },
  loop: { label: 'loop', color: 'var(--amber)' },
  link: { label: 'link', color: 'var(--rose)' },
  growth: { label: 'growth', color: 'var(--green)' },
  nudge: { label: 'next step', color: 'var(--accent)' },
};

const CACHE_KEY = 'synapse:highlights';

interface Props {
  notes: Note[];
  onSelect: (id: string) => void;
}

/**
 * "How you're evolving." Deterministic signals render instantly from the notes
 * already on the client; the LLM highlights load from cache, then refresh in
 * the background when there is something new to notice.
 */
export default function EvolutionPanel({ notes, onSelect }: Props) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generating = useRef(false);

  const signals = useMemo(() => computeSignals(notes), [notes]);
  const titleOf = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes]);

  const keep = (list: Highlight[]) => {
    setHighlights(list);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch {}
  };

  const generate = useCallback(async () => {
    if (generating.current) return;
    generating.current = true;
    setThinking(true);
    setError(null);
    try {
      const res = await fetch('/api/highlights', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      keep(data.highlights ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      generating.current = false;
      setThinking(false);
    }
  }, []);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setHighlights(JSON.parse(cached));
    } catch {}
    fetch('/api/highlights')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        keep(d.highlights ?? []);
        if (d.stale && navigator.onLine) generate();
      })
      .catch((err) => setError((err as Error).message));
  }, [generate]);

  const rate = (h: Highlight, feedback: 'useful' | 'not_useful') => {
    const next = feedback === 'not_useful'
      ? highlights.filter((x) => x.id !== h.id)
      : highlights.map((x) => (x.id === h.id ? { ...x, feedback } : x));
    keep(next);
    fetch(`/api/highlights/${h.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    }).catch(() => {});
  };

  const moodDelta = signals.mood.recent.positive - signals.mood.before.positive;
  const heavyDelta =
    signals.mood.recent.negative + signals.mood.recent.urgent -
    (signals.mood.before.negative + signals.mood.before.urgent);

  // Only meaningful with notes on both sides of the window.
  const showMood =
    signals.captureRate.beforePerWeek > 0 && signals.captureRate.recentPerWeek > 0 && Math.abs(heavyDelta) >= 0.15;
  const hasSignals = signals.rising.length || signals.fading.length || signals.loops.length || showMood;

  return (
    <div className="panel rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">How you&apos;re evolving</span>
        <button
          onClick={generate}
          disabled={thinking || notes.length === 0}
          className="mono rounded-md px-2 py-1 text-[10px] text-muted transition hover:bg-accent-soft hover:text-ink disabled:opacity-50"
        >
          {thinking ? 'noticing…' : 'refresh'}
        </button>
      </div>

      {/* ---- instant signals ---- */}
      {hasSignals ? (
        <div className="mb-4 space-y-2.5">
          {signals.rising.length > 0 && (
            <SignalRow label="rising" tone="text-cyan">
              {signals.rising.map((t) => (
                <Chip key={t.name} onClick={() => onSelect(t.noteIds[0])}>
                  {t.name} <span className="text-faint">↑{t.recent}</span>
                </Chip>
              ))}
            </SignalRow>
          )}
          {signals.loops.length > 0 && (
            <SignalRow label="circling" tone="text-amber">
              {signals.loops.map((l) => (
                <Chip key={l.name} onClick={() => onSelect(l.noteIds[0])}>
                  {l.name} <span className="text-faint">×{l.count}</span>
                </Chip>
              ))}
            </SignalRow>
          )}
          {signals.fading.length > 0 && (
            <SignalRow label="gone quiet" tone="text-muted">
              {signals.fading.map((t) => (
                <Chip key={t.name} onClick={() => onSelect(t.noteIds[0])}>
                  {t.name}
                </Chip>
              ))}
            </SignalRow>
          )}
          {showMood && (
            <p className="text-[11.5px] leading-snug text-muted">
              {heavyDelta > 0
                ? `More of your recent notes carry weight (${Math.round(heavyDelta * 100)} pts more negative/urgent than before).`
                : `Your recent notes are lighter — ${Math.round(-heavyDelta * 100)} pts less negative/urgent than before${moodDelta > 0 ? ', and more positive' : ''}.`}
            </p>
          )}
        </div>
      ) : (
        notes.length > 0 && (
          <p className="mb-3 text-[11.5px] leading-snug text-muted">
            Patterns sharpen with every note. Keep capturing — a couple of weeks in, shifts and loops start to show.
          </p>
        )
      )}

      {/* ---- learned highlights ---- */}
      <div className="space-y-2.5">
        {thinking && highlights.length === 0 && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 overflow-hidden rounded-xl bg-bg/40">
                <div className="shimmer h-full w-full opacity-30" />
              </div>
            ))}
          </div>
        )}

        <AnimatePresence initial={false}>
          {highlights.map((h) => {
            const k = KIND_STYLE[h.kind] ?? KIND_STYLE.theme;
            return (
              <motion.div
                key={h.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="rounded-xl border border-line bg-bg/30 p-3"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="mono text-[9px] uppercase tracking-wider" style={{ color: k.color }}>
                    {k.label}
                  </span>
                  <span className="flex-1" />
                  <button
                    onClick={() => rate(h, 'useful')}
                    aria-label="Useful"
                    title="Useful — show me more like this"
                    className={`rounded p-1 transition ${h.feedback === 'useful' ? 'text-green' : 'text-faint hover:text-green'}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7 10v11M2 12v7a2 2 0 0 0 2 2h12.4a2 2 0 0 0 2-1.6l1.4-7A2 2 0 0 0 17.8 10H14V5a3 3 0 0 0-3-3l-4 8" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    onClick={() => rate(h, 'not_useful')}
                    aria-label="Not useful"
                    title="Not useful — less of this"
                    className="rounded p-1 text-faint transition hover:text-rose"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 14V3M22 12V5a2 2 0 0 0-2-2H7.6a2 2 0 0 0-2 1.6l-1.4 7A2 2 0 0 0 6.2 14H10v5a3 3 0 0 0 3 3l4-8" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                <div className="text-[13px] font-semibold leading-snug text-ink">{h.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink/80">{h.body}</p>
                {h.noteIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {h.noteIds.filter((id) => titleOf.has(id)).map((id) => (
                      <button
                        key={id}
                        onClick={() => onSelect(id)}
                        className="mono max-w-full truncate rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] text-muted transition hover:text-ink"
                      >
                        {titleOf.get(id)}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {!thinking && highlights.length === 0 && notes.length > 0 && !error && (
          <p className="text-[11.5px] text-muted">Tap refresh to have Synapse read across everything you&apos;ve said.</p>
        )}
        {error && <p className="text-[11.5px] text-rose">{error}</p>}
      </div>
    </div>
  );
}

function SignalRow({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mono w-[68px] shrink-0 pt-1 text-[9px] uppercase tracking-wider ${tone}`}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-line bg-bg/40 px-2.5 py-1 text-[11.5px] text-ink/90 transition hover:border-accent/50"
    >
      {children}
    </button>
  );
}
