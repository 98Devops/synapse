'use client';

import { useMemo } from 'react';
import { uniqueExercises } from '../program';
import { exerciseHistory, fmtNum, measurementDeltas, weighIns } from '../rules';
import type { Program, RunLog } from '../types';

/** Gap 6: bodyweight line, per-exercise best set and load, measurements vs week 1. */
export default function HistoryPanel({ program, log }: { program: Program; log: RunLog }) {
  const weights = useMemo(() => weighIns(log), [log]);
  const exercises = useMemo(
    () =>
      uniqueExercises(program)
        .map((ex) => ({ ex, points: exerciseHistory(log, ex.key, ex.unilateral) }))
        .filter((x) => x.points.length),
    [program, log]
  );
  const deltas = useMemo(() => measurementDeltas(log).filter((d) => d.base !== null || d.latest !== null), [log]);

  return (
    <details className="panel group rounded-2xl p-4">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between">
        <span className="label">History</span>
        <span className="text-[12px] text-faint group-open:hidden">Show</span>
        <span className="hidden text-[12px] text-faint group-open:inline">Hide</span>
      </summary>

      <div className="mt-3 space-y-5">
        <div>
          <div className="mb-1 text-[12px] text-muted">Bodyweight</div>
          {weights.length ? (
            <WeightChart points={weights} weeks={program.weeks} />
          ) : (
            <p className="text-[12px] text-faint">No weigh-ins yet.</p>
          )}
        </div>

        <div>
          <div className="mb-1 text-[12px] text-muted">Best set and load by week</div>
          {exercises.length ? (
            <ul className="divide-y divide-line">
              {exercises.map(({ ex, points }) => {
                const first = points[0];
                const last = points[points.length - 1];
                return (
                  <li key={ex.key} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{ex.name}</span>
                    <Sparkline values={points.map((p) => p.best ?? 0)} />
                    <span className="mono w-[118px] shrink-0 text-right text-[11px] text-muted">
                      w{first.week} {first.best}
                      {first !== last && ` → w${last.week} ${last.best}`}
                      {last.load ? ` @${fmtNum(last.load)}kg` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">No sets logged yet.</p>
          )}
        </div>

        {deltas.length > 0 && (
          <div>
            <div className="mb-1 text-[12px] text-muted">Measurements vs week 1 (cm)</div>
            <table className="mono w-full text-[12px]">
              <tbody>
                {deltas.map((d) => (
                  <tr key={d.field} className="border-b border-line last:border-0">
                    <td className="py-1.5 capitalize text-ink">{d.field === 'arm' ? 'upper arm' : d.field}</td>
                    <td className="py-1.5 text-right text-muted">{d.base !== null ? fmtNum(d.base) : '–'}</td>
                    <td className="py-1.5 text-right text-muted">
                      {d.latest !== null ? `${fmtNum(d.latest)} (w${d.latestWeek})` : '–'}
                    </td>
                    <td
                      className={`py-1.5 text-right ${d.diff === null ? 'text-faint' : d.diff >= 0 ? 'text-green' : 'text-amber'}`}
                    >
                      {d.diff === null ? '' : `${d.diff >= 0 ? '+' : ''}${fmtNum(d.diff)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

function WeightChart({ points, weeks }: { points: { week: number; weight: number }[]; weeks: number }) {
  const W = 320;
  const H = 120;
  const pad = { l: 30, r: 8, t: 8, b: 18 };
  const base = points[0];
  // dashed guide: 0.25 kg/week from the first weigh-in
  const target = (w: number) => base.weight + 0.25 * (w - base.week);
  const ys = [...points.map((p) => p.weight), target(weeks)];
  const lo = Math.floor(Math.min(...ys) - 0.5);
  const hi = Math.ceil(Math.max(...ys) + 0.5);
  const x = (w: number) => pad.l + ((w - 1) / Math.max(1, weeks - 1)) * (W - pad.l - pad.r);
  const y = (kg: number) => pad.t + (1 - (kg - lo) / Math.max(0.1, hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.week).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bodyweight by week">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--faint)" className="mono">
            {fmtNum(v)}
          </text>
        </g>
      ))}
      {[1, Math.ceil(weeks / 2), weeks].map((w) => (
        <text key={w} x={x(w)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--faint)" className="mono">
          w{w}
        </text>
      ))}
      <line
        x1={x(base.week)}
        y1={y(base.weight)}
        x2={x(weeks)}
        y2={y(target(weeks))}
        stroke="var(--muted)"
        strokeDasharray="3 4"
        opacity="0.6"
      />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p) => (
        <circle key={p.week} cx={x(p.week)} cy={y(p.weight)} r="3" fill="var(--accent)">
          <title>{`Week ${p.week}: ${fmtNum(p.weight)} kg`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 56;
  const H = 18;
  if (values.length < 2) return <span className="w-14 shrink-0" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - ((v - lo) / Math.max(1, hi - lo)) * (H - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
