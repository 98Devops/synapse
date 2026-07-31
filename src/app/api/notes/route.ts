import { NextResponse } from 'next/server';
import { embed, extract } from '@/lib/gemini';
import { scrollNotes, upsertNote } from '@/lib/qdrant';
import type { Note } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const points = await scrollNotes(false);
    const notes: Note[] = points
      .map((p) => ({ id: p.id, ...p.payload }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { text, source = 'voice' } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text (string) is required' }, { status: 400 });
    }

    const clean = text.trim();

    // Extraction and embedding are independent — run them together.
    // The embedding covers the raw text plus the extracted scaffolding, so a
    // query matching a tag or entity name still retrieves the note.
    const extraction = await extract(clean);
    const embedText = [
      extraction.title,
      clean,
      extraction.tags.join(', '),
      extraction.entities.map((e) => e.name).join(', '),
    ]
      .filter(Boolean)
      .join('\n');

    const vector = await embed(embedText, 'RETRIEVAL_DOCUMENT');

    const note: Note = {
      id: crypto.randomUUID(),
      text: clean,
      createdAt: new Date().toISOString(),
      source: source === 'text' ? 'text' : 'voice',
      ...extraction,
    };

    await upsertNote(note, vector);
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
