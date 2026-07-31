import { getEnv, optional } from './env';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const ELEVEN_API = 'https://api.elevenlabs.io/v1';

/**
 * Flash v2.5 is ElevenLabs' low-latency model (~75ms to first byte) and is the
 * reason this path feels conversational where Gemini TTS does not.
 */
const ELEVEN_MODEL = 'eleven_flash_v2_5';

export function hasElevenLabs() {
  return Boolean(optional('ELEVENLABS_API_KEY'));
}

/**
 * Free accounts get a 402 for Voice Library voices, so we never hardcode an id.
 * Instead we resolve one from the account's own premade voices and cache it.
 * Preference order is just "which reads best as an assistant".
 */
const PREFERRED = ['River', 'Sarah', 'Alice', 'Matilda', 'George'];
const USABLE_CATEGORIES = new Set(['premade', 'professional', 'cloned', 'generated']);

let cachedVoiceId: string | null = null;

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

async function listVoices(key: string): Promise<ElevenVoice[]> {
  const res = await fetch(`${ELEVEN_API}/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.voices ?? []).filter((v: ElevenVoice) => USABLE_CATEGORIES.has(v.category ?? ''));
}

async function defaultVoiceId(key: string): Promise<string> {
  if (cachedVoiceId) return cachedVoiceId;
  const voices = await listVoices(key);
  if (!voices.length) throw new Error('No usable ElevenLabs voices on this account');

  const preferred = PREFERRED.map((n) =>
    voices.find((v) => v.name.toLowerCase().startsWith(n.toLowerCase()))
  ).find(Boolean);

  cachedVoiceId = (preferred ?? voices[0]).voice_id;
  return cachedVoiceId;
}

/** Streams MP3 straight from ElevenLabs — no buffering on our side. */
export async function elevenLabsStream(
  text: string,
  voiceId?: string
): Promise<ReadableStream<Uint8Array>> {
  const key = optional('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');

  const id = voiceId || (await defaultVoiceId(key));

  const res = await fetch(
    `${ELEVEN_API}/text-to-speech/${id}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, speed: 1.05 },
      }),
    }
  );

  if (!res.ok || !res.body) {
    throw new Error(`ElevenLabs failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res.body;
}

/** Only voices this account can actually synthesise with — no 402 surprises. */
export async function elevenLabsVoices() {
  const key = optional('ELEVENLABS_API_KEY');
  if (!key) return [];
  const voices = await listVoices(key);
  return voices.map((v) => ({
    // Names arrive as "Roger - Laid-Back, Casual" — split the descriptor out.
    id: v.voice_id,
    label: v.name.split(' - ')[0].trim(),
    description: v.name.includes(' - ')
      ? v.name.split(' - ').slice(1).join(' - ').trim()
      : [v.labels?.accent, v.labels?.description].filter(Boolean).join(', '),
  }));
}

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
