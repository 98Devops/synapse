import { describe, expect, it } from 'vitest';
import { SIZE_BLUEPRINT, exercisesFor, findExercise } from './program';
import {
  ADD_LOAD_TEXT,
  addLoadDue,
  applyOp,
  currentWeek,
  dateInZone,
  effectiveReps,
  exerciseHistory,
  formatLastTime,
  isMeasurementWeek,
  lastTime,
  loadIncreased,
  loadUpText,
  measurementDeltas,
  measurementPlaceholders,
  opKey,
  parseField,
  sessionOrder,
  summarizeRun,
  weightTrend,
} from './rules';
import type { ExerciseLog, ProgramExercise, RunLog, TrainingOp } from './types';

const RUN = '00000000-0000-0000-0000-000000000001';
const pushups = findExercise(SIZE_BLUEPRINT, 'pushups')!;
const bss = findExercise(SIZE_BLUEPRINT, 'bss')!;

const entry = (reps: (number | null)[], load: number | null = null, repsRight: (number | null)[] = []): ExerciseLog => ({
  reps,
  repsRight,
  load,
  variation: null,
});

/** Build a log through applyOp, the same way the UI does. */
function logSets(log: RunLog, week: number, slot: number, key: string, reps: (number | null)[], load?: number) {
  reps.forEach((r, index) => {
    log = applyOp(log, { kind: 'set', runId: RUN, week, slot, key, index, reps: r, repsRight: null });
  });
  if (load !== undefined) log = applyOp(log, { kind: 'entry', runId: RUN, week, slot, key, load, variation: null });
  return log;
}

const withWeights = (weights: Record<number, number>): RunLog => {
  let log: RunLog = {};
  for (const [w, kg] of Object.entries(weights)) {
    log = applyOp(log, { kind: 'checkin', runId: RUN, week: Number(w), weight: kg, sleep: null, food: null, notes: null });
  }
  return log;
};

// ======================================================================= 1
describe('currentWeek', () => {
  it('opens on week 1 without a start date', () => {
    expect(currentWeek(null)).toEqual({ week: 1, complete: false });
    expect(currentWeek(undefined)).toEqual({ week: 1, complete: false });
    expect(currentWeek('')).toEqual({ week: 1, complete: false });
    expect(currentWeek('not-a-date')).toEqual({ week: 1, complete: false });
  });

  it('opens on the right week for start 2026-10-20', () => {
    const at = (iso: string) => currentWeek('2026-10-20', new Date(iso));
    expect(at('2026-10-20T08:00:00+02:00')).toEqual({ week: 1, complete: false });
    expect(at('2026-10-26T20:00:00+02:00')).toEqual({ week: 1, complete: false });
    expect(at('2026-10-27T08:00:00+02:00')).toEqual({ week: 2, complete: false });
    // today in the spec's timeline
    expect(at('2026-11-02T12:00:00+02:00')).toEqual({ week: 2, complete: false });
    expect(at('2026-11-03T12:00:00+02:00')).toEqual({ week: 3, complete: false });
  });

  it('counts days in Africa/Harare, not device or UTC time (gap 8)', () => {
    // 22:30 UTC on the 26th is already 00:30 on the 27th in Harare -> week 2
    const lateNight = new Date('2026-10-26T22:30:00Z');
    expect(dateInZone(lateNight)).toBe('2026-10-27');
    expect(currentWeek('2026-10-20', lateNight)).toEqual({ week: 2, complete: false });
    expect(currentWeek('2026-10-20', lateNight, 12, 'UTC')).toEqual({ week: 1, complete: false });
  });

  it('clamps before the start to week 1', () => {
    expect(currentWeek('2026-10-20', new Date('2026-10-01T12:00:00Z'))).toEqual({ week: 1, complete: false });
  });

  it('stays on week 12 and reports completion after the last week', () => {
    expect(currentWeek('2026-10-20', new Date('2027-01-11T12:00:00Z'))).toEqual({ week: 12, complete: false }); // day 83
    expect(currentWeek('2026-10-20', new Date('2027-01-12T12:00:00Z'))).toEqual({ week: 12, complete: true }); // day 84
    expect(currentWeek('2026-10-20', new Date('2028-01-01T12:00:00Z'))).toEqual({ week: 12, complete: true });
  });
});

