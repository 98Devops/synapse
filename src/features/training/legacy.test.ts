import { describe, expect, it } from 'vitest';
import { SIZE_BLUEPRINT, findExercise } from './program';
import { addLoadDue, formatLastTime, lastTime, weightTrend } from './rules';
import { filledFields, legacyToLog, logToRows, mergeLegacy, parseLegacy } from './legacy';

/** The account copy of the old log as of the spec (exact export). */
const ACCOUNT_DOCS = [
  { id: 'meta', data: { start: '2026-10-20' } },
  {
    id: 'w01',
    data: {
      food: '',
      m: {},
      notes: 'Day 1. Starting weight 50 kg.',
      s: [{ date: '2026-10-20', ex: {} }, { ex: {} }, { ex: {} }],
      sleep: '',
      weight: '50',
    },
  },
];

/** Illustrative localStorage `sbl` copy with sets logged on the device. */
const LOCAL_SBL = {
  meta: { start: '2026-10-20' },
  weeks: {
    1: {
      weight: '50',
      sleep: '7.5',
      food: 'Same as last week',
      notes: 'Day 1. Starting weight 50 kg.',
      m: { waist: '68', chest: '84', arm: '26', thigh: '', photos: true },
      s: [
        {
          date: '2026-10-20',
          done: true,
          ex: {
            pushups: { r: ['12', '10', '9'], load: '2' },
            tablerows: { r: ['10', '9', ''], load: '' },
            bss: { r: ['10', '9', '9'], load: '' },
            curls: { r: ['12', '11'], load: '3' },
          },
        },
        { date: '2026-10-22', ex: { pike: { r: ['', '', ''], load: '' } } },
        { ex: { pushups: { r: ['15', '15', '15'], load: '2' } } },
      ],
    },
    2: { weight: '50.6', sleep: '', food: '', notes: '', m: {}, s: [{ ex: {} }, { ex: {} }, { ex: {} }] },
  },
};

describe('parseLegacy', () => {
  it('reads the account doc array', () => {
    const d = parseLegacy(ACCOUNT_DOCS);
    expect(d.start).toBe('2026-10-20');
    expect(Object.keys(d.weeks)).toEqual(['1']);
    expect(d.weeks[1].weight).toBe('50');
  });

  it('reads localStorage sbl with numeric, wNN and array week keys', () => {
    expect(Object.keys(parseLegacy(LOCAL_SBL).weeks)).toEqual(['1', '2']);
    expect(Object.keys(parseLegacy({ meta: {}, weeks: { w01: {}, w12: {} } }).weeks)).toEqual(['1', '12']);
    // array with an empty slot 0: index is the week
    expect(Object.keys(parseLegacy({ weeks: [null, { weight: '50' }, { weight: '51' }] }).weeks)).toEqual(['1', '2']);
    // dense array: index + 1
    expect(Object.keys(parseLegacy({ weeks: [{ weight: '50' }] }).weeks)).toEqual(['1']);
    // a JSON string is accepted too
    expect(parseLegacy(JSON.stringify(LOCAL_SBL)).start).toBe('2026-10-20');
  });

  it('rejects anything else', () => {
    expect(() => parseLegacy({ hello: 1 })).toThrow(/recognised/);
    expect(() => parseLegacy(42)).toThrow();
  });
});

describe('legacyToLog (account fixture)', () => {
  const { start, log, warnings } = legacyToLog(ACCOUNT_DOCS, SIZE_BLUEPRINT);

  it('converts strings to numbers and "" to null', () => {
    expect(start).toBe('2026-10-20');
    expect(warnings).toEqual([]);
    expect(log[1].checkin).toEqual({ weight: 50, sleep: null, food: null, notes: 'Day 1. Starting weight 50 kg.' });
    expect(log[1].measurement).toBeNull(); // empty m is skipped
    expect(log[1].sessions[0]).toEqual({ date: '2026-10-20', done: false, ex: {} });
    expect(log[1].sessions[1]).toEqual({ date: null, done: false, ex: {} });
  });

  it('produces rows: the run start, one check-in, one dated session, no sets', () => {
    const plan = logToRows(log);
    expect(plan.checkins).toEqual([
      { week: 1, weight_kg: 50, sleep_h: null, food: null, notes: 'Day 1. Starting weight 50 kg.' },
    ]);
    expect(plan.sessions).toEqual([{ week: 1, slot: 0, workout: 'A', date: '2026-10-20', done: false }]);
    expect(plan.entries).toEqual([]);
    expect(plan.sets).toEqual([]);
    expect(plan.measurements).toEqual([]);
  });

  it('is deterministic, so re-importing upserts the same rows', () => {
    expect(logToRows(legacyToLog(ACCOUNT_DOCS, SIZE_BLUEPRINT).log)).toEqual(logToRows(log));
  });
});

