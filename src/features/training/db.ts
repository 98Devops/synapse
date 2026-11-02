import type { supabaseServer } from '@/lib/supabase/server';
import { SIZE_BLUEPRINT, SIZE_BLUEPRINT_SLUG, exercisesFor } from './program';
import { addLoadDue, currentWeek, emptyCheckin, emptyWeek, lastTime, sessionOrder, weightTrend } from './rules';
import { logToRows } from './legacy';
import {
  FOOD_OPTIONS,
  type Food,
  type Program,
  type RunInfo,
  type RunLog,
  type TrainingOp,
  type WeekPayload,
  type Workout,
} from './types';

/** RLS-scoped client from supabaseServer(); every query runs as the user. */
export type DB = Awaited<ReturnType<typeof supabaseServer>>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Like check(), for selects that must return rows. */
function need<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = check(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no data returned`);
  return data as NonNullable<T>;
}

// ================================================================ program
/** Program from programs/program_exercises; in-code copy if the DB has no exercises. */
export async function loadProgram(db: DB, slug = SIZE_BLUEPRINT_SLUG): Promise<Program> {
  const { data, error } = await db
    .from('programs')
    .select('id, slug, name, weeks, program_exercises ( workout, code, key, name, sets, rep_lo, rep_hi, note, unilateral, sort )')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Loading program: ${error.message}`);
  if (!data) return slug === SIZE_BLUEPRINT_SLUG ? SIZE_BLUEPRINT : Promise.reject(new Error(`No program ${slug}`));

  const rows = (data.program_exercises ?? []) as Record<string, unknown>[];
  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    weeks: Number(data.weeks),
    exercises: rows.length
      ? rows.map((r) => ({
          workout: r.workout as Workout,
          code: String(r.code),
          key: String(r.key),
          name: String(r.name),
          sets: Number(r.sets),
          repLo: Number(r.rep_lo),
          repHi: Number(r.rep_hi),
          note: String(r.note ?? ''),
          unilateral: Boolean(r.unilateral),
          sort: Number(r.sort),
        }))
      : SIZE_BLUEPRINT.exercises,
  };
}

// ==================================================================== run
export async function getCurrentRun(db: DB, userId: string): Promise<RunInfo | null> {
  const { data, error } = await db
    .from('program_runs')
    .select('id, program_id, start_date')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Loading run: ${error.message}`);
  return data ? { id: data.id, programId: data.program_id, startDate: data.start_date } : null;
}

export async function createRun(db: DB, userId: string, programId: string, startDate: string): Promise<RunInfo> {
  const data = need(
    await db
      .from('program_runs')
      .insert({ user_id: userId, program_id: programId, start_date: startDate })
      .select('id, program_id, start_date')
      .single(),
    'Starting program'
  );
  return { id: data.id, programId: data.program_id, startDate: data.start_date };
}

// ==================================================================== log
/** The whole run as a normalized log: three parallel queries. */
export async function loadLog(db: DB, runId: string): Promise<RunLog> {
  const [sessions, checkins, measurements] = await Promise.all([
    db
      .from('training_sessions')
      .select(
        'week, slot, date, done, exercise_entries ( exercise_key, load_kg, variation, exercise_sets ( set_index, reps, reps_right ) )'
      )
      .eq('run_id', runId),
    db.from('weekly_checkins').select('week, weight_kg, sleep_h, food, notes').eq('run_id', runId),
    db.from('measurements').select('week, waist_cm, chest_cm, arm_cm, thigh_cm, photos').eq('run_id', runId),
  ]);

  const log: RunLog = {};
  const week = (w: number) => (log[w] ??= emptyWeek());

  for (const s of check(sessions, 'Loading sessions') ?? []) {
    const session = week(s.week).sessions[s.slot];
    if (!session) continue;
    session.date = s.date ?? null;
    session.done = Boolean(s.done);
    for (const e of (s.exercise_entries ?? []) as Record<string, any>[]) {
      const reps: (number | null)[] = [];
      const repsRight: (number | null)[] = [];
      for (const set of (e.exercise_sets ?? []) as Record<string, any>[]) {
        while (reps.length <= set.set_index) reps.push(null);
        while (repsRight.length <= set.set_index) repsRight.push(null);
        reps[set.set_index] = num(set.reps);
        repsRight[set.set_index] = num(set.reps_right);
      }
      while (reps.length && reps[reps.length - 1] === null) reps.pop();
      while (repsRight.length && repsRight[repsRight.length - 1] === null) repsRight.pop();
      session.ex[e.exercise_key] = { reps, repsRight, load: num(e.load_kg), variation: e.variation ?? null };
    }
  }

  for (const c of check(checkins, 'Loading check-ins') ?? []) {
    week(c.week).checkin = {
      ...emptyCheckin(),
      weight: num(c.weight_kg),
      sleep: num(c.sleep_h),
      food: FOOD_OPTIONS.includes(c.food) ? (c.food as Food) : null,
      notes: c.notes ?? null,
    };
  }

  for (const m of check(measurements, 'Loading measurements') ?? []) {
    week(m.week).measurement = {
      waist: num(m.waist_cm),
      chest: num(m.chest_cm),
      arm: num(m.arm_cm),
      thigh: num(m.thigh_cm),
      photos: Boolean(m.photos),
    };
  }

  return log;
}

/** Plan, entries, check-in, measurements, plus the rules computed for one week. */
export async function weekPayload(db: DB, userId: string, requested: number | 'current'): Promise<WeekPayload> {
  const [program, run] = await Promise.all([loadProgram(db), getCurrentRun(db, userId)]);
  const current = currentWeek(run?.startDate ?? null, new Date(), program.weeks);
  const week = requested === 'current' ? current.week : Math.min(program.weeks, Math.max(1, requested));
  if (!run) return { run: null, program, current, week, log: {} };

  const log = await loadLog(db, run.id);
  const order = sessionOrder(week);
  const last: Record<string, ReturnType<typeof lastTime>> = {};
  const due: Record<string, boolean> = {};
  order.forEach((workout, slot) => {
    for (const ex of exercisesFor(program, workout)) {
      last[`${slot}:${ex.key}`] = lastTime(log, week, slot, ex.key);
      due[`${slot}:${ex.key}`] = addLoadDue(log[week]?.sessions[slot]?.ex[ex.key], ex);
    }
  });

  return {
    run,
    program,
    current,
    week,
    log,
    computed: { order, lastTime: last, addLoadDue: due, weightTrend: weightTrend(log, week) },
  };
}

// ================================================================= writes
async function rpc(db: DB, fn: string, args: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
}

/** One field-level upsert. The RPCs check run ownership and run as the caller. */
export async function applyWrite(db: DB, userId: string, op: TrainingOp): Promise<void> {
  switch (op.kind) {
    case 'set':
      return rpc(db, 'training_upsert_set', {
        p_run: op.runId,
        p_week: op.week,
        p_slot: op.slot,
        p_key: op.key,
        p_set: op.index,
        p_reps: op.reps,
        p_reps_right: op.repsRight,
      });
    case 'entry':
      return rpc(db, 'training_upsert_entry', {
        p_run: op.runId,
        p_week: op.week,
        p_slot: op.slot,
        p_key: op.key,
        p_load: op.load,
        p_variation: op.variation ?? '',
      });
    case 'session':
      return rpc(db, 'training_upsert_session', {
        p_run: op.runId,
        p_week: op.week,
        p_slot: op.slot,
        p_date: op.date,
        p_done: op.done,
      });
    case 'checkin':
      check(
        await db.from('weekly_checkins').upsert(
          {
            run_id: op.runId,
            user_id: userId,
            week: op.week,
            weight_kg: op.weight,
            sleep_h: op.sleep,
            food: op.food,
            notes: op.notes?.trim() ? op.notes : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'run_id,week' }
        ),
        'Saving check-in'
      );
      return;
    case 'measurement':
      check(
        await db.from('measurements').upsert(
          {
            run_id: op.runId,
            user_id: userId,
            week: op.week,
            waist_cm: op.waist,
            chest_cm: op.chest,
            arm_cm: op.arm,
            thigh_cm: op.thigh,
            photos: op.photos,
          },
          { onConflict: 'run_id,week' }
        ),
        'Saving measurements'
      );
      return;
  }
}

/** Confirms the run belongs to the user before a table upsert (RPCs check themselves). */
export async function assertRun(db: DB, userId: string, runId: string) {
  const { data, error } = await db.from('program_runs').select('id').eq('id', runId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Checking run: ${error.message}`);
  if (!data) {
    const err = new Error('Run not found');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
}

