import { getEnv } from './env';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Primary is the faster of the two; the preview model is the fallback. */
const TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'];

export const VOICES = [
  { id: 'Kore', label: 'Kore — warm, even' },
  { id: 'Puck', label: 'Puck — bright, quick' },
  { id: 'Charon', label: 'Charon — low, calm' },
  { id: 'Aoede', label: 'Aoede — soft, airy' },
] as const;

/**
 * Gemini returns raw little-endian 16-bit PCM, which no browser will play.
 * Wrapping it in a 44-byte RIFF header makes it a normal WAV.
 */
function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** Pulls the sample rate out of e.g. "audio/L16;codec=pcm;rate=24000". */
function rateFromMime(mime: string | undefined): number {
  const m = mime?.match(/rate=(\d+)/);
  return m ? Number(m[1]) : 24_000;
}

export async function synthesise(text: string, voice = 'Kore'): Promise<Buffer> {
  const { GEMINI_API_KEY } = getEnv();
  let lastErr = '';

  for (const model of TTS_MODELS) {
    const res = await fetch(`${API}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });

    if (!res.ok) {
      lastErr = `(${res.status}) ${(await res.text()).slice(0, 200)}`;
      continue;
    }

    const data = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      lastErr = 'no audio returned';
      continue;
    }
    return pcmToWav(Buffer.from(inline.data, 'base64'), rateFromMime(inline.mimeType));
  }

  throw new Error(`Text-to-speech failed ${lastErr}`);
}
