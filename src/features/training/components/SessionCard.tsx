'use client';

import { memo } from 'react';
import { exercisesFor } from '../program';
import {
  ADD_LOAD_TEXT,
  addLoadDue,
  fmtNum,
  formatLastTime,
  lastTime,
  loadIncreased,
  loadUpText,
} from '../rules';
import type { ExerciseLog, LastTime, Program, ProgramExercise, RunLog, SessionLog, Workout } from '../types';
import { NumInput, TextInput } from './Fields';
import RestTimer from './RestTimer';
import VoiceLog, { type ParsedItem } from './VoiceLog';
import { editEntry, editMany, editSession, editSet } from './store';

export function WorkoutBadge({ workout }: { workout: Workout }) {
  return (
    <span
      className={`mono grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[14px] font-bold ${
        workout === 'A' ? 'bg-accent-soft text-accent' : 'bg-cyan/15 text-cyan'
      }`}
      aria-label={`Workout ${workout}`}
    >
      {workout}
    </span>
  );
}

export default function SessionCard({
  program,
  log,
  week,
  slot,
  workout,
}: {
  program: Program;
  log: RunLog;
  week: number;
  slot: number;
  workout: Workout;
}) {
  const session: SessionLog | undefined = log[week]?.sessions[slot];
  const exercises = exercisesFor(program, workout);
  const done = !!session?.done;

  const saveVoice = (items: ParsedItem[]) => {
    editMany(
      items.flatMap((it) => [
        ...it.reps.flatMap((reps, index) =>
          reps === null && (it.repsRight?.[index] ?? null) === null
            ? []
            : [
                (runId: string) => ({
                  kind: 'set' as const,
                  runId,
                  week,
                  slot,
                  key: it.key,
                  index,
                  reps,
                  repsRight: it.repsRight?.[index] ?? null,
                }),
              ]
        ),
        ...(it.load !== null && it.load !== undefined
          ? [
              (runId: string) => ({
                kind: 'entry' as const,
                runId,
                week,
                slot,
                key: it.key,
                load: it.load,
                variation: log[week]?.sessions[slot]?.ex[it.key]?.variation ?? null,
              }),
            ]
          : []),
      ])
    );
  };

  return (
    <section
      className={`panel rounded-2xl p-3 transition-colors sm:p-4 ${
        done ? 'border-green/50 bg-green/[0.06]' : ''
      }`}
      aria-label={`Session ${slot + 1}, workout ${workout}`}
    >
      <header className="flex items-center gap-2.5">
        <WorkoutBadge workout={workout} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink">Session {slot + 1}</div>
          <div className="label">Workout {workout}</div>
        </div>
        <label
          className={`flex h-11 cursor-pointer select-none items-center gap-2 rounded-lg border px-2.5 ${
            done ? 'border-green/60 text-green' : 'border-line text-muted'
          }`}
        >
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => editSession(week, slot, { done: e.target.checked })}
            className="h-5 w-5 accent-green"
          />
          <span className="text-[13px] font-medium">Done</span>
        </label>
      </header>

      <div className="mt-3 space-y-2 border-y border-line py-2">
        <div className="flex items-center justify-between gap-2">
          <input
            type="date"
            value={session?.date ?? ''}
            onChange={(e) => editSession(week, slot, { date: e.target.value || null })}
            aria-label={`Session ${slot + 1} date`}
            className="mono focus-ring h-11 w-[136px] rounded-lg border border-line bg-raised px-2 text-[13px] text-ink outline-none"
          />
          <RestTimer />
        </div>
        <VoiceLog workout={workout} exercises={exercises} onConfirm={saveVoice} />
      </div>

      <div className="divide-y divide-line">
        {exercises.map((ex) => (
          <ExerciseRow
            key={ex.key}
            ex={ex}
            week={week}
            slot={slot}
            entry={session?.ex[ex.key]}
            last={lastTime(log, week, slot, ex.key)}
          />
        ))}
      </div>
    </section>
  );
}

