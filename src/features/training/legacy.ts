/**
 * Import from the old Size Blueprint Log artifact (spec: "Migrating existing
 * data"). Pure: legacy documents in, normalized log and DB-shaped rows out.
 *
 * Accepted inputs:
 *  - localStorage `sbl`: { weeks, meta } where weeks is keyed 1..12 or "w01",
 *    or is an array (index = week when slot 0 is empty, else index + 1)
 *  - the account export: [{ id: 'meta' | 'w01'..., data }]
 *  - both at once: { account, local } — merged per week (spec step 2)
 */
import { LIMITS, emptyEntry, emptySession, sessionOrder, type LimitName } from './rules';
import {
  FOOD_OPTIONS,
  type CheckIn,
  type ExerciseLog,
  type Food,
  type Measurement,
  type Program,
  type RunLog,
  type WeekLog,
  type Workout,
} from './types';

export interface LegacyExercise {
  r?: unknown[];
  load?: unknown;
}
export interface LegacySession {
  date?: unknown;
  done?: unknown;
  ex?: Record<string, LegacyExercise>;
}
export interface LegacyWeek {
  weight?: unknown;
  sleep?: unknown;
  food?: unknown;
  notes?: unknown;
  m?: Record<string, unknown>;
  s?: LegacySession[];
}
export interface LegacyData {
  start: string | null;
  weeks: Record<number, LegacyWeek>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** "w01" | "1" | 1 -> 1; anything else -> null. */
function weekNumber(id: unknown): number | null {
  const m = String(id).match(/^w?0*(\d{1,2})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 52 ? n : null;
}

function weeksFrom(raw: unknown): Record<number, LegacyWeek> {
  const out: Record<number, LegacyWeek> = {};
  if (Array.isArray(raw)) {
    const offset = raw[0] == null ? 0 : 1;
    raw.forEach((doc, i) => {
      if (isObj(doc) && i + offset >= 1) out[i + offset] = doc as LegacyWeek;
    });
  } else if (isObj(raw)) {
    for (const [k, doc] of Object.entries(raw)) {
      const n = weekNumber(k);
      if (n && isObj(doc)) out[n] = doc as LegacyWeek;
    }
  }
  return out;
}

const startFrom = (meta: unknown): string | null => {
  const s = isObj(meta) ? meta.start : null;
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Recognises either legacy shape (or both together) and returns weeks + start. */
export function parseLegacy(input: unknown): LegacyData {
  if (typeof input === 'string') input = JSON.parse(input);

  if (Array.isArray(input) && input.some((d) => isObj(d) && 'id' in d)) {
    const weeks: Record<number, LegacyWeek> = {};
    let start: string | null = null;
    for (const doc of input) {
      if (!isObj(doc)) continue;
      const data = (isObj(doc.data) ? doc.data : doc) as Record<string, unknown>;
      if (doc.id === 'meta') start = startFrom(data);
      else {
        const n = weekNumber(doc.id);
        if (n) weeks[n] = data as LegacyWeek;
      }
    }
    return { start, weeks };
  }

  if (isObj(input) && ('account' in input || 'local' in input)) {
    const account = input.account ? parseLegacy(input.account) : { start: null, weeks: {} };
    const local = input.local ? parseLegacy(input.local) : { start: null, weeks: {} };
    return mergeLegacy(account, local);
  }

  if (isObj(input) && ('weeks' in input || 'meta' in input)) {
    return { start: startFrom(input.meta), weeks: weeksFrom(input.weeks) };
  }

  throw new Error('Not a recognised Size Blueprint Log export');
}

/** Number of fields the user actually filled in a week document. */
export function filledFields(doc: LegacyWeek | undefined): number {
  if (!doc) return 0;
  const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false;
  let n = 0;
  for (const f of ['weight', 'sleep', 'food', 'notes'] as const) if (filled(doc[f])) n++;
  if (isObj(doc.m)) for (const v of Object.values(doc.m)) if (filled(v)) n++;
  for (const s of doc.s ?? []) {
    if (!isObj(s)) continue;
    if (filled(s.date)) n++;
    if (filled(s.done)) n++;
    for (const e of Object.values(s.ex ?? {})) {
      if (!isObj(e)) continue;
      if (filled(e.load)) n++;
      for (const r of Array.isArray(e.r) ? e.r : []) if (filled(r)) n++;
    }
  }
  return n;
}

/** Spec step 2: take the account copy unless the local one has more filled fields. */
export function mergeLegacy(account: LegacyData, local: LegacyData): LegacyData {
  const weeks: Record<number, LegacyWeek> = { ...local.weeks };
  for (const [k, doc] of Object.entries(account.weeks)) {
    const w = Number(k);
    if (!(w in weeks) || filledFields(doc) >= filledFields(weeks[w])) weeks[w] = doc;
  }
  return { start: account.start ?? local.start, weeks };
}

// ================================================================ convert
export interface ImportWarning {
  week: number;
  message: string;
}

function toNum(v: unknown, limit: LimitName, where: string, week: number, warn: ImportWarning[]): number | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  const l = LIMITS[limit];
  if (!Number.isFinite(n) || n < l.min || n > l.max || (l.integer && !Number.isInteger(n))) {
    warn.push({ week, message: `${where}: "${String(v)}" is not a valid ${limit}, skipped` });
    return null;
  }
  return n;
}

const toText = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One legacy week document to the normalized week. */
export function legacyWeekToLog(
  week: number,
  doc: LegacyWeek,
  program: Program,
  warn: ImportWarning[] = []
): WeekLog {
  const validKeys = new Set(program.exercises.map((e) => e.key));

  const food = toText(doc.food);
  if (food && !FOOD_OPTIONS.includes(food as Food)) {
    warn.push({ week, message: `food "${food}" is not one of the options, skipped` });
  }
  const checkin: CheckIn = {
    weight: toNum(doc.weight, 'weight', 'weight', week, warn),
    sleep: toNum(doc.sleep, 'sleep', 'sleep', week, warn),
    food: food && FOOD_OPTIONS.includes(food as Food) ? (food as Food) : null,
    notes: toText(doc.notes),
  };

  let measurement: Measurement | null = null;
  if (isObj(doc.m)) {
    const m: Measurement = {
      waist: toNum(doc.m.waist, 'waist', 'waist', week, warn),
      chest: toNum(doc.m.chest, 'chest', 'chest', week, warn),
      arm: toNum(doc.m.arm, 'arm', 'arm', week, warn),
      thigh: toNum(doc.m.thigh, 'thigh', 'thigh', week, warn),
      photos: doc.m.photos === true,
    };
    if (m.waist !== null || m.chest !== null || m.arm !== null || m.thigh !== null || m.photos) measurement = m;
  }

  const sessions = [0, 1, 2].map((slot) => {
    const src = Array.isArray(doc.s) && isObj(doc.s[slot]) ? doc.s[slot] : null;
    const session = emptySession();
    if (!src) return session;
    session.date = isDate(src.date) ? src.date : null;
    session.done = src.done === true;
    for (const [key, raw] of Object.entries(isObj(src.ex) ? src.ex : {})) {
      if (!isObj(raw)) continue;
      if (!validKeys.has(key)) {
        warn.push({ week, message: `session ${slot + 1}: unknown exercise "${key}", skipped` });
        continue;
      }
      const entry: ExerciseLog = emptyEntry();
      const r = Array.isArray(raw.r) ? raw.r : [];
      entry.reps = r.slice(0, 10).map((v, j) => toNum(v, 'reps', `${key} set ${j + 1}`, week, warn));
      while (entry.reps.length && entry.reps[entry.reps.length - 1] === null) entry.reps.pop();
      entry.load = toNum(raw.load, 'load', `${key} load`, week, warn);
      if (entry.reps.length || entry.load !== null) session.ex[key] = entry;
    }
    return session;
  });

  return { sessions, checkin, measurement };
}

export function legacyToLog(input: unknown, program: Program): { start: string | null; log: RunLog; warnings: ImportWarning[] } {
  const data = parseLegacy(input);
  const warnings: ImportWarning[] = [];
  const log: RunLog = {};
  for (const w of Object.keys(data.weeks).map(Number).sort((a, b) => a - b)) {
    if (w > program.weeks) {
      warnings.push({ week: w, message: `week ${w} is past the program's ${program.weeks} weeks, skipped` });
      continue;
    }
    log[w] = legacyWeekToLog(w, data.weeks[w], program, warnings);
  }
  return { start: data.start, log, warnings };
}

// ================================================================== rows
/**
 * DB-shaped rows, without ids: sessions are upserted first and their returned
 * ids are joined back by (week, slot). Empty sessions, check-ins and entries
 * are left out so a re-import never blanks data entered in the new app.
 */
export interface ImportPlan {
  sessions: { week: number; slot: number; workout: Workout; date: string | null; done: boolean }[];
  entries: { week: number; slot: number; exercise_key: string; load_kg: number | null; variation: string | null }[];
  sets: { week: number; slot: number; exercise_key: string; set_index: number; reps: number | null; reps_right: number | null }[];
  checkins: { week: number; weight_kg: number | null; sleep_h: number | null; food: Food | null; notes: string | null }[];
  measurements: {
    week: number;
    waist_cm: number | null;
    chest_cm: number | null;
    arm_cm: number | null;
    thigh_cm: number | null;
    photos: boolean;
  }[];
}

export function logToRows(log: RunLog): ImportPlan {
  const plan: ImportPlan = { sessions: [], entries: [], sets: [], checkins: [], measurements: [] };
  for (const week of Object.keys(log).map(Number).sort((a, b) => a - b)) {
    const wk = log[week];
    const c = wk.checkin;
    if (c.weight !== null || c.sleep !== null || c.food !== null || c.notes !== null) {
      plan.checkins.push({ week, weight_kg: c.weight, sleep_h: c.sleep, food: c.food, notes: c.notes });
    }
    if (wk.measurement) {
      const m = wk.measurement;
      plan.measurements.push({
        week,
        waist_cm: m.waist,
        chest_cm: m.chest,
        arm_cm: m.arm,
        thigh_cm: m.thigh,
        photos: m.photos,
      });
    }
    wk.sessions.forEach((s, slot) => {
      const keys = Object.keys(s.ex);
      if (!s.date && !s.done && keys.length === 0) return;
      plan.sessions.push({ week, slot, workout: sessionOrder(week)[slot], date: s.date, done: s.done });
      for (const key of keys) {
        const e = s.ex[key];
        plan.entries.push({ week, slot, exercise_key: key, load_kg: e.load, variation: e.variation });
        const len = Math.max(e.reps.length, e.repsRight.length);
        for (let i = 0; i < len; i++) {
          const reps = e.reps[i] ?? null;
          const right = e.repsRight[i] ?? null;
          if (reps === null && right === null) continue;
          plan.sets.push({ week, slot, exercise_key: key, set_index: i, reps, reps_right: right });
        }
      }
    });
  }
  return plan;
}
