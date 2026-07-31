'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSpeech } from '@/lib/useSpeech';
import type { Note } from '@/lib/types';

interface Props {
  onStored: (note: Note) => void;
}

type Phase = 'idle' | 'thinking' | 'done';

export default function CapturePanel({ onStored }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [lastNote, setLastNote] = useState<Note | null>(null);

  async function store(text: string, source: 'voice' | 'text') {
    setPhase('thinking');
    setMessage(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setLastNote(data.note);
      setPhase('done');
      onStored(data.note);
      setTimeout(() => setPhase('idle'), 4000);
    } catch (err) {
      setMessage((err as Error).message);
      setPhase('idle');
    }
  }

  const speech = useSpeech((text) => store(text, 'voice'));

  // The `R` key and the command palette both toggle recording through this event.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  useEffect(() => {
    const toggle = () => {
      const s = speechRef.current;
      if (!s.supported) return;
      s.recording ? s.stop() : s.start();
    };
    window.addEventListener('synapse:record', toggle);
    return () => window.removeEventListener('synapse:record', toggle);
  }, []);

  const busy = phase === 'thinking';
  const liveText = `${speech.finalText}${speech.interim}`.trim();

  return (
    <div className="panel relative overflow-hidden rounded-2xl p-5">
      <div className="mono mb-4 text-[10px] uppercase tracking-[0.18em] text-muted">Capture</div>

      <div className="flex items-center gap-4">
        {/* Record button */}
        <button
          onClick={() => (speech.recording ? speech.stop() : speech.start())}
          disabled={!speech.supported || busy}
          className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all duration-300 disabled:opacity-40 ${
            speech.recording
              ? 'glow bg-rose text-bg'
              : 'glow bg-accent text-white hover:scale-105'
          }`}
          aria-label={speech.recording ? 'Stop recording' : 'Start recording'}
        >
          {speech.recording && <span className="pulse-ring absolute inset-0 rounded-full" />}
          {speech.recording ? (
            <span className="h-4 w-4 rounded-[3px] bg-bg" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1A6 6 0 0 0 18 11Z" />
            </svg>
          )}
        </button>

        {/* Waveform */}
        <div className="flex h-14 flex-1 items-center gap-[3px]">
          {Array.from({ length: 32 }).map((_, i) => {
            const wave = Math.sin(i * 0.55 + Date.now() * 0.001) * 0.5 + 0.5;
            const h = speech.recording ? 4 + speech.level * wave * 44 : 3;
            return (
              <motion.span
                key={i}
                animate={{ height: h }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                className={`w-full rounded-full ${speech.recording ? 'bg-rose/80' : 'bg-line'}`}
                style={{ height: h }}
              />
            );
          })}
        </div>
      </div>

      {/* Live transcript */}
      <AnimatePresence>
        {(speech.recording || liveText) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <p className="mt-4 rounded-xl border border-line/60 bg-bg/50 p-3 text-sm leading-relaxed">
              <span className="text-ink">{speech.finalText}</span>
              <span className="text-muted italic">{speech.interim}</span>
              {!liveText && <span className="text-muted">Listening…</span>}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Text fallback */}
      <div className="mt-4 flex gap-2">
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
          className="flex-1 rounded-xl border border-line/70 bg-bg/60 px-3 py-2 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent/70 focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {/* Status */}
      <div className="mono mt-3 min-h-[18px] text-[11px]">
        <AnimatePresence mode="wait">
          {busy && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 text-cyan"
            >
              <span className="h-1.5 w-1.5 animate-cyan rounded-full bg-cyan" />
              Extracting entities, embedding, weaving into graph…
            </motion.div>
          )}
          {phase === 'done' && lastNote && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-green"
            >
              ✦ {lastNote.title} — {lastNote.entities.length} entities linked
            </motion.div>
          )}
          {!busy && phase !== 'done' && (speech.error || message) && (
            <motion.div
              key="err"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-rose"
            >
              {speech.error || message}
            </motion.div>
          )}
          {!speech.supported && !speech.error && (
            <motion.div key="unsup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-amber">
              Voice needs Chrome or Edge. Typing works everywhere.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
