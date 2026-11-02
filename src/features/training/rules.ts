/**
 * The log's rules as pure functions (spec: docs/specs/size-blueprint-log.md,
 * "Logic and rules"). Shared by client and server; no app imports.
 */
import type {
  CheckIn,
  CurrentWeek,
  ExerciseLog,
  LastTime,
  Measurement,
  ProgramExercise,
  RunLog,
  SessionLog,
  TrainingOp,
  WeekLog,
  WeightTrend,
  Workout,
} from './types';

export const TIME_ZONE = 'Africa/Harare';
export const MEASUREMENT_WEEKS = [1, 4, 8, 12];
export const SLOTS = [0, 1, 2] as const;

/** Gap 5: validation ranges, shared by the API (zod) and the inputs. */
export const LIMITS = {
  reps: { min: 0, max: 100, integer: true },
  load: { min: 0, max: 60, integer: false },
  weight: { min: 30, max: 150, integer: false },
  sleep: { min: 0, max: 24, integer: false },
  waist: { min: 20, max: 250, integer: false },
  chest: { min: 20, max: 250, integer: false },
  arm: { min: 10, max: 100, integer: false },
  thigh: { min: 10, max: 150, integer: false },
} as const;
export type LimitName = keyof typeof LIMITS;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// =============================================================== 1. week
/** Today's calendar date in the given zone, as YYYY-MM-DD. */
export function dateInZone(now: Date = new Date(), timeZone: string = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days since the epoch for a YYYY-MM-DD date (no time-of-day, no DST). */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

/**
 * Gap 8: "today" is the date in Africa/Harare, and the day math is date-only,
 * so a late-night session never lands in the wrong week. Past the last week
 * the week stays clamped and `complete` turns true.
 */
export function currentWeek(
  start: string | null | undefined,
  now: Date = new Date(),
  programWeeks = 12,
  timeZone: string = TIME_ZONE
): CurrentWeek {
  if (!start || !ISO_DATE.test(start)) return { week: 1, complete: false };
  const days = dayNumber(dateInZone(now, timeZone)) - dayNumber(start);
  const raw = Math.floor(days / 7) + 1;
  return { week: Math.min(programWeeks, Math.max(1, raw)), complete: raw > programWeeks };
}

// ======================================================= 2. session order
export function sessionOrder(week: number): Workout[] {
  return week % 2 === 1 ? ['A', 'B', 'A'] : ['B', 'A', 'B'];
}

// ========================================================== 3. last time
const hasRep = (v: number | null | undefined) => v !== null && v !== undefined;

export function entryHasReps(e: ExerciseLog | undefined | null): boolean {
  return !!e && (e.reps.some(hasRep) || (e.repsRight ?? []).some(hasRep));
}

/**
 * Search backwards for the target to beat: earlier sessions in the same week
 * first, then sessions 2, 1, 0 of each earlier week. The first entry with at
 * least one rep wins. Keyed by exercise key only, so shared keys (lateral,
 * curls) match across workouts.
 */
export function lastTime(log: RunLog, week: number, slot: number, key: string): LastTime | null {
  for (let w = week; w >= 1; w--) {
    const from = w === week ? slot - 1 : 2;
    for (let s = from; s >= 0; s--) {
      const session = log[w]?.sessions?.[s];
      const e = session?.ex?.[key];
      if (entryHasReps(e)) {
        return {
          week: w,
          slot: s,
          date: session!.date ?? null,
          reps: [...e!.reps],
          repsRight: [...(e!.repsRight ?? [])],
          load: e!.load,
          variation: e!.variation,
        };
      }
    }
  }
  return null;
}

/** 2 -> "2", 2.5 -> "2.5", 2.25 -> "2.25". */
export function fmtNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** One set as shown in "Last time": 12, or 10/9 for left/right. */
export function setLabel(left: number | null | undefined, right: number | null | undefined): string {
  if (!hasRep(left) && !hasRep(right)) return '–';
  if (!hasRep(right)) return String(left);
  return `${hasRep(left) ? left : '–'}/${right}`;
}

/** "Last time: 12 · 10 · 9 with 2 kg" — missing sets show –. */
export function formatLastTime(last: LastTime | null, sets: number): string | null {
  if (!last) return null;
  const parts = Array.from({ length: sets }, (_, i) => setLabel(last.reps[i], last.repsRight[i]));
  const load = last.load !== null && last.load > 0 ? ` with ${fmtNum(last.load)} kg` : '';
  return `Last time: ${parts.join(' · ')}${load}`;
}

// ===================================================== 4. add-load prompt
/**
 * Reps counted for one set. Gap 3: unilateral work counts the weaker side, and
 * a set is only filled when both sides are. Entries that never recorded a right
 * side (imported from the old single-count log) fall back to the one count.
 */
export function effectiveReps(entry: ExerciseLog | null | undefined, unilateral: boolean): (number | null)[] {
  if (!entry) return [];
  if (!unilateral) return entry.reps.map((v) => (hasRep(v) ? v : null));
  const right = entry.repsRight ?? [];
  if (!right.some(hasRep)) return entry.reps.map((v) => (hasRep(v) ? v : null));
  const len = Math.max(entry.reps.length, right.length);
  return Array.from({ length: len }, (_, i) => {
    const l = entry.reps[i];
    const r = right[i];
    return hasRep(l) && hasRep(r) ? Math.min(l!, r!) : null;
  });
}

/** Every planned set filled and at or above the top of the range. */
export function addLoadDue(entry: ExerciseLog | null | undefined, ex: ProgramExercise): boolean {
  const r = effectiveReps(entry, ex.unilateral).slice(0, ex.sets);
  return r.length === ex.sets && r.every((v) => v !== null && v >= ex.repHi);
}

export const ADD_LOAD_TEXT = 'Top of range on every set. Add load next time.';

/**
 * Gap 7: after a load increase, remind the user to drop to the bottom of the
 * range. A previous session without load counts as 0 kg.
 */
export function loadIncreased(current: number | null | undefined, last: LastTime | null): boolean {
  if (!last || current === null || current === undefined) return false;
  return current > (last.load ?? 0);
}

export function loadUpText(ex: ProgramExercise): string {
  return `Load up — start again at the bottom of the range (${ex.repLo} reps).`;
}

// ======================================================= 5. weight trend
const signed = (n: number, digits: number) => {
  const s = n.toFixed(digits);
  // -0.0 reads as no change, not a loss
  return Number(s) === 0 ? `+${(0).toFixed(digits)}` : n > 0 ? `+${s}` : s;
};

export interface WeighIn {
  week: number;
  weight: number;
}

export function weighIns(log: RunLog): WeighIn[] {
  return Object.keys(log)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((w) => hasRep(log[w]?.checkin?.weight))
    .map((w) => ({ week: w, weight: log[w].checkin.weight as number }));
}

/**
 * The baseline is the first week with a weight. For a later week with a
 * weight, the average weekly change is compared with a target that scales with
 * bodyweight (gap 1) — max(0.25 kg, 0.25 % of current weight) — and a stall
 * check (gap 2) overrides it: three or more weigh-ins where the latest is no
 * higher than the one two entries before means "flat for 2 weeks".
 */
export function weightTrend(log: RunLog, week: number): WeightTrend | null {
  const all = weighIns(log);
  const upTo = all.filter((x) => x.week <= week);
  if (upTo.length < 2) return null;
  const base = upTo[0];
  const cur = upTo[upTo.length - 1];
  if (cur.week !== week || cur.week <= base.week) return null;

  const diff = cur.weight - base.weight;
  const perWeek = diff / (cur.week - base.week);
  const target = Math.max(0.25, 0.0025 * cur.weight);
  const fast = Math.max(0.5, 0.005 * cur.weight);
  const band = { lo: 0.0025 * cur.weight, hi: 0.005 * cur.weight };

  const stalled = upTo.length >= 3 && cur.weight <= upTo[upTo.length - 3].weight;

  let status: WeightTrend['status'];
  let message: string;
  if (stalled) {
    status = 'stall';
    message = 'Flat for 2 weeks, add about 300 calories a day.';
  } else if (perWeek < target) {
    status = 'below';
    message = `Below the ${target.toFixed(2)} kg/week target, so add about 300 calories a day.`;
  } else if (perWeek > fast) {
    status = 'fast';
    message = `Faster than ${fast.toFixed(2)} kg/week, likely adding fat. Ease off about 200 calories a day.`;
  } else {
    status = 'on-track';
    message = 'On track';
  }

  return {
    baseWeek: base.week,
    baseWeight: base.weight,
    week: cur.week,
    current: cur.weight,
    diff,
    perWeek,
    status,
    diffText: `${signed(diff, 1)} kg`,
    perWeekText: `${signed(perWeek, 2)} kg/week`,
    message,
    band,
    bandText: `Plan: ${band.lo.toFixed(2)}–${band.hi.toFixed(2)} kg/week at ${fmtNum(cur.weight)} kg`,
  };
}

/** Prompts that mean "eat more". */
export const needsMoreFood = (t: WeightTrend | null) => t?.status === 'below' || t?.status === 'stall';

// =================================================== 6. measurement weeks
export function isMeasurementWeek(week: number): boolean {
  return MEASUREMENT_WEEKS.includes(week);
}

/** From week 4 on, week 1's values are shown as placeholders. */
export function measurementPlaceholders(log: RunLog, week: number): Measurement | null {
  if (!isMeasurementWeek(week) || week === 1) return null;
  return log[1]?.measurement ?? null;
}

// ====================================================== validation helper
/** Parses user text into a number within a limit. "" -> null; invalid -> undefined. */
export function parseField(text: string, limit: LimitName): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.$/.test(t)) return undefined;
  const n = Number(t);
  const l = LIMITS[limit];
  if (!Number.isFinite(n) || n < l.min || n > l.max) return undefined;
  if (l.integer && !Number.isInteger(n)) return undefined;
  return n;
}