// ======================================================================= 2
describe('sessionOrder', () => {
  it('runs A, B, A in odd weeks and B, A, B in even weeks', () => {
    expect(sessionOrder(1)).toEqual(['A', 'B', 'A']);
    expect(sessionOrder(2)).toEqual(['B', 'A', 'B']);
    expect(sessionOrder(11)).toEqual(['A', 'B', 'A']);
    expect(sessionOrder(12)).toEqual(['B', 'A', 'B']);
  });

  it('gives each workout 18 sessions over 12 weeks', () => {
    const all = Array.from({ length: 12 }, (_, i) => sessionOrder(i + 1)).flat();
    expect(all.filter((w) => w === 'A')).toHaveLength(18);
    expect(all.filter((w) => w === 'B')).toHaveLength(18);
  });
});

// ======================================================================= 3
describe('lastTime', () => {
  it('returns null on an empty log', () => {
    expect(lastTime({}, 1, 0, 'pushups')).toBeNull();
    expect(lastTime({}, 5, 2, 'pushups')).toBeNull();
  });

  it('acceptance: push-ups 12, 10, 9 at 2 kg in session 1 show in session 3', () => {
    const log = logSets({}, 1, 0, 'pushups', [12, 10, 9], 2);
    const last = lastTime(log, 1, 2, 'pushups');
    expect(last).toMatchObject({ week: 1, slot: 0, reps: [12, 10, 9], load: 2 });
    expect(formatLastTime(last, pushups.sets)).toBe('Last time: 12 · 10 · 9 with 2 kg');
  });

  it('never looks at the current or later sessions', () => {
    const log = logSets({}, 1, 2, 'pushups', [12, 10, 9]);
    expect(lastTime(log, 1, 2, 'pushups')).toBeNull();
    expect(lastTime(log, 1, 0, 'pushups')).toBeNull();
  });

  it('searches earlier sessions of the week first, then 2, 1, 0 of earlier weeks', () => {
    let log = logSets({}, 1, 0, 'lateral', [12, 12, 12]);
    log = logSets(log, 1, 1, 'lateral', [13, 13, 13]);
    log = logSets(log, 2, 0, 'lateral', [14, 14, 14]);
    expect(lastTime(log, 2, 1, 'lateral')?.reps).toEqual([14, 14, 14]);
    expect(lastTime(log, 2, 0, 'lateral')?.reps).toEqual([13, 13, 13]); // week 1 slot 1 before slot 0
    expect(lastTime(log, 1, 1, 'lateral')?.reps).toEqual([12, 12, 12]);
  });

  it('skips entries with no reps, including load-only entries', () => {
    let log = logSets({}, 1, 0, 'pushups', [12, 10, 9], 2);
    log = applyOp(log, { kind: 'entry', runId: RUN, week: 1, slot: 2, key: 'pushups', load: 4, variation: null });
    log = logSets(log, 2, 1, 'pushups', [null, null, null]);
    expect(lastTime(log, 2, 2, 'pushups')).toMatchObject({ week: 1, slot: 0, load: 2 });
  });

  it('accepts a partial entry and shows – for missing sets', () => {
    const log = logSets({}, 1, 0, 'pushups', [12]);
    const last = lastTime(log, 1, 2, 'pushups');
    expect(last?.reps).toEqual([12]);
    expect(formatLastTime(last, 3)).toBe('Last time: 12 · – · –');
    const gap = logSets({}, 1, 0, 'pushups', [null, 10]);
    expect(formatLastTime(lastTime(gap, 1, 1, 'pushups'), 3)).toBe('Last time: – · 10 · –');
  });

  it('acceptance: curls logged in Workout A are the target in the next Workout B', () => {
    // week 1: A (slot 0), B (slot 1), A (slot 2)
    const log = logSets({}, 1, 0, 'curls', [12, 11], 3);
    const last = lastTime(log, 1, 1, 'curls');
    expect(sessionOrder(1)[1]).toBe('B');
    expect(exercisesFor(SIZE_BLUEPRINT, 'B').some((e) => e.key === 'curls')).toBe(true);
    expect(formatLastTime(last, 2)).toBe('Last time: 12 · 11 with 3 kg');
  });

  it('omits the load when none was used', () => {
    const log = logSets({}, 1, 0, 'tablerows', [10, 9, 8]);
    expect(formatLastTime(lastTime(log, 1, 2, 'tablerows'), 3)).toBe('Last time: 10 · 9 · 8');
    expect(formatLastTime(null, 3)).toBeNull();
  });

  it('shows left/right for unilateral work (gap 3)', () => {
    const log: RunLog = applyOp({}, { kind: 'set', runId: RUN, week: 1, slot: 0, key: 'bss', index: 0, reps: 10, repsRight: 9 });
    const l2 = applyOp(log, { kind: 'set', runId: RUN, week: 1, slot: 0, key: 'bss', index: 1, reps: 9, repsRight: 9 });
    expect(formatLastTime(lastTime(l2, 1, 2, 'bss'), 3)).toBe('Last time: 10/9 · 9/9 · –');
    // a right-only entry still counts as logged
    const right = applyOp({}, { kind: 'set', runId: RUN, week: 1, slot: 0, key: 'bss', index: 0, reps: null, repsRight: 8 });
    expect(formatLastTime(lastTime(right, 1, 1, 'bss'), 3)).toBe('Last time: –/8 · – · –');
  });
});

