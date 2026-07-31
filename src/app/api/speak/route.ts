import { NextResponse } from 'next/server';
import { elevenLabsStream, hasElevenLabs, synthesise } from '@/lib/tts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Strips citation markers and markdown so nothing is read out literally. */
function clean(text: string) {
  let out = text
    .replace(/\s*\[id=[^\]]+\]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*#`_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length > 2500) {
    const cut = out.slice(0, 2500);
    const end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    out = end > 0 ? cut.slice(0, end + 1) : cut;
  }
  return out;
}

/**
 * POST { text, voice? } -> audio
 * ElevenLabs when a key is configured (streamed MP3, ~0.5s to audio),
 * otherwise Gemini TTS (buffered WAV, ~6s).
 */
export async function POST(req: Request) {
  try {
    const { text, voice } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text (string) is required' }, { status: 400 });
    }

    const spoken = clean(text);
    if (!spoken) return NextResponse.json({ error: 'nothing to speak' }, { status: 400 });

    if (hasElevenLabs()) {
      try {
        const stream = await elevenLabsStream(spoken, typeof voice === 'string' && voice ? voice : undefined);
        return new Response(stream, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-store',
            'X-Voice-Engine': 'elevenlabs',
          },
        });
      } catch (err) {
        // Fall through to Gemini rather than leaving the user in silence.
        console.error('[speak] ElevenLabs failed, falling back:', (err as Error).message);
      }
    }

    const wav = await synthesise(spoken, typeof voice === 'string' && voice.length < 20 ? voice : 'Kore');
    return new Response(new Uint8Array(wav), {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'no-store',
        'X-Voice-Engine': 'gemini',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
