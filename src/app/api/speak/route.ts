import { NextResponse } from 'next/server';
import { synthesise } from '@/lib/tts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST { text, voice? } -> audio/wav */
export async function POST(req: Request) {
  try {
    const { text, voice } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text (string) is required' }, { status: 400 });
    }

    // Keep requests bounded — long answers get truncated at a sentence edge.
    let clean = text.replace(/\s*\[id=[^\]]+\]/g, '').replace(/[*#`_]/g, '').trim();
    if (clean.length > 1800) {
      const cut = clean.slice(0, 1800);
      clean = cut.slice(0, Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?')) + 1) || cut;
    }

    const wav = await synthesise(clean, typeof voice === 'string' ? voice : 'Kore');
    return new Response(new Uint8Array(wav), {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