// ======================================================================= 4
describe('addLoadDue', () => {
  it('is false with no entry or empty sets', () => {
    expect(addLoadDue(undefined, pushups)).toBe(false);
    expect(addLoadDue(null, pushups)).toBe(false);
    expect(addLoadDue(entry([]), pushups)).toBe(false);
    expect(addLoadDue(entry([null, null, null]), pushups)).toBe(false);
  });

  it('acceptance: 15, 15, 15 shows the prompt; any set at 14 hides it', () => {
    expect(addLoadDue(entry([15, 15, 15]), pushups)).toBe(true);
    expect(addLoadDue(entry([15, 15, 14]), pushups)).toBe(false);
    expect(addLoadDue(entry([14, 15, 15]), pushups)).toBe(false);
    expect(ADD_LOAD_TEXT).toBe('Top of range on every set. Add load next time.');
  });

  it('updates live as reps are typed (partial sets never trigger)', () => {
    let log: RunLog = {};
    const states: boolean[] = [];
    for (const [i, r] of [15, 15, 15].entries()) {
      log = applyOp(log, { kind: 'set', runId: RUN, week: 1, slot: 0, key: 'pushups', index: i, reps: r, repsRight: null });
      states.push(addLoadDue(log[1].sessions[0].ex.pushups, pushups));
    }
    expect(states).toEqual([false, false, true]);
    log = applyOp(log, { kind: 'set', runId: RUN, week: 1, slot: 0, key: 'pushups', index: 1, reps: 14, repsRight: null });
    expect(addLoadDue(log[1].sessions[0].ex.pushups, pushups)).toBe(false);
    log = applyOp(log, { kind: 'set', runId: RUN, week: 1, slot: 0, key: 'pushups', index: 1, reps: null, repsRight: null });
    expect(addLoadDue(log[1].sessions[0].ex.pushups, pushups)).toBe(false);
  });

  it('counts only the planned sets; extra sets do not matter', () => {
    const curls = findExercise(SIZE_BLUEPRINT, 'curls')!;
    expect(addLoadDue(entry([15, 15]), curls)).toBe(true);
    expect(addLoadDue(entry([15, 15, 3]), curls)).toBe(true);
    expect(addLoadDue(entry([20, 30, 25]), pushups)).toBe(true); // above the top counts
  });

  it('uses the weaker leg for unilateral work and needs both sides (gap 3)', () => {
    expect(addLoadDue(entry([12, 12, 12], null, [12, 12, 12]), bss)).toBe(true);
    expect(addLoadDue(entry([12, 12, 12], null, [12, 11, 12]), bss)).toBe(false);
    expect(addLoadDue(entry([12, 12, 12], null, [12, 12, null]), bss)).toBe(false);
    expect(effectiveReps(entry([12, 9], null, [10, 11]), true)).toEqual([10, 9]);
    // imported single-count data (no right side at all) uses the one count
    expect(addLoadDue(entry([12, 12, 12]), bss)).toBe(true);
  });
});

