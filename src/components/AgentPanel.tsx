'use client';

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TOOL_LABELS, type AgentEvent } from '@/lib/protocol';
import { useSpeaker, type VoiceMode } from '@/lib/useSpeaker';
import { useRecorder } from '@/lib/useRecorder';
import type { Citation } from '@/lib/types';

interface Step {
  name: string;
  done: boolean;
}

const SUGGESTIONS = [
  'What do I need to do?',
  'Catch me up',
  'What am I worried about?',
  'What connects to my work?',
];

const VOICE_CYCLE: VoiceMode[] = ['instant', 'natural', 'off'];
const voiceLabel = (mode: VoiceMode, engine: string) =>
  mode === 'off'
    ? 'Voice off'
    : mode === 'instant'
      ? 'Instant voice (browser, zero latency)'
      : `Natural voice (${engine === 'elevenlabs' ? 'ElevenLabs' : 'Gemini'})`;

interface Props {
  onCitations: (ids: string[]) => void;
  onSelect: (id: string) => void;
  noteCount: number;
  /** Lets a conversation become a note, so reasoning enters the graph. */
  onSaved?: () => void;
}

export default function AgentPanel({ onCitations, onSelect, noteCount, onSaved }: Props) {
  const [saved, setSaved] = useState<'idle' | 'saving' | 'done'>('idle');
  const [voiceMenu, setVoiceMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converse, setConverse] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const converseRef = useRef(false);
  converseRef.current = converse;

  const speaker = useSpeaker();
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  const ask = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const sp = speakerRef.current;
      sp.reset();

      setBusy(true);
      setAnswer('');
      setSteps([]);
      setCitations([]);
      setError(null);
      setSaved('idle');
      onCitations([]);

      let accumulated = '';

      try {
        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Agent failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            let e: AgentEvent;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }

            if (e.type === 'tool') {
              setSteps((prev) =>
                prev.some((s) => s.name === e.name) ? prev : [...prev, { name: e.name, done: false }]
              );
            }
            if (e.type === 'tool_done') {
              setSteps((prev) =>
                prev.some((s) => s.name === e.name)
                  ? prev.map((s) => (s.name === e.name ? { ...s, done: true } : s))
                  : [...prev, { name: e.name, done: true }]
              );
            }
            if (e.type === 'token') {
              accumulated += e.text;
              setAnswer(accumulated);
              sp.feed(accumulated); // speaks each completed sentence live
            }
            if (e.type === 'citations') {
              setCitations(e.citations);
              onCitations(e.citations.map((c) => c.id));
            }
            if (e.type === 'error') setError(e.message);
          }
        }

        await sp.flush(accumulated);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      } finally {
        setBusy(false);
        // Hands-free: listen again once the reply has been delivered.
        if (converseRef.current) setTimeout(() => listenRef.current?.(), 700);
      }
    },
    [onCitations]
  );

  // Voice input for the agent. Recorded here, transcribed server-side, so it
  // works in Brave/Firefox/Safari exactly like it does in Chrome.
  const [transcribing, setTranscribing] = useState(false);
  const voice = useRecorder(async (audio) => {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', audio, 'question.webm');
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not transcribe');
      setQuery(data.text);
      await ask(data.text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTranscribing(false);
    }
  });

  const listenRef = useRef<(() => void) | null>(null);
  listenRef.current = () => {
    if (!voice.recording) voice.start();
  };

  const clean = answer.replace(/\s*\[id=[^\]]+\]/g, '');

  /** Turns the exchange into a note, so the thinking doesn't die in the chat. */
  async function saveExchange() {
    if (saved !== 'idle' || !clean) return;
    setSaved('saving');
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `I asked my second brain: "${query}"\n\nThe answer was: ${clean}`,
          source: 'text',
        }),
      });
      setSaved('done');
      onSaved?.();
    } catch {
      setSaved('idle');
    }
  }

  const cycleVoice = () =>
    speaker.setMode(VOICE_CYCLE[(VOICE_CYCLE.indexOf(speaker.mode) + 1) % VOICE_CYCLE.length]);

  return (
    <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          <span className="label">Agent</span>
        </div>

        <div className="relative flex items-center gap-1">
          {speaker.engine === 'elevenlabs' && speaker.voices.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setVoiceMenu((v) => !v)}
                title="Choose the voice"
                className="mono rounded-md px-1.5 py-1 text-[10px] text-muted transition hover:bg-accent-soft hover:text-ink"
              >
                {speaker.voices.find((v) => v.id === speaker.voiceId)?.label ?? 'Voice'}
              </button>

              <AnimatePresence>
                {voiceMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="panel absolute right-0 top-8 z-50 max-h-64 w-56 overflow-y-auto rounded-xl p-1"
                  >
                    {speaker.voices.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          speaker.chooseVoice(v.id);
                          setVoiceMenu(false);
                          speaker.reset();
                          speaker.flush(`Hello, I'm ${v.label}. I'll read your notes back to you.`, v.id);
                        }}
                        className={`block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-accent-soft ${
                          v.id === speaker.voiceId ? 'bg-accent-soft' : ''
                        }`}
                      >
                        <div className="text-[12px] text-ink">{v.label}</div>
                        {v.description && (
                          <div className="text-[10px] leading-tight text-muted">{v.description}</div>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {speaker.speaking && (
            <button
              onClick={speaker.stop}
              className="mono rounded-md px-1.5 py-1 text-[10px] text-rose transition hover:bg-rose/10"
            >
              stop
            </button>
          )}
          <button
            onClick={cycleVoice}
            title={voiceLabel(speaker.mode, speaker.engine)}
            className={`rounded-md p-1.5 transition hover:bg-accent-soft ${
              speaker.mode === 'off' ? 'text-faint' : speaker.mode === 'natural' ? 'text-cyan' : 'text-accent'
            }`}
            aria-label={voiceLabel(speaker.mode, speaker.engine)}
          >
            {speaker.mode === 'off' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
                <path d="m17 9 4 6M21 9l-4 6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
                {speaker.mode === 'natural' && <path d="M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />}
              </svg>
            )}
          </button>
          <button
            onClick={() => {
              const next = !converse;
              setConverse(next);
              if (next) voice.start();
              else voice.stop();
            }}
            title="Hands-free conversation"
            className={`rounded-md p-1.5 transition hover:bg-accent-soft ${
              converse ? 'text-rose' : 'text-faint'
            }`}
            aria-label="Hands-free conversation"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 8a4 4 0 1 1 8 0v3a4 4 0 0 1-8 0Z" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
            </svg>
          </button>
          <span className="label ml-1">{noteCount}</span>
        </div>
      </div>

      <div className="shrink-0 p-3">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && ask(query)}
            placeholder={
              voice.recording ? 'Recording…' : transcribing ? 'Transcribing…' : 'Ask your brain anything…'
            }
            className="focus-ring w-full rounded-xl border border-line bg-bg/60 py-2.5 pl-3 pr-10 text-[13px] outline-none transition placeholder:text-faint"
          />
          <button
            onClick={() => ask(query)}
            disabled={busy || !query.trim()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-accent-soft px-2 py-1.5 text-accent transition hover:brightness-110 disabled:opacity-30"
            aria-label="Ask"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* live states */}
        {(voice.recording || converse || transcribing) && (
          <div className="mono mt-2 flex items-center gap-2 text-[10px] text-rose">
            <span className="relative flex h-2 w-2">
              <span className="pulse-ring absolute inset-0" />
              <span className="h-2 w-2 rounded-full bg-rose" />
            </span>
            {voice.recording
              ? `recording ${voice.seconds}s — click the mic to send`
              : transcribing
                ? 'transcribing…'
                : 'conversation mode — waiting'}
          </div>
        )}
        {voice.error && <div className="mono mt-2 text-[10px] text-rose">{voice.error}</div>}
        {speaker.error && <div className="mono mt-2 text-[10px] text-amber">{speaker.error}</div>}

        {!answer && !busy && steps.length === 0 && !voice.recording && !transcribing && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQuery(s);
                  ask(s);
                }}
                className="hoverable rounded-full border border-line px-2.5 py-1 text-[11px] text-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <AnimatePresence>
          {steps.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-3 space-y-1 overflow-hidden"
            >
              {steps.map((s) => (
                <motion.div
                  key={s.name}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 text-[11px] text-muted"
                >
                  {s.done ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0 text-green">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="h-[11px] w-[11px] shrink-0 animate-spin rounded-full border border-accent border-t-transparent" />
                  )}
                  <span className={s.done ? 'text-faint' : ''}>
                    {TOOL_LABELS[s.name] ?? s.name}
                    {!s.done && '…'}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {busy && !answer && steps.length === 0 && (
          <div className="space-y-2">
            {[100, 88, 72].map((w, i) => (
              <div key={i} className="h-3 overflow-hidden rounded" style={{ width: `${w}%`, background: 'var(--line)' }}>
                <div className="shimmer h-full w-full" />
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-[12px] text-rose">{error}</p>}

        {clean && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Markdown text={clean} />
            {busy && <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />}

            {!busy && (
              <button
                onClick={saveExchange}
                disabled={saved !== 'idle'}
                className="mono mt-3 rounded-lg border border-line px-2 py-1 text-[10px] text-muted transition hover:border-accent hover:text-accent disabled:opacity-60"
              >
                {saved === 'done'
                  ? '✓ saved to your brain'
                  : saved === 'saving'
                    ? 'saving…'
                    : '+ save this exchange as a note'}
              </button>
            )}
          </motion.div>
        )}

        <AnimatePresence>
          {citations.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
              <div className="label mb-2">Sources</div>
              <div className="space-y-1">
                {citations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className="hoverable flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-[12px]"
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-cyan" />
                    <span className="flex-1 truncate text-muted">{c.title}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Deliberately tiny: headings, bold, bullets. Enough for the agent's output. */
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-ink/90">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith('#'))
          return (
            <div key={i} className="pt-2 text-[12px] font-semibold uppercase tracking-wide text-accent">
              {inline(t.replace(/^#+\s*/, ''))}
            </div>
          );
        if (t.startsWith('* ') || t.startsWith('- '))
          return (
            <div key={i} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
              <span>{inline(t.slice(2))}</span>
            </div>
          );
        return <p key={i}>{inline(t)}</p>;
      })}
    </div>
  );
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
