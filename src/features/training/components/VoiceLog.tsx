'use client';

import { useCallback, useState } from 'react';
import { useRecorder } from '@/lib/useRecorder';
import { fmtNum, setLabel } from '../rules';
import type { ParsedItem, ProgramExercise, Workout } from '../types';

export type { ParsedItem };

type Phase = 'idle' | 'recording' | 'transcribing' | 'parsing' | 'confirm';

/**
 * "Push-ups 12, 10, 9 with 2 kilos" -> confirmation card -> set and load
 * edits. Mic uses the same record -> /api/transcribe flow as capture; a text
 * box is the fallback.
 */
export default function VoiceLog({
  workout,
  exercises,
  onConfirm,
}: {
  workout: Workout;
  exercises: ProgramExercise[];
  onConfirm: (items: ParsedItem[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const parse = useCallback(
    async (transcript: string) => {
      setPhase('parsing');
      setError(null);
      try {
        const res = await fetch('/api/training/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, workout }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Could not read that (${res.status})`);
        if (!data.items?.length) throw new Error(`Heard “${transcript}” but found no sets in it.`);
        setItems(data.items);
        setPhase('confirm');
      } catch (err) {
        setError((err as Error).message);
        setPhase('idle');
      }
    },
    [workout]
  );

  const onAudio = useCallback(
    async (audio: Blob) => {
      setPhase('transcribing');
      setError(null);
      try {
        const form = new FormData();
        form.append('audio', audio, 'training.webm');
        const res = await fetch('/api/transcribe', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Transcription failed (${res.status})`);
        setText(data.text);
        await parse(data.text);
      } catch (err) {
        setError((err as Error).message);
        setPhase('idle');
      }
    },
    [parse]
  );

  const recorder = useRecorder(onAudio);
  const byKey = new Map(exercises.map((e) => [e.key, e]));
  const busy = phase === 'transcribing' || phase === 'parsing';

  const toggleMic = async () => {
    setOpen(true);
    if (recorder.recording) recorder.stop();
    else await recorder.start();
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy || !recorder.supported}
          aria-label={recorder.recording ? 'Stop and log what you said' : 'Log sets by voice'}
          className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full border transition disabled:opacity-40 ${
            recorder.recording ? 'pulse-ring border-rose bg-rose/15 text-rose' : 'border-line text-muted hover:text-ink'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-11 rounded-lg px-2 text-[12px] text-muted hover:text-ink"
          aria-expanded={open}
        >
          {recorder.recording
            ? `Listening… ${recorder.seconds}s`
            : phase === 'transcribing'
              ? 'Transcribing…'
              : phase === 'parsing'
                ? 'Reading sets…'
                : 'Type instead'}
        </button>
      </div>

      {open && phase !== 'confirm' && !recorder.recording && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void parse(text.trim());
          }}
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="push-ups 12, 10, 9 with 2 kilos"
            aria-label="Describe your sets"
            className="focus-ring h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="h-11 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Read
          </button>
        </form>
      )}

      {(error || recorder.error) && <p className="mt-2 text-[12px] text-rose">{error ?? recorder.error}</p>}

      {phase === 'confirm' && (
        <div className="mt-2 rounded-xl border border-accent/40 bg-accent-soft p-3">
          <div className="label mb-2">Save these sets?</div>
          <ul className="space-y-1.5">
            {items.map((it) => {
              const ex = byKey.get(it.key);
              const sets = it.reps.map((r, i) => setLabel(r, it.repsRight?.[i])).join(' · ');
              return (
                <li key={it.key} className="text-[13px]">
                  <span className="text-ink">{ex?.name ?? it.key}</span>{' '}
                  <span className="mono text-muted">
                    {sets}
                    {it.load !== null && it.load !== undefined ? ` with ${fmtNum(it.load)} kg` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onConfirm(items);
                setItems([]);
                setText('');
                setPhase('idle');
                setOpen(false);
              }}
              className="h-11 flex-1 rounded-lg bg-accent text-[14px] font-semibold text-white"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setItems([]);
                setPhase('idle');
              }}
              className="h-11 flex-1 rounded-lg border border-line text-[14px] text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
