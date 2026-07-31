'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceMode = 'off' | 'instant' | 'natural';

const KEY = 'synapse-voice-mode';

/** Strips citation markers and markdown so nothing is read aloud literally. */
function speakable(text: string) {
  return text
    .replace(/\s*\[id=[^\]]+\]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*#`_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Two ways to talk back:
 *  - "instant" uses the browser's own speech synthesis and starts speaking each
 *    sentence the moment it finishes streaming, so the reply feels live.
 *  - "natural" calls Gemini TTS once the answer is complete: much better voice,
 *    but a few seconds of latency first.
 */
export function useSpeaker() {
  const [mode, setMode] = useState<VoiceMode>('instant');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<'elevenlabs' | 'gemini'>('gemini');

  // Which engine is actually configured server-side drives the UI label.
  useEffect(() => {
    fetch('/api/voices')
      .then((r) => r.json())
      .then((d) => d.engine && setEngine(d.engine))
      .catch(() => {});
  }, []);

  const spokenUpTo = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as VoiceMode | null;
      if (saved) setMode(saved);
    } catch {
      /* private mode */
    }
  }, []);

  const persist = useCallback((next: VoiceMode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setSpeaking(false);
  }, []);

  /** Call repeatedly with the answer so far; only new whole sentences are read. */
  const feed = useCallback(
    (fullText: string) => {
      if (mode !== 'instant' || !window.speechSynthesis) return;

      const clean = speakable(fullText);
      const pending = clean.slice(spokenUpTo.current);
      // Only speak up to the last sentence boundary — avoids reading half a word.
      const lastEnd = Math.max(pending.lastIndexOf('. '), pending.lastIndexOf('! '), pending.lastIndexOf('? '));
      if (lastEnd === -1) return;

      const chunk = pending.slice(0, lastEnd + 1).trim();
      if (!chunk) return;
      spokenUpTo.current += lastEnd + 1;

      const utter = new SpeechSynthesisUtterance(chunk);
      utter.rate = 1.05;
      utter.pitch = 1;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(window.speechSynthesis.pending || window.speechSynthesis.speaking);
      window.speechSynthesis.speak(utter);
    },
    [mode]
  );

  /** Speak whatever remains once the stream has finished. */
  const flush = useCallback(
    async (fullText: string, voice = 'Kore') => {
      const clean = speakable(fullText);
      if (!clean) return;

      if (mode === 'instant') {
        if (!window.speechSynthesis) return;
        const rest = clean.slice(spokenUpTo.current).trim();
        spokenUpTo.current = clean.length;
        if (!rest) return;
        const utter = new SpeechSynthesisUtterance(rest);
        utter.rate = 1.05;
        utter.onstart = () => setSpeaking(true);
        utter.onend = () => setSpeaking(false);
        window.speechSynthesis.speak(utter);
        return;
      }

      if (mode !== 'natural') return;

      try {
        setSpeaking(true);
        setError(null);
        // The response streams from ElevenLabs; we buffer it because MediaSource
        // MP3 append is unreliable across browsers and flash-v2.5 is fast enough
        // that the whole clip usually arrives in under a second anyway.
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, voice }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Speech failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
          urlRef.current = null;
        };
        await audio.play();
      } catch (err) {
        setError((err as Error).message);
        setSpeaking(false);
      }
    },
    [mode]
  );

  /** Reset the sentence cursor before a new answer starts. */
  const reset = useCallback(() => {
    spokenUpTo.current = 0;
    stop();
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { mode, setMode: persist, speaking, error, engine, feed, flush, reset, stop };
}