describe('legacyToLog (local fixture with sets)', () => {
  const { log, warnings } = legacyToLog(LOCAL_SBL, SIZE_BLUEPRINT);

  it('keeps sets only for non-empty reps and preserves loads', () => {
    expect(warnings).toEqual([]);
    const s0 = log[1].sessions[0];
    expect(s0.done).toBe(true);
    expect(s0.ex.pushups).toEqual({ reps: [12, 10, 9], repsRight: [], load: 2, variation: null });
    expect(s0.ex.tablerows.reps).toEqual([10, 9]);
    expect(log[1].sessions[1].ex.pike).toBeUndefined(); // all-empty entry dropped
    expect(log[1].measurement).toEqual({ waist: 68, chest: 84, arm: 26, thigh: null, photos: true });

    const plan = logToRows(log);
    expect(plan.sets.filter((s) => s.exercise_key === 'tablerows').map((s) => s.set_index)).toEqual([0, 1]);
    expect(plan.sessions.map((s) => [s.week, s.slot, s.workout])).toEqual([
      [1, 0, 'A'],
      [1, 1, 'B'],
      [1, 2, 'A'],
    ]);
    expect(plan.checkins.map((c) => c.week)).toEqual([1, 2]);
  });

  it('shows the same targets and trend as the old page', () => {
    expect(formatLastTime(lastTime(log, 1, 2, 'pushups'), 3)).toBe('Last time: 12 · 10 · 9 with 2 kg');
    expect(formatLastTime(lastTime(log, 1, 1, 'curls'), 2)).toBe('Last time: 12 · 11 with 3 kg');
    expect(addLoadDue(log[1].sessions[2].ex.pushups, findExercise(SIZE_BLUEPRINT, 'pushups')!)).toBe(true);
    // legacy single-count split squats display as one number per set
    expect(formatLastTime(lastTime(log, 2, 0, 'bss'), 3)).toBe('Last time: 10 · 9 · 9');
    expect(weightTrend(log, 2)?.diffText).toBe('+0.6 kg');
  });

  it('warns about and skips invalid values and unknown keys', () => {
    const bad = legacyToLog(
      {
        weeks: {
          1: {
            weight: '500',
            food: 'Pizza',
            s: [{ ex: { pushups: { r: ['120', '-2', 'x', '10'], load: '-2' }, burpees: { r: ['10'] } } }],
          },
          13: { weight: '50' },
        },
      },
      SIZE_BLUEPRINT
    );
    expect(bad.log[1].checkin.weight).toBeNull();
    expect(bad.log[1].checkin.food).toBeNull();
    expect(bad.log[1].sessions[0].ex.pushups).toEqual({ reps: [null, null, null, 10], repsRight: [], load: null, variation: null });
    expect(bad.log[1].sessions[0].ex.burpees).toBeUndefined();
    expect(bad.log[13]).toBeUndefined();
    const messages = bad.warnings.map((w) => w.message);
    expect(messages).toContain('weight: "500" is not a valid weight, skipped');
    expect(messages).toContain('food "Pizza" is not one of the options, skipped');
    expect(messages).toContain('pushups set 1: "120" is not a valid reps, skipped');
    expect(bad.warnings.some((w) => w.message.includes('burpees'))).toBe(true);
    expect(bad.warnings.some((w) => w.week === 13)).toBe(true);
    expect(logToRows(bad.log).sets.map((s) => s.set_index)).toEqual([3]);
  });
});

describe('mergeLegacy', () => {
  it('takes the account copy unless the local one has more filled fields', () => {
    const account = parseLegacy(ACCOUNT_DOCS);
    const local = parseLegacy(LOCAL_SBL);
    expect(filledFields(account.weeks[1])).toBe(3); // weight, notes, date
    expect(filledFields(local.weeks[1])).toBeGreaterThan(3);

    const merged = mergeLegacy(account, local);
    expect(merged.start).toBe('2026-10-20');
    expect(merged.weeks[1]).toBe(local.weeks[1]);
    expect(merged.weeks[2]).toBe(local.weeks[2]);

    // equal counts keep the account copy
    const tie = mergeLegacy(account, { start: null, weeks: { 1: { weight: '51', notes: 'x', s: [{ date: '2026-10-21' }] } } });
    expect(tie.weeks[1]).toBe(account.weeks[1]);
  });

  it('is reachable through parseLegacy({ account, local })', () => {
    const merged = parseLegacy({ account: ACCOUNT_DOCS, local: LOCAL_SBL });
    expect(merged.weeks[1].sleep).toBe('7.5');
  });
});