// ================================================================ log ops
export function emptyCheckin(): CheckIn {
  return { weight: null, sleep: null, food: null, notes: null };
}

export function emptySession(): SessionLog {
  return { date: null, done: false, ex: {} };
}

export function emptyWeek(): WeekLog {
  return { sessions: [emptySession(), emptySession(), emptySession()], checkin: emptyCheckin(), measurement: null };
}

export function emptyEntry(): ExerciseLog {
  return { reps: [], repsRight: [], load: null, variation: null };
}

const trimTrailingNulls = (a: (number | null)[]) => {
  const out = [...a];
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};

/** Immutable update: returns a new log with the op applied. */
export function applyOp(log: RunLog, op: TrainingOp): RunLog {
  const week: WeekLog = log[op.week]
    ? { ...log[op.week], sessions: [...log[op.week].sessions] }
    : emptyWeek();
  while (week.sessions.length < 3) week.sessions.push(emptySession());

  switch (op.kind) {
    case 'set':
    case 'entry': {
      const session = { ...week.sessions[op.slot], ex: { ...week.sessions[op.slot].ex } };
      const entry = { ...(session.ex[op.key] ?? emptyEntry()) };
      if (op.kind === 'set') {
        const reps = [...entry.reps];
        const right = [...(entry.repsRight ?? [])];
        while (reps.length <= op.index) reps.push(null);
        while (right.length <= op.index) right.push(null);
        reps[op.index] = op.reps;
        right[op.index] = op.repsRight;
        entry.reps = trimTrailingNulls(reps);
        entry.repsRight = trimTrailingNulls(right);
      } else {
        entry.load = op.load;
        entry.variation = op.variation?.trim() ? op.variation : null;
      }
      session.ex[op.key] = entry;
      week.sessions[op.slot] = session;
      break;
    }
    case 'session':
      week.sessions[op.slot] = { ...week.sessions[op.slot], date: op.date, done: op.done };
      break;
    case 'checkin':
      week.checkin = { weight: op.weight, sleep: op.sleep, food: op.food, notes: op.notes };
      break;
    case 'measurement':
      week.measurement = { waist: op.waist, chest: op.chest, arm: op.arm, thigh: op.thigh, photos: op.photos };
      break;
  }
  return { ...log, [op.week]: week };
}