// ================================================================= import
export interface ImportResult {
  sessions: number;
  entries: number;
  sets: number;
  checkins: number;
  measurements: number;
}

/**
 * Idempotent: every write is an upsert on the table's natural key, so running
 * the same import twice leaves the same rows.
 */
export async function importLog(db: DB, userId: string, runId: string, log: RunLog): Promise<ImportResult> {
  const plan = logToRows(log);

  const sessionRows = plan.sessions.length
    ? need(
        await db
          .from('training_sessions')
          .upsert(
            plan.sessions.map((s) => ({ ...s, run_id: runId, user_id: userId })),
            { onConflict: 'run_id,week,slot' }
          )
          .select('id, week, slot'),
        'Importing sessions'
      )
    : [];
  const sessionId = new Map(sessionRows.map((s) => [`${s.week}:${s.slot}`, s.id as string]));

  const entryRows = plan.entries.length
    ? need(
        await db
          .from('exercise_entries')
          .upsert(
            plan.entries.map((e) => ({
              session_id: sessionId.get(`${e.week}:${e.slot}`),
              user_id: userId,
              exercise_key: e.exercise_key,
              load_kg: e.load_kg,
              variation: e.variation,
            })),
            { onConflict: 'session_id,exercise_key' }
          )
          .select('id, session_id, exercise_key'),
        'Importing exercises'
      )
    : [];
  const entryId = new Map(entryRows.map((e) => [`${e.session_id}:${e.exercise_key}`, e.id as string]));

  if (plan.sets.length) {
    check(
      await db.from('exercise_sets').upsert(
        plan.sets.map((s) => ({
          entry_id: entryId.get(`${sessionId.get(`${s.week}:${s.slot}`)}:${s.exercise_key}`),
          user_id: userId,
          set_index: s.set_index,
          reps: s.reps,
          reps_right: s.reps_right,
        })),
        { onConflict: 'entry_id,set_index' }
      ),
      'Importing sets'
    );
  }

  if (plan.checkins.length) {
    check(
      await db.from('weekly_checkins').upsert(
        plan.checkins.map((c) => ({ ...c, run_id: runId, user_id: userId })),
        { onConflict: 'run_id,week' }
      ),
      'Importing check-ins'
    );
  }

  if (plan.measurements.length) {
    check(
      await db.from('measurements').upsert(
        plan.measurements.map((m) => ({ ...m, run_id: runId, user_id: userId })),
        { onConflict: 'run_id,week' }
      ),
      'Importing measurements'
    );
  }

  return {
    sessions: plan.sessions.length,
    entries: plan.entries.length,
    sets: plan.sets.length,
    checkins: plan.checkins.length,
    measurements: plan.measurements.length,
  };
}
