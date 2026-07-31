import { NextResponse } from 'next/server';
import { buildGraph } from '@/lib/graph';
import { scrollNotes } from '@/lib/qdrant';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    // Vectors are needed to compute the semantic edges.
    const points = await scrollNotes(true);
    return NextResponse.json(buildGraph(points));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
