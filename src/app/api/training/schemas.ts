import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LIMITS } from '@/features/training/rules';
import { FOOD_OPTIONS } from '@/features/training/types';

/** Gap 5: ranges match the inputs and the table CHECK constraints. */
const ranged = (name: keyof typeof LIMITS) => {
  const l = LIMITS[name];
  const base = z.number().min(l.min, `${name} must be at least ${l.min}`).max(l.max, `${name} must be at most ${l.max}`);
  return (l.integer ? base.int(`${name} must be a whole number`) : base).nullable();
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const runId = z.string().uuid();
const week = z.number().int().min(1).max(52);
const slot = z.number().int().min(0).max(2);
const key = z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/i);

export const setSchema = z.object({
  runId, week, slot, key,
  index: z.number().int().min(0).max(9),
  reps: ranged('reps'),
  repsRight: ranged('reps').default(null),
});

export const entrySchema = z.object({
  runId, week, slot, key,
  load: ranged('load'),
  variation: z.string().max(200).nullable().default(null),
});

export const sessionSchema = z.object({
  runId, week, slot,
  date: isoDate.nullable(),
  done: z.boolean(),
});

export const checkinSchema = z.object({
  runId, week,
  weight: ranged('weight'),
  sleep: ranged('sleep'),
  food: z.enum(FOOD_OPTIONS).nullable(),
  notes: z.string().max(4000).nullable(),
});

export const measurementSchema = z.object({
  runId, week,
  waist: ranged('waist'),
  chest: ranged('chest'),
  arm: ranged('arm'),
  thigh: ranged('thigh'),
  photos: z.boolean(),
});

export const startRunSchema = z.object({ startDate: isoDate });

/** Parses a JSON body; returns the data or a 400 response listing the problems. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const error = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return { ok: false, res: NextResponse.json({ error }, { status: 400 }) };
  }
  return { ok: true, data: result.data };
}
