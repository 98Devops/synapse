'use client';

import { fmtNum, isMeasurementWeek, measurementPlaceholders, weightTrend } from '../rules';
import { FOOD_OPTIONS, type Food, type RunLog } from '../types';
import { Check, NumInput, TextInput } from './Fields';
import { editCheckin, editMeasurement } from './store';

const TREND_TONE = {
  'on-track': 'text-green',
  below: 'text-amber',
  stall: 'text-amber',
  fast: 'text-rose',
} as const;

export function CheckinCard({ log, week }: { log: RunLog; week: number }) {
  const c = log[week]?.checkin;
  const trend = weightTrend(log, week);
  const prevWeight = [...Array(week - 1).keys()]
    .map((i) => week - 1 - i)
    .map((w) => log[w]?.checkin?.weight)
    .find((v) => v !== null && v !== undefined);

  return (
    <section className="panel rounded-2xl p-4" aria-label="Weekly check-in">
      <div className="label mb-3">Weekly check-in</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[12px] text-muted">Bodyweight (kg, morning)</label>
          <NumInput
            limit="weight"
            ariaLabel="Bodyweight in kg"
            value={c?.weight ?? null}
            placeholder={prevWeight !== undefined && prevWeight !== null ? fmtNum(prevWeight) : ''}
            onChange={(v) => editCheckin(week, { weight: v })}
            showError
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] text-muted">Average sleep (h)</label>
          <NumInput
            limit="sleep"
            ariaLabel="Average sleep in hours"
            value={c?.sleep ?? null}
            onChange={(v) => editCheckin(week, { sleep: v })}
            showError
          />
        </div>
      </div>

      {trend && (
        <div className="mt-3 rounded-xl border border-line bg-raised/60 p-3" role="status">
          <div className="mono text-[14px] text-ink">
            {trend.diffText} since week {trend.baseWeek} · {trend.perWeekText}
          </div>
          <div className={`mt-1 text-[13px] font-medium ${TREND_TONE[trend.status]}`}>{trend.message}</div>
          <div className="mt-1 text-[11px] text-faint">{trend.bandText}</div>
        </div>
      )}

      <div className="mt-3">
        <label className="mb-1 block text-[12px] text-muted" htmlFor={`food-${week}`}>
          Food this week
        </label>
        <select
          id={`food-${week}`}
          value={c?.food ?? ''}
          onChange={(e) => editCheckin(week, { food: (e.target.value || null) as Food | null })}
          className="focus-ring h-11 w-full rounded-lg border border-line bg-raised px-3 text-[14px] text-ink outline-none"
        >
          <option value="">—</option>
          {FOOD_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-[12px] text-muted">Notes</label>
        <TextInput
          multiline
          maxLength={4000}
          ariaLabel="Notes: energy, soreness, anything else"
          placeholder="Energy, soreness, anything else"
          value={c?.notes ?? null}
          onChange={(v) => editCheckin(week, { notes: v })}
        />
      </div>
    </section>
  );
}

const FIELDS = [
  { field: 'waist', label: 'Waist' },
  { field: 'chest', label: 'Chest' },
  { field: 'arm', label: 'Upper arm' },
  { field: 'thigh', label: 'Thigh' },
] as const;

/** Weeks 1, 4, 8 and 12 only; from week 4 the week 1 values are placeholders. */
export function MeasurementPanel({ log, week }: { log: RunLog; week: number }) {
  if (!isMeasurementWeek(week)) return null;
  const m = log[week]?.measurement;
  const base = measurementPlaceholders(log, week);

  return (
    <section className="panel rounded-2xl p-4" aria-label="Measurements">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Measurements · cm</span>
        {base && <span className="text-[11px] text-faint">grey = week 1</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(({ field, label }) => {
          const ph = base?.[field];
          return (
            <div key={field}>
              <label className="mb-1 block text-[12px] text-muted">{label}</label>
              <NumInput
                limit={field}
                ariaLabel={`${label} in cm`}
                value={m?.[field] ?? null}
                placeholder={ph !== null && ph !== undefined ? fmtNum(ph) : ''}
                onChange={(v) => editMeasurement(week, { [field]: v })}
                showError
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2">
        <Check
          checked={!!m?.photos}
          onChange={(v) => editMeasurement(week, { photos: v })}
          label="Front, side and back photos taken"
        />
      </div>
    </section>
  );
}
