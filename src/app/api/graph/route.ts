import { NextResponse } from 'next/server';
import { buildGraph } from '@/lib/graph';
import { scrollNotes } from '@/lib/qdrant';
import { requireUser } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await requireUser();
    // Vectors are needed to compute the semantic edges.
    const points = await scrollNotes(user.id, true);
    return NextResponse.json(buildGraph(points));
  } catch (err) {
    return fail(err);
  }
}
