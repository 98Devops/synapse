'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRecorder } from '@/lib/useRecorder';
import { useSpeaker } from '@/lib/useSpeaker';
import type { Note } from '@/lib/types';

interface Props {
  onStored: (note: Note) => void;
}

/**
 * A short spoken/visible confirmation of what was actually understood. Without
 * this the user has no idea whether the system heard them correctly until they
 * go hunting in the graph.
 */
function acknowledgement(note: Note): string {
  const bits: string[] = [`Filed "${note.title}"`];

  if (note.entities.length) {
    const names = note.entities.slice(0, 3).map((e) => e.name);
    const more = note.entities.length - names.length;
    bits.push(`linked to ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`);
  }
  if (note.actionItems.length) {
    bits.push(`${note.actionItems.length} action item${note.actionItems.length === 1 ? '' : 's'}`);
  }
  if (note.sentiment === 'urgent') bits.push('marked urgent');

  return bits.join(' — ') + '.';
}

type Phase = 'idle' | 'transcribing' | 'thinking' | 'done';

const PHASE_LABEL: Record<Exclude<Phase, 'idle' | 'done'>, string> = {
  transcribing: 'Transcribing your recording…',
  thinking: 'Extracting entities, embedding, weaving into graph…',
};

export default function CapturePanel({ onStored }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [transcript, setTranscript] = useState('');
  const [lastNote, setLastNote] = useState<Note | null>(null);
  const speaker = useSpeaker();

  const store = useCallback(
    async (text: string, source: 'voice' | 'text', audioPath?: string | null) => {
      setPhase('thinking');
      setMessage(null);
      try {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, source, audioPath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
        setLastNote(data.note);
        setPhase('done');
        setTranscript('');
        onStored(data.note);

        // Speak the acknowledgement only for voice capture — typing already
        // gives you visual confirmation and a talking box would be obnoxious.
        if (source === 'voice') {
          speaker.reset();
          speaker.flush(acknowledgement(data.note));
        }
        setTimeout(() => setPhase('idle'), 6000);
      } catch (err) {
        setMessage((err as Error).message);
        setPhase('idle');
      }
    },
    [onStored, speaker]
  );

  /** Recording finished -> upload, transcribe server-side, then store. */
  const handleAudio = useCallback(
    async (audio: Blob) => {
      setPhase('transcribing');
      setMessage(null);
      try {
        const form = new FormData();
        form.append('audio', audio, 'note.webm');
        const res = await fetch('/api/transcribe', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Transcription failed (${res.status})`);

        setTranscript(data.text);
        await store(data.text, 'voice', data.audioPath);
      } catch (err) {
        setMessage((err as Error).message);
        setPhase('idle');
      }
    },
    [store]
  );

  const recorder = useRecorder(handleAudio);

  // `R` and the command palette both toggle recording through this event.
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  useEffect(() => {
    const toggle = () => {
      const r = recorderRef.current;
      if (!r.supported) return;
      r.recording ? r.stop() : r.start();
    };
    window.addEventListener('synapse:record', toggle);
    return () => window.removeEventListener('synapse:record', toggle);
  }, []);

  const busy = phase === 'transcribing' || phase === 'thinking';
  const mmss = `${String(Math.floor(recorder.seconds / 60)).padStart(2, '0')}:${String(
    recorder.seconds % 60
  ).padStart(2, '0')}`;

  return (
    <div className="panel relative overflow-hidden rounded-2xl p-4">
      <div className="label mb-3">Capture</div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => (recorder.recording ? recorder.stop() : recorder.start())}
          disabled={!recorder.supported || busy}
          className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all duration-300 disabled:opacity-40 ${
            recorder.recording
              ? 'bg-rose text-white'
              : 'glow bg-accent text-white hover:scale-105'
          }`}
          aria-label={recorder.recording ? 'Stop recording' : 'Start recording'}
        >
          {recorder.recording && <span className="pulse-ring absolute inset-0 rounded-full" />}
          {recorder.recording ? (
            <span className="h-3.5 w-3.5 rounded-[3px] bg-white" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1A6 6 0 0 0 18 11Z" />
            </svg>
          )}
        </button>

        <div className="flex h-12 flex-1 items-center gap-[3px]">
          {Array.from({ length: 28 }).map((_, i) => {
            const wave = Math.sin(i * 0.6) * 0.5 + 0.5;
            const h = recorder.recording ? 3 + recorder.level * wave * 38 : 3;
            return (
              <motion.span
                key={i}
                animate={{ height: h }}
                transition={{ type: 'spring', stiffness: 340, damping: 20 }}
                className="w-full rounded-full"
                style={{ height: h, background: recorder.recording ? 'var(--rose)' : 'var(--line)' }}
              />
            );
          })}
        </div>

        {recorder.recording && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="mono text-[11px] tabular-nums text-rose">{mmss}</span>
            <button
              onClick={recorder.cancel}
              className="mono rounded px-1.5 py-1 text-[10px] text-faint transition hover:text-rose"
            >
              cancel
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {transcript && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <p className="mt-3 rounded-xl border border-line bg-bg/50 p-3 text-[13px] leading-relaxed text-ink/90">
              {transcript}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typed.trim() && !busy) {
              store(typed.trim(), 'text');
              setTyped('');
            }
          }}
          disabled={busy}
          placeholder="…or type a thought and press Enter"
          className="focus-ring flex-1 rounded-xl border border-line bg-bg/60 px-3 py-2 text-[13px] outline-none transition placeholder:text-faint"
        />
      </div>

      <div className="mono mt-2.5 min-h-[18px] text-[11px]">
        <AnimatePresence mode="wait">
          {busy && (
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 text-cyan"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
              {PHASE_LABEL[phase as 'transcribing' | 'thinking']}
            </motion.div>
          )}
          {phase === 'done' && lastNote && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="space-y-1.5"
            >
              <div className="flex items-start gap-1.5 text-green">
                <span>✦</span>
                <span className="leading-relaxed">{acknowledgement(lastNote)}</span>
              </div>
              {lastNote.actionItems.length > 0 && (
                <ul className="space-y-0.5 pl-4 text-amber">
                  {lastNote.actionItems.map((a) => (
                    <li key={a}>→ {a}</li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}
          {!busy && phase !== 'done' && (recorder.error || message) && (
            <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-rose">
              {recorder.error || message}
            </motion.div>
          )}
          {!recorder.supported && (
            <motion.div key="unsup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-amber">
              Audio recording isn&apos;t available in this browser. Typing works.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