const ExerciseRow = memo(function ExerciseRow({
  ex,
  week,
  slot,
  entry,
  last,
}: {
  ex: ProgramExercise;
  week: number;
  slot: number;
  entry: ExerciseLog | undefined;
  last: LastTime | null;
}) {
  const due = addLoadDue(entry, ex);
  const loadUp = loadIncreased(entry?.load, last);
  const lastLine = formatLastTime(last, ex.sets);
  const sets = Array.from({ length: ex.sets }, (_, i) => i);
  const ph = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <span className="mono w-6 shrink-0 text-[11px] text-faint">{ex.code}</span>
        <span className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-ink">{ex.name}</span>
        <span className="mono shrink-0 text-[12px] text-muted">
          {ex.sets} × {ex.repLo}–{ex.repHi}
          {ex.note && <span className="text-faint"> · {ex.note}</span>}
        </span>
      </div>

      <div className="mt-2 flex items-end gap-2 pl-8">
        <div className="grid flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${ex.sets}, minmax(0, 1fr))` }}>
          {sets.map((i) => (
            <div key={i} className="min-w-0">
              <div className="label mb-1 text-center">Set {i + 1}</div>
              {ex.unilateral ? (
                <div className="grid gap-1">
                  <NumInput
                    limit="reps"
                    ariaLabel={`${ex.name} set ${i + 1} left reps`}
                    value={entry?.reps[i] ?? null}
                    placeholder={last ? `L ${ph(last.reps[i])}`.trim() : 'L'}
                    onChange={(v) => editSet(week, slot, ex.key, i, 'left', v)}
                  />
                  <NumInput
                    limit="reps"
                    ariaLabel={`${ex.name} set ${i + 1} right reps`}
                    value={entry?.repsRight[i] ?? null}
                    placeholder={
                      last ? `R ${ph(last.repsRight[i] ?? (last.repsRight.length ? null : last.reps[i]))}`.trim() : 'R'
                    }
                    onChange={(v) => editSet(week, slot, ex.key, i, 'right', v)}
                  />
                </div>
              ) : (
                <NumInput
                  limit="reps"
                  ariaLabel={`${ex.name} set ${i + 1} reps`}
                  value={entry?.reps[i] ?? null}
                  placeholder={ph(last?.reps[i])}
                  onChange={(v) => editSet(week, slot, ex.key, i, 'left', v)}
                />
              )}
            </div>
          ))}
        </div>
        <div className="w-[68px] shrink-0">
          <div className="label mb-1 text-center">kg</div>
          <NumInput
            limit="load"
            ariaLabel={`${ex.name} load in kg`}
            value={entry?.load ?? null}
            placeholder={last?.load !== null && last?.load !== undefined ? fmtNum(last.load) : ''}
            onChange={(v) => editEntry(week, slot, ex.key, { load: v })}
          />
        </div>
      </div>

      <div className="mt-1.5 space-y-1 pl-8">
        {lastLine && <p className="mono text-[12px] text-faint">{lastLine}</p>}
        {due && (
          <p className="rounded-md bg-green/10 px-2 py-1 text-[12px] font-medium text-green" role="status">
            {ADD_LOAD_TEXT}
          </p>
        )}
        {loadUp && (
          <p className="rounded-md bg-amber/10 px-2 py-1 text-[12px] font-medium text-amber" role="status">
            {loadUpText(ex)}
          </p>
        )}
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center text-[12px] text-faint hover:text-muted">
            {entry?.variation ? (
              <span className="text-muted">Variation: {entry.variation}</span>
            ) : (
              <span>+ variation / tempo{last?.variation ? ` (last: ${last.variation})` : ''}</span>
            )}
          </summary>
          <TextInput
            ariaLabel={`${ex.name} variation`}
            value={entry?.variation ?? null}
            placeholder={last?.variation ?? 'e.g. 3 s lowering, deficit, slower tempo'}
            onChange={(v) => editEntry(week, slot, ex.key, { variation: v })}
          />
        </details>
      </div>
    </div>
  );
});