describe('load-up prompt (gap 7)', () => {
  const last = (load: number | null) => ({ week: 1, slot: 0, date: null, reps: [15, 15, 15], repsRight: [], load, variation: null });
  it('fires only when this session is heavier than last time', () => {
    expect(loadIncreased(4, last(2))).toBe(true);
    expect(loadIncreased(2, last(2))).toBe(false);
    expect(loadIncreased(1, last(2))).toBe(false);
    expect(loadIncreased(2, last(null))).toBe(true);
    expect(loadIncreased(null, last(2))).toBe(false);
    expect(loadIncreased(4, null)).toBe(false);
    expect(loadUpText(pushups)).toBe('Load up — start again at the bottom of the range (8 reps).');
  });
});

// ======================================================================= 5
describe('weightTrend', () => {
  it('is null without a baseline and a later weigh-in for that week', () => {
    expect(weightTrend({}, 5)).toBeNull();
    expect(weightTrend(withWeights({ 1: 50 }), 1)).toBeNull();
    expect(weightTrend(withWeights({ 1: 50, 5: 50.6 }), 4)).toBeNull(); // week 4 has no weight
    expect(weightTrend(withWeights({ 1: 50, 5: 50.6 }), 1)).toBeNull(); // baseline week itself
  });

  it('acceptance: 50 -> 50.6 by week 5 is +0.6 kg at +0.15 kg/week with the +300 kcal prompt', () => {
    const t = weightTrend(withWeights({ 1: 50, 5: 50.6 }), 5)!;
    expect(t.diffText).toBe('+0.6 kg');
    expect(t.perWeekText).toBe('+0.15 kg/week');
    expect(t.status).toBe('below');
    expect(t.message).toBe('Below the 0.25 kg/week target, so add about 300 calories a day.');
  });

  it('acceptance: 50 -> 51.2 by week 5 is on track', () => {
    const t = weightTrend(withWeights({ 1: 50, 5: 51.2 }), 5)!;
    expect(t.diffText).toBe('+1.2 kg');
    expect(t.perWeekText).toBe('+0.30 kg/week');
    expect(t.status).toBe('on-track');
    expect(t.message).toBe('On track');
  });

  it('uses the first week with a weight as the baseline', () => {
    const t = weightTrend(withWeights({ 2: 50, 4: 50.6 }), 4)!;
    expect(t.baseWeek).toBe(2);
    expect(t.perWeekText).toBe('+0.30 kg/week');
  });

  it('scales the target with bodyweight (gap 1)', () => {
    // at 120 kg the target is 0.30 kg/week, so +0.28 is below it
    const t = weightTrend(withWeights({ 1: 118.6, 6: 120 }), 6)!;
    expect(t.perWeekText).toBe('+0.28 kg/week');
    expect(t.status).toBe('below');
    expect(t.message).toBe('Below the 0.30 kg/week target, so add about 300 calories a day.');
    expect(t.bandText).toBe('Plan: 0.30–0.60 kg/week at 120 kg');
  });

  it('flags gains that are too fast', () => {
    const t = weightTrend(withWeights({ 1: 50, 3: 51.5 }), 3)!;
    expect(t.status).toBe('fast');
  });

  it('stall check overrides on-track: flat over the last two weigh-ins (gap 2)', () => {
    const t = weightTrend(withWeights({ 1: 50, 2: 51, 3: 51.5, 4: 51.5, 5: 51.5 }), 5)!;
    expect(t.perWeek).toBeGreaterThanOrEqual(0.25); // would be on track on average
    expect(t.status).toBe('stall');
    expect(t.message).toBe('Flat for 2 weeks, add about 300 calories a day.');
    // a gain over the two-back weigh-in is not a stall
    expect(weightTrend(withWeights({ 1: 50, 2: 51, 3: 51.5, 4: 51.5, 5: 51.6 }), 5)!.status).not.toBe('stall');
    // needs three weigh-ins
    expect(weightTrend(withWeights({ 1: 50, 2: 50 }), 2)!.status).toBe('below');
  });

  it('formats losses with a minus sign', () => {
    const t = weightTrend(withWeights({ 1: 50, 3: 49.5 }), 3)!;
    expect(t.diffText).toBe('-0.5 kg');
    expect(t.perWeekText).toBe('-0.25 kg/week');
  });

  it('ignores later weeks when looking at an earlier one', () => {
    const t = weightTrend(withWeights({ 1: 50, 3: 50.6, 5: 50 }), 3)!;
    expect(t.status).toBe('on-track');
  });
});

