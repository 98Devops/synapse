import { NextResponse } from 'next/server';
import { transcribe } from '@/lib/stt';
import { requireUser, supabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * POST multipart { audio } -> { text, audioPath }
 * Transcribes, and keeps the original recording in the private bucket so the
 * note can be played back later.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Recording was empty' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Recording is too long (max 25MB)' }, { status: 413 });
    }

    const mime = (file.type || 'audio/webm').split(';')[0];
    const ext = EXT[mime] ?? 'webm';
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

    // Transcribe and store concurrently — neither depends on the other.
    const [text, upload] = await Promise.all([
      transcribe(file, mime, `note.${ext}`),
      (async () => {
        const supabase = await supabaseServer();
        const { error } = await supabase.storage
          .from('recordings')
          .upload(path, file, { contentType: mime, upsert: false });
        if (error) {
          // Losing the audio is survivable; losing the transcript is not.
          console.error('[transcribe] audio upload failed:', error.message);
          return null;
        }
        return path;
      })(),
    ]);

    if (!text) {
      return NextResponse.json(
        { error: 'No speech detected in the recording.', audioPath: upload },
        { status: 422 }
      );
    }

    return NextResponse.json({ text, audioPath: upload });
  } catch (err) {
    return fail(err);
  }
}