/** Field identity for debouncing and ordering: one key per saved field. */
export function opKey(op: TrainingOp): string {
  switch (op.kind) {
    case 'set':
      return `set:${op.week}:${op.slot}:${op.key}:${op.index}`;
    case 'entry':
      return `entry:${op.week}:${op.slot}:${op.key}`;
    case 'session':
      return `session:${op.week}:${op.slot}`;
    default:
      return `${op.kind}:${op.week}`;
  }
}

// ================================================================ history
export interface ExercisePoint {
  week: number;
  /** Best single set (weaker side for unilateral work). */
  best: number | null;
  /** Heaviest load used that week. */
  load: number | null;
}

/** Per-week best set and load for one exercise key across all sessions. */
export function exerciseHistory(log: RunLog, key: string, unilateral: boolean): ExercisePoint[] {
  const out: ExercisePoint[] = [];
  for (const w of Object.keys(log).map(Number).sort((a, b) => a - b)) {
    let best: number | null = null;
    let load: number | null = null;
    for (const s of log[w].sessions ?? []) {
      const e = s?.ex?.[key];
      if (!entryHasReps(e)) continue;
      for (const v of effectiveReps(e, unilateral)) if (v !== null && (best === null || v > best)) best = v;
      if (e!.load !== null && (load === null || e!.load > load)) load = e!.load;
    }
    if (best !== null) out.push({ week: w, best, load });
  }
  return out;
}

export interface MeasurementDelta {
  field: 'waist' | 'chest' | 'arm' | 'thigh';
  base: number | null;
  latest: number | null;
  latestWeek: number | null;
  diff: number | null;
}

/** Each measurement's latest value compared with week 1. */
export function measurementDeltas(log: RunLog): MeasurementDelta[] {
  const fields = ['waist', 'chest', 'arm', 'thigh'] as const;
  const weeks = Object.keys(log)
    .map(Number)
    .filter((w) => log[w]?.measurement)
    .sort((a, b) => a - b);
  return fields.map((field) => {
    const base = log[1]?.measurement?.[field] ?? null;
    let latest: number | null = null;
    let latestWeek: number | null = null;
    for (const w of weeks) {
      const v = log[w].measurement![field];
      if (v !== null && w > 1) {
        latest = v;
        latestWeek = w;
      }
    }
    return { field, base, latest, latestWeek, diff: base !== null && latest !== null ? latest - base : null };
  });
}