// ======================================================================= 6
describe('isMeasurementWeek', () => {
  it('is true only in weeks 1, 4, 8 and 12', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => i + 1).filter(isMeasurementWeek);
    expect(weeks).toEqual([1, 4, 8, 12]);
  });

  it('uses week 1 values as placeholders from week 4 on', () => {
    const log = applyOp({}, { kind: 'measurement', runId: RUN, week: 1, waist: 68, chest: 84, arm: 26, thigh: 45, photos: true });
    expect(measurementPlaceholders(log, 1)).toBeNull();
    expect(measurementPlaceholders(log, 3)).toBeNull();
    expect(measurementPlaceholders(log, 4)?.waist).toBe(68);
    expect(measurementPlaceholders(log, 12)?.arm).toBe(26);
    expect(measurementPlaceholders({}, 8)).toBeNull();
  });
});

// ================================================================= helpers
describe('parseField (gap 5 ranges)', () => {
  it('accepts in-range numbers, empty as null, and rejects the rest', () => {
    expect(parseField('', 'reps')).toBeNull();
    expect(parseField(' 12 ', 'reps')).toBe(12);
    expect(parseField('120', 'reps')).toBeUndefined();
    expect(parseField('12.5', 'reps')).toBeUndefined();
    expect(parseField('-2', 'load')).toBeUndefined();
    expect(parseField('2,5', 'load')).toBe(2.5);
    expect(parseField('61', 'load')).toBeUndefined();
    expect(parseField('29', 'weight')).toBeUndefined();
    expect(parseField('50.6', 'weight')).toBe(50.6);
    expect(parseField('25', 'sleep')).toBeUndefined();
    expect(parseField('abc', 'sleep')).toBeUndefined();
  });
});

describe('applyOp / opKey', () => {
  it('is immutable and gives one key per field', () => {
    const before: RunLog = {};
    const op: TrainingOp = { kind: 'set', runId: RUN, week: 3, slot: 1, key: 'pike', index: 2, reps: 9, repsRight: null };
    const after = applyOp(before, op);
    expect(before).toEqual({});
    expect(after[3].sessions[1].ex.pike.reps).toEqual([null, null, 9]);
    expect(after[3].sessions).toHaveLength(3);
    expect(opKey(op)).toBe('set:3:1:pike:2');
    expect(opKey({ kind: 'checkin', runId: RUN, week: 3, weight: 50, sleep: null, food: null, notes: null })).toBe('checkin:3');
  });

  it('marks a session done without touching its sets', () => {
    let log = logSets({}, 1, 0, 'pushups', [12, 10, 9], 2);
    log = applyOp(log, { kind: 'session', runId: RUN, week: 1, slot: 0, date: '2026-10-20', done: true });
    expect(log[1].sessions[0]).toMatchObject({ date: '2026-10-20', done: true });
    expect(log[1].sessions[0].ex.pushups.reps).toEqual([12, 10, 9]);
  });
});

