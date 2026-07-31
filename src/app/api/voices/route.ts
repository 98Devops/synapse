import { NextResponse } from 'next/server';
import { elevenLabsVoices, hasElevenLabs, VOICES } from '@/lib/tts';

export const dynamic = 'force-dynamic';

/** Tells the client which engine is live and what voices it can offer. */
export async function GET() {
  if (hasElevenLabs()) {
    const voices = await elevenLabsVoices();
    if (voices.length) return NextResponse.json({ engine: 'elevenlabs', voices });
  }
  return NextResponse.json({
    engine: 'gemini',
    voices: VOICES.map((v) => ({ id: v.id, label: v.label, description: '' })),
  });
}