// ================================================================ summary
/**
 * Compact text view of a run for the agent ("Ask your log"). Lists per
 * exercise every logged session with date, reps and load, and calls out each
 * load change so "when did I last add load to rows?" is answerable directly.
 */
export function summarizeRun(
  log: RunLog,
  program: { name: string; weeks: number; exercises: ProgramExercise[] },
  startDate: string,
  current: CurrentWeek
): string {
  const lines: string[] = [];
  const weeks = Object.keys(log)
    .map(Number)
    .sort((a, b) => a - b);
  let done = 0;
  let logged = 0;
  for (const w of weeks) {
    for (const s of log[w].sessions) {
      if (s.done) done++;
      if (Object.values(s.ex).some(entryHasReps)) logged++;
    }
  }
  lines.push(
    `Program: ${program.name}, started ${startDate}. Today is week ${current.week} of ${program.weeks}${current.complete ? ' (program complete)' : ''}.`,
    `Sessions marked done: ${done}. Sessions with sets logged: ${logged}.`,
    ''
  );

  lines.push('Sessions by week:');
  for (const w of weeks) {
    const order = sessionOrder(w);
    const items = log[w].sessions.map((s, i) => {
      const n = Object.values(s.ex).filter(entryHasReps).length;
      return `S${i + 1} ${order[i]}${s.date ? ` ${s.date}` : ''}${s.done ? ' done' : ''}${n ? ` (${n} exercises)` : ''}`;
    });
    lines.push(`- Week ${w}: ${items.join('; ')}`);
  }

  const defs = new Map<string, ProgramExercise>();
  for (const e of program.exercises) if (!defs.has(e.key)) defs.set(e.key, e);

  lines.push('', 'Exercise history (oldest first):');
  for (const def of defs.values()) {
    const rows: string[] = [];
    const changes: string[] = [];
    let prevLoad: number | null | undefined;
    for (const w of weeks) {
      log[w].sessions.forEach((s, i) => {
        const e = s.ex[def.key];
        if (!entryHasReps(e) && e?.load == null) return;
        const sets = Array.from({ length: Math.max(e!.reps.length, e!.repsRight.length) }, (_, j) =>
          setLabel(e!.reps[j], e!.repsRight[j])
        ).join('·');
        const when = `week ${w} session ${i + 1}${s.date ? ` (${s.date})` : ''}`;
        const load = e!.load ?? 0;
        rows.push(`  ${when}: ${sets || 'no reps'} @ ${fmtNum(load)} kg${e!.variation ? `, ${e!.variation}` : ''}`);
        if (prevLoad !== undefined && load !== prevLoad) {
          changes.push(`${load > (prevLoad ?? 0) ? 'added load' : 'reduced load'} ${fmtNum(prevLoad ?? 0)}→${fmtNum(load)} kg in ${when}`);
        }
        prevLoad = load;
      });
    }
    if (!rows.length) continue;
    lines.push(`- ${def.name} [${def.key}], ${def.sets}×${def.repLo}–${def.repHi}${def.unilateral ? ', left/right' : ''}:`);
    lines.push(...rows);
    if (changes.length) lines.push(`  load changes: ${changes.join('; ')}`);
  }

  lines.push('', 'Check-ins:');
  let any = false;
  for (const w of weeks) {
    const c = log[w].checkin;
    const parts = [
      c.weight !== null ? `${fmtNum(c.weight)} kg` : '',
      c.sleep !== null ? `sleep ${fmtNum(c.sleep)} h` : '',
      c.food ? `food: ${c.food}` : '',
      c.notes ? `notes: "${c.notes}"` : '',
    ].filter(Boolean);
    const m = log[w].measurement;
    if (m) {
      const mm = (['waist', 'chest', 'arm', 'thigh'] as const)
        .filter((f) => m[f] !== null)
        .map((f) => `${f} ${fmtNum(m[f]!)} cm`);
      if (mm.length || m.photos) parts.push(`measurements: ${mm.join(', ')}${m.photos ? ' (photos taken)' : ''}`);
    }
    if (parts.length) {
      any = true;
      lines.push(`- Week ${w}: ${parts.join(', ')}`);
    }
  }
  if (!any) lines.push('- none yet');

  const trend = weightTrend(log, weighIns(log).at(-1)?.week ?? 0);
  if (trend) lines.push('', `Weight trend: ${trend.diffText} since week ${trend.baseWeek} at ${trend.perWeekText}. ${trend.message}`);

  return lines.join('\n');
}