describe('history', () => {
  it('tracks best set and load per week, and measurements vs week 1', () => {
    let log = logSets({}, 1, 0, 'pushups', [12, 10, 9], 2);
    log = logSets(log, 1, 2, 'pushups', [13, 11, 9], 2);
    log = logSets(log, 2, 1, 'pushups', [9, 8, 8], 4);
    expect(exerciseHistory(log, 'pushups', false)).toEqual([
      { week: 1, best: 13, load: 2 },
      { week: 2, best: 9, load: 4 },
    ]);
    log = applyOp(log, { kind: 'measurement', runId: RUN, week: 1, waist: 68, chest: 84, arm: 26, thigh: null, photos: false });
    log = applyOp(log, { kind: 'measurement', runId: RUN, week: 4, waist: 68.5, chest: 85, arm: null, thigh: null, photos: true });
    const d = measurementDeltas(log);
    expect(d.find((x) => x.field === 'chest')).toMatchObject({ base: 84, latest: 85, latestWeek: 4, diff: 1 });
    expect(d.find((x) => x.field === 'arm')).toMatchObject({ base: 26, latest: null, diff: null });
  });

  it('summarizes the run for the agent, including load changes', () => {
    let log = logSets({}, 1, 0, 'tablerows', [10, 9, 8]);
    log = applyOp(log, { kind: 'session', runId: RUN, week: 1, slot: 0, date: '2026-10-20', done: true });
    log = logSets(log, 2, 1, 'tablerows', [9, 9, 8], 2);
    log = applyOp(log, { kind: 'session', runId: RUN, week: 2, slot: 1, date: '2026-10-29', done: true });
    const text = summarizeRun(log, SIZE_BLUEPRINT, '2026-10-20', { week: 2, complete: false });
    expect(text).toContain('Sessions marked done: 2');
    expect(text).toContain('Table rows [tablerows]');
    expect(text).toContain('added load 0→2 kg in week 2 session 2 (2026-10-29)');
  });
});

describe('program data', () => {
  it('matches the program tables (codes, names, sets × ranges, notes)', () => {
    const row = (e: ProgramExercise) => `${e.code} ${e.name} ${e.sets}×${e.repLo}–${e.repHi}${e.note ? ` ${e.note}` : ''}`;
    expect(exercisesFor(SIZE_BLUEPRINT, 'A').map(row)).toEqual([
      'A1 Backpack push-ups 3×8–15',
      'A2 Table rows 3×8–15',
      'B1 Bulgarian split squats 3×8–12 per leg',
      'B2 Lateral raises 3×12–20',
      'C1 Chair dips 2×8–15',
      'C2 Bicep curls 2×10–15',
    ]);
    expect(exercisesFor(SIZE_BLUEPRINT, 'B').map(row)).toEqual([
      'A1 Pike push-ups 3×6–12',
      'A2 Sliding pull-ups / towel rows 3×8–12',
      'B1 Romanian deadlifts 3×10–15',
      'B2 Lateral raises 3×12–20',
      'C1 Feet-elevated push-ups 2×8–15',
      'C2 Door face pulls 2×12–20',
      'D1 Overhead triceps extensions 2×8–15',
      'D2 Bicep curls 2×10–15',
    ]);
    expect(SIZE_BLUEPRINT.exercises.filter((e) => e.unilateral).map((e) => e.key)).toEqual(['bss']);
  });
});
