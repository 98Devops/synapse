'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { PROGRESSION_ORDER } from '../program';
import { sessionOrder } from '../rules';
import type { WeekPayload } from '../types';
import HistoryPanel from './HistoryPanel';
import SessionCard from './SessionCard';
import StartPanel, { ImportForm, StartForm } from './StartPanel';
import { CheckinCard, MeasurementPanel } from './WeekPanels';
import { goToWeek, load, retryNow, useTraining, type SaveState } from './store';

/**
 * The training log. `/training` opens on the current week; `/training/week/n`
 * on week n. Week steps swap state and the URL in place, without a route
 * change, so unsaved edits and focus are never thrown away.
 */
export default function TrainingApp({ initialWeek }: { initialWeek?: number }) {
  const s = useTraining();

  useEffect(() => {
    void load(initialWeek ?? 'current');
  }, [initialWeek]);

  const p = s.payload;
  const weeks = p?.program.weeks ?? 12;

  const step = (w: number) => {
    const next = Math.min(weeks, Math.max(1, w));
    if (next === s.week) return;
    goToWeek(next);
    window.history.replaceState(window.history.state, '', `/training/week/${next}`);
    window.scrollTo({ top: 0 });
  };

  const reload = () => void load('current');

  return (
    <div className="mx-auto min-h-full max-w-[640px] pb-[calc(env(safe-area-inset-bottom,0px)+32px)]">
      <Header payload={p} week={s.week} save={s.save} saveError={s.saveError} onStep={step} />

      <main className="space-y-3 px-3 pt-3 sm:px-4">
        {s.loadError && (
          <p className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
            {s.loadError}
          </p>
        )}

        {!p && s.phase === 'loading' && <Skeleton />}

        {!p && s.phase === 'error' && (
          <div className="panel rounded-2xl p-4 text-[14px] text-muted">
            Could not load the log.{' '}
            <button type="button" className="text-accent underline" onClick={reload}>
              Try again
            </button>
          </div>
        )}

        {p && !p.run && <StartPanel program={p.program} onStarted={reload} />}

        {p?.run && (
          <>
            {p.current.complete && (
              <section className="panel rounded-2xl border-green/40 p-4">
                <div className="text-[16px] font-semibold text-green">Program complete</div>
                <p className="mt-1 text-[13px] text-muted">
                  All {weeks} weeks are behind you. Your log stays here; start the next block when you are ready.
                </p>
                <StartForm onStarted={reload} label="Start next program" />
              </section>
            )}

            <Guidance />

            {sessionOrder(s.week).map((workout, slot) => (
              <SessionCard
                key={`${s.week}:${slot}`}
                program={p.program}
                log={p.log}
                week={s.week}
                slot={slot}
                workout={workout}
              />
            ))}

            <CheckinCard key={`c${s.week}`} log={p.log} week={s.week} />
            <MeasurementPanel key={`m${s.week}`} log={p.log} week={s.week} />
            <HistoryPanel program={p.program} log={p.log} />
            <ImportForm onImported={reload} />
          </>
        )}
      </main>
    </div>
  );
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline — will retry',
  error: 'Not saved',
};

function Header({
  payload,
  week,
  save,
  saveError,
  onStep,
}: {
  payload: WeekPayload | null;
  week: number;
  save: SaveState;
  saveError: string | null;
  onStep: (w: number) => void;
}) {
  const weeks = payload?.program.weeks ?? 12;
  const hasRun = !!payload?.run;
  const current = payload?.current.week;

  return (
    <header
      className="sticky top-0 z-20 border-b border-line px-3 pb-2 sm:px-4"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <div className="flex items-center gap-1">
        <Link
          href="/"
          aria-label="Back to Synapse"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:text-ink"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        {hasRun ? (
          <div className="flex flex-1 items-center justify-center gap-1">
            <StepButton dir={-1} disabled={week <= 1} onClick={() => onStep(week - 1)} />
            <div className="min-w-[112px] text-center">
              <div className="text-[17px] font-bold leading-tight text-ink">
                Week {week}
                <span className="mono text-[12px] font-normal text-faint"> / {weeks}</span>
              </div>
              {current !== undefined &&
                (current === week ? (
                  <div className="label text-accent">this week</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStep(current)}
                    className="label underline decoration-dotted underline-offset-2 hover:text-ink"
                  >
                    go to week {current}
                  </button>
                ))}
            </div>
            <StepButton dir={1} disabled={week >= weeks} onClick={() => onStep(week + 1)} />
          </div>
        ) : (
          <div className="flex-1 text-center text-[16px] font-semibold text-ink">Training</div>
        )}

        <div className="flex w-[92px] shrink-0 justify-end">
          <SaveChip save={save} error={saveError} />
        </div>
      </div>
    </header>
  );
}

function StepButton({ dir, disabled, onClick }: { dir: -1 | 1; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir < 0 ? 'Previous week' : 'Next week'}
      className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink transition disabled:opacity-30"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d={dir < 0 ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function SaveChip({ save, error }: { save: SaveState; error: string | null }) {
  if (save === 'idle') return null;
  const tone =
    save === 'saved' ? 'text-green' : save === 'saving' ? 'text-muted' : save === 'offline' ? 'text-amber' : 'text-rose';
  const retry = save === 'offline' || save === 'error';
  return (
    <div className={`text-right text-[11px] leading-tight ${tone}`} role="status" aria-live="polite" title={error ?? undefined}>
      <div>{SAVE_LABEL[save]}</div>
      {retry && (
        <button type="button" onClick={retryNow} className="mt-0.5 underline underline-offset-2">
          {save === 'error' ? error?.slice(0, 40) || 'Retry' : 'Retry now'}
        </button>
      )}
    </div>
  );
}

function Guidance() {
  return (
    <details className="panel rounded-2xl px-4 py-3">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between">
        <span className="label">How to progress</span>
        <span className="text-[12px] text-faint">Supersets · 2–3 min rest</span>
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-muted">
        {PROGRESSION_ORDER.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] leading-relaxed text-faint">
        Do exercise 1, then exercise 2 straight after, then rest. With a one-leg exercise, do both legs before the
        partner exercise. Stop most sets with 1–2 good reps left; the last set can go close to failure.
      </p>
    </details>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="panel h-40 overflow-hidden rounded-2xl">
          <div className="shimmer h-full w-full opacity-30" />
        </div>
      ))}
    </div>
  );
}
