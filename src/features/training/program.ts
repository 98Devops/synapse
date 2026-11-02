import type { Program, ProgramExercise, Workout } from './types';

/**
 * Size Blueprint Phase 1 as data. Mirrors the seed in
 * supabase/migration-003-training-and-highlights.sql — the API reads the
 * database copy; this one is used by tests and as a fallback.
 */
export const SIZE_BLUEPRINT_SLUG = 'size-blueprint-1';

const ex = (
  workout: Workout,
  code: string,
  key: string,
  name: string,
  sets: number,
  repLo: number,
  repHi: number,
  sort: number,
  note = '',
  unilateral = false
): ProgramExercise => ({ workout, code, key, name, sets, repLo, repHi, note, unilateral, sort });

export const SIZE_BLUEPRINT: Program = {
  slug: SIZE_BLUEPRINT_SLUG,
  name: 'Size Blueprint Phase 1',
  weeks: 12,
  exercises: [
    ex('A', 'A1', 'pushups', 'Backpack push-ups', 3, 8, 15, 1),
    ex('A', 'A2', 'tablerows', 'Table rows', 3, 8, 15, 2),
    ex('A', 'B1', 'bss', 'Bulgarian split squats', 3, 8, 12, 3, 'per leg', true),
    ex('A', 'B2', 'lateral', 'Lateral raises', 3, 12, 20, 4),
    ex('A', 'C1', 'dips', 'Chair dips', 2, 8, 15, 5),
    ex('A', 'C2', 'curls', 'Bicep curls', 2, 10, 15, 6),
    ex('B', 'A1', 'pike', 'Pike push-ups', 3, 6, 12, 1),
    ex('B', 'A2', 'pullups', 'Sliding pull-ups / towel rows', 3, 8, 12, 2),
    ex('B', 'B1', 'rdl', 'Romanian deadlifts', 3, 10, 15, 3),
    ex('B', 'B2', 'lateral', 'Lateral raises', 3, 12, 20, 4),
    ex('B', 'C1', 'fepush', 'Feet-elevated push-ups', 2, 8, 15, 5),
    ex('B', 'C2', 'facepull', 'Door face pulls', 2, 12, 20, 6),
    ex('B', 'D1', 'ohext', 'Overhead triceps extensions', 2, 8, 15, 7),
    ex('B', 'D2', 'curls', 'Bicep curls', 2, 10, 15, 8),
  ],
};

export const PROGRESSION_ORDER = [
  'Add reps until every set reaches the top of the range.',
  'Add load to the backpack and drop back to the bottom of the range.',
  'Slow the lowering phase to 3 seconds.',
  'Move to a harder variation.',
];

/** Exercises of one workout, in program order. */
export function exercisesFor(program: Program, workout: Workout): ProgramExercise[] {
  return program.exercises.filter((e) => e.workout === workout).sort((a, b) => a.sort - b.sort);
}

/** One definition per key (shared keys such as `curls` appear once). */
export function uniqueExercises(program: Program): ProgramExercise[] {
  const seen = new Map<string, ProgramExercise>();
  for (const e of [...program.exercises].sort((a, b) =>
    a.workout === b.workout ? a.sort - b.sort : a.workout < b.workout ? -1 : 1
  )) {
    if (!seen.has(e.key)) seen.set(e.key, e);
  }
  return [...seen.values()];
}

export function findExercise(program: Program, key: string): ProgramExercise | undefined {
  return program.exercises.find((e) => e.key === key);
}
