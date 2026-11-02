import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadProgram } from '@/features/training/db';
import { exercisesFor } from '@/features/training/program';
import { LIMITS } from '@/features/training/rules';
import { generateJson } from '@/lib/gemini';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';
import type { ParsedItem } from '@/features/training/types';
import { parseBody } from '../schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
  workout: z.enum(['A', 'B']),
});

const repsOk = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= LIMITS.reps.min && v <= LIMITS.reps.max ? v : null;

/**
 * POST { transcript, workout } -> { items: [{ key, reps, repsRight?, load }] }
 * "push-ups 12, 10, 9 with 2 kilos" becomes set and load values for the
 * confirmation card. Nothing is saved here.
 */
export async function POST(req: Request) {
  try {
    await requireUser();
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.res;

    const program = await loadProgram(await supabaseServer());
    const exercises = exercisesFor(program, body.data.workout);
    const keys = exercises.map((e) => e.key);

    const schema = {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              key: { type: 'STRING', enum: keys },
              reps: {
                type: 'ARRAY',
                items: { type: 'INTEGER' },
                description: 'Reps per set, in order. For one-leg work, the left leg.',
              },
              repsRight: {
                type: 'ARRAY',
                items: { type: 'INTEGER' },
                description: 'One-leg work only: right-leg reps per set.',
              },
              load: { type: 'NUMBER', nullable: true, description: 'Load in kg, if stated.' },
            },
            required: ['key', 'reps'],
          },
        },
      },
      required: ['items'],
    };

    const list = exercises
      .map(
        (e) =>
          `- ${e.key}: ${e.name} (${e.sets} sets of ${e.repLo}-${e.repHi}${e.unilateral ? ', per leg: left then right' : ''})`
      )
      .join('\n');

    const prompt = [
      'You turn a spoken workout log into structured sets.',
      "Exercises in today's workout (use only these keys):",
      list,
      '',
      'Rules:',
      '- One item per exercise mentioned. Map loose names to the closest key ("rows" -> the rows exercise, "split squats" -> bss).',
      '- reps: the numbers said for each set, in order. Never invent sets that were not said.',
      '- For one-leg exercises, if two numbers are given per set ("10 and 9"), put the first in reps and the second in repsRight.',
      '- load: kilograms if a weight is said ("2 kilos", "with 5 kg"). Convert pounds to kg. Omit if none.',
      '- Ignore anything that is not an exercise log.',
      '',
      'Transcript:',
      '"""',
      body.data.transcript,
      '"""',
    ].join('\n');

    const raw = await generateJson(prompt, schema);

    const byKey = new Map(exercises.map((e) => [e.key, e]));
    const items: ParsedItem[] = [];
    for (const it of Array.isArray(raw?.items) ? raw.items : []) {
      const ex = byKey.get(it?.key);
      if (!ex || items.some((x) => x.key === ex.key)) continue;
      const reps = (Array.isArray(it.reps) ? it.reps : []).slice(0, ex.sets).map(repsOk);
      const right: (number | null)[] | undefined =
        ex.unilateral && Array.isArray(it.repsRight) ? it.repsRight.slice(0, ex.sets).map(repsOk) : undefined;
      const load =
        typeof it.load === 'number' && it.load >= LIMITS.load.min && it.load <= LIMITS.load.max
          ? Math.round(it.load * 100) / 100
          : null;
      const any = (a?: (number | null)[]) => !!a?.some((r) => r !== null);
      if (!any(reps) && !any(right) && load === null) continue;
      items.push({ key: ex.key, reps, ...(right ? { repsRight: right } : {}), load });
    }

    return NextResponse.json({ items });
  } catch (err) {
    return fail(err);
  }
}
