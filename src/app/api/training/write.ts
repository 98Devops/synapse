import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { applyWrite, assertRun } from '@/features/training/db';
import type { TrainingOp } from '@/features/training/types';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';
import { parseBody } from './schemas';

/**
 * Shared PUT handler: validate, then one upsert. `checkRun` is for the table
 * upserts; the RPCs verify run ownership themselves.
 */
export async function handleWrite<T extends z.ZodType>(
  req: Request,
  schema: T,
  toOp: (data: z.infer<T>) => TrainingOp,
  checkRun = false
) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, schema);
    if (!body.ok) return body.res;
    const db = await supabaseServer();
    const op = toOp(body.data);
    if (checkRun) await assertRun(db, user.id, op.runId);
    await applyWrite(db, user.id, op);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
