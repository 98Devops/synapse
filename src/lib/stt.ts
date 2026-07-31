import { getEnv, optional } from './env';

/**
 * Server-side transcription. This exists because the browser Web Speech API is
 * Chrome/Edge only — Brave, Firefox and Safari either lack it or ship without
 * Google speech credentials and fail with a `network` error. Recording with
 * MediaRecorder and transcribing here works in every browser.
 */

const ELEVEN_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Scribe is purpose-built and measured ~1.3s; Gemini is the fallback at ~2.6s. */
async function elevenLabsTranscribe(audio: Blob, filename: string): Promise<string> {
  const key = optional('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY not set');

  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model_id', 'scribe_v1');

  const res = await fetch(ELEVEN_STT, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs STT (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.text ?? '').trim();
}

async function geminiTranscribe(audio: Blob, mimeType: string): Promise<string> {
  const { GEMINI_API_KEY } = getEnv();
  const base64 = Buffer.from(await audio.arrayBuffer()).toString('base64');

  for (const model of ['gemini-3.1-flash-lite', 'gemini-2.0-flash']) {
    const res = await fetch(`${GEMINI_API}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Transcribe this audio verbatim. Output only the transcript, no commentary. If there is no intelligible speech, output nothing.',
              },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    }
    // 429/503 — try the next model rather than giving up.
    if (res.status < 429) {
      throw new Error(`Gemini STT (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  }
  throw new Error('All Gemini transcription models were rate limited');
}

export async function transcribe(audio: Blob, mimeType: string, filename: string): Promise<string> {
  if (optional('ELEVENLABS_API_KEY')) {
    try {
      const text = await elevenLabsTranscribe(audio, filename);
      if (text) return text;
    } catch (err) {
      console.error('[stt] ElevenLabs failed, falling back to Gemini:', (err as Error).message);
    }
  }
  return geminiTranscribe(audio, mimeType);
}
