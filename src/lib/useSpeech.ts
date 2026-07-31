'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Minimal shape of the Web Speech API we rely on. */
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

export const SPEECH_ERROR_HELP: Record<string, string> = {
  'not-allowed':
    'Microphone blocked. Click the icon at the left of the address bar, allow Microphone, then reload.',
  'service-not-allowed':
    'The browser blocked the speech service. Brave and most privacy browsers ship without Google speech access — use Chrome or Edge.',
  network:
    'Could not reach the speech service. Brave and Chromium builds without Google API keys fail this way — use Chrome or Edge.',
  'audio-capture':
    'No microphone found. Check Windows Settings → Sound → Input and that no other app is holding the mic.',
  'no-speech': 'No speech detected. Start talking right after you hit record.',
  aborted: 'Recording stopped before anything was captured.',
};

export function useSpeech(onComplete: (text: string) => void) {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const errorRef = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // audio meter (separate from recognition — drives the waveform)
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const Ctor =
      typeof window !== 'undefined' &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    setSupported(Boolean(Ctor));
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Meter is decorative — recognition still works without it.
    }
  }, []);

  const start = useCallback(() => {
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }

    finalRef.current = '';
    errorRef.current = null;
    setFinalText('');
    setInterim('');
    setError(null);

    const rec: SpeechRecognitionLike = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e: any) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += chunk + ' ';
        else live += chunk;
      }
      setFinalText(finalRef.current);
      setInterim(live);
    };

    rec.onerror = (e: any) => {
      // Keep the real cause — onend fires next and must not overwrite it.
      errorRef.current = e.error;
      setError(SPEECH_ERROR_HELP[e.error] ?? `Speech error: ${e.error}`);
    };

    rec.onend = () => {
      setRecording(false);
      setInterim('');
      stopMeter();
      const text = finalRef.current.trim();
      if (errorRef.current) return;
      if (!text) {
        setError('Nothing captured — no speech reached the recognizer.');
        return;
      }
      onCompleteRef.current(text);
      finalRef.current = '';
      setFinalText('');
    };

    recRef.current = rec;
    try {
      rec.start();
      setRecording(true);
      startMeter();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [startMeter, stopMeter]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  useEffect(() => () => stopMeter(), [stopMeter]);

  return { supported, recording, interim, finalText, error, level, start, stop };
}
