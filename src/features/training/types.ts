/**
 * Normalized in-memory shape of a training run. Rules operate on this, never on
 * DB rows or the legacy string documents: numbers are numbers, empty is null.
 */

export type Workout = 'A' | 'B';

export interface ProgramExercise {
  workout: Workout;
  code: string;
  key: string;
  name: string;
  sets: number;
  repLo: number;
  repHi: number;
  note: string;
  /** One-leg / one-arm work: left and right reps are recorded separately. */
  unilateral: boolean;
  sort: number;
}

export interface Program {
  /** DB id when loaded from the database; absent for the in-code mirror. */
  id?: string;
  slug: string;
  name: string;
  weeks: number;
  exercises: ProgramExercise[];
}

export interface ExerciseLog {
  /** Reps per set, index = set index. For unilateral work this is the LEFT side. */
  reps: (number | null)[];
  /** Right-side reps per set, unilateral work only. */
  repsRight: (number | null)[];
  load: number | null;
  variation: string | null;
}

export interface SessionLog {
  date: string | null;
  done: boolean;
  /** Keyed by exercise key. */
  ex: Record<string, ExerciseLog>;
}

export const FOOD_OPTIONS = ['Same as last week', 'Added ~300 kcal/day', 'Missed meals'] as const;
export type Food = (typeof FOOD_OPTIONS)[number];

export interface CheckIn {
  weight: number | null;
  sleep: number | null;
  food: Food | null;
  notes: string | null;
}

export interface Measurement {
  waist: number | null;
  chest: number | null;
  arm: number | null;
  thigh: number | null;
  photos: boolean;
}

export interface WeekLog {
  /** Always three sessions, slots 0..2. */
  sessions: SessionLog[];
  checkin: CheckIn;
  measurement: Measurement | null;
}

/** Keyed by week number (1-based). Missing weeks are simply absent. */
export type RunLog = Record<number, WeekLog>;

export interface RunInfo {
  id: string;
  startDate: string;
  programId: string;
}

export interface CurrentWeek {
  week: number;
  /** True once today is past the program's last week. */
  complete: boolean;
}

/** What GET /api/training/week/:n returns. */
export interface WeekPayload {
  run: RunInfo | null;
  program: Program;
  current: CurrentWeek;
  week: number;
  log: RunLog;
  computed?: {
    order: Workout[];
    lastTime: Record<string, LastTime | null>;
    addLoadDue: Record<string, boolean>;
    weightTrend: WeightTrend | null;
  };
}

export interface LastTime {
  week: number;
  slot: number;
  date: string | null;
  reps: (number | null)[];
  repsRight: (number | null)[];
  load: number | null;
  variation: string | null;
}

export type TrendStatus = 'on-track' | 'below' | 'fast' | 'stall';

export interface WeightTrend {
  baseWeek: number;
  baseWeight: number;
  week: number;
  current: number;
  diff: number;
  perWeek: number;
  status: TrendStatus;
  /** "+0.6 kg" */
  diffText: string;
  /** "+0.15 kg/week" */
  perWeekText: string;
  message: string;
  /** Plan band, 0.25–0.5 % of current bodyweight per week. */
  band: { lo: number; hi: number };
  bandText: string;
}

// ---------------------------------------------------------------- write ops
/**
 * One field-level write. The same descriptor drives the optimistic update
 * (applyOp), the PUT body, and re-applying unsaved edits over fresh data.
 */
export type TrainingOp =
  | {
      kind: 'set';
      runId: string;
      week: number;
      slot: number;
      key: string;
      index: number;
      reps: number | null;
      repsRight: number | null;
    }
  | {
      kind: 'entry';
      runId: string;
      week: number;
      slot: number;
      key: string;
      load: number | null;
      variation: string | null;
    }
  | { kind: 'session'; runId: string; week: number; slot: number; date: string | null; done: boolean }
  | ({ kind: 'checkin'; runId: string; week: number } & CheckIn)
  | ({ kind: 'measurement'; runId: string; week: number } & Measurement);

/** One exercise parsed from a spoken log, shown for confirmation before saving. */
export interface ParsedItem {
  key: string;
  reps: (number | null)[];
  repsRight?: (number | null)[];
  load: number | null;
}
