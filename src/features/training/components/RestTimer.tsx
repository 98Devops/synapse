'use client';

import { useEffect, useRef, useState } from 'react';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Rest between supersets. Counts against a wall-clock end time so it stays
 * right when the phone sleeps; vibrates at zero.
 */
export default function RestTimer({ seconds = 150 }: { seconds?: number }) {
  const [length, setLength] = useState(seconds);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [left, setLeft] = useState(seconds);
  const [finished, setFinished] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (endAt === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0 && !fired.current) {
        fired.current = true;
        setEndAt(null);
        setFinished(true);
        try {
          navigator.vibrate?.([300, 150, 300]);
        } catch {
          /* not supported */
        }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endAt]);

  const start = () => {
    fired.current = false;
    setFinished(false);
    setLeft(length);
    setEndAt(Date.now() + length * 1000);
  };
  const stop = () => {
    setEndAt(null);
    setFinished(false);
    setLeft(length);
  };
  const adjust = (d: number) => {
    const next = Math.min(600, Math.max(30, length + d));
    setLength(next);
    if (endAt === null) setLeft(next);
  };

  const running = endAt !== null;

  return (
    <div className="flex items-center gap-1">
      {!running && (
        <button
          type="button"
          onClick={() => adjust(-30)}
          aria-label="30 seconds less rest"
          className="mono h-11 w-8 rounded-lg text-[13px] text-muted hover:text-ink"
        >
          −
        </button>
      )}
      <button
        type="button"
        onClick={running ? stop : start}
        aria-label={running ? 'Stop rest timer' : `Start ${fmt(length)} rest timer`}
        className={`mono h-11 min-w-[88px] rounded-lg border px-2 text-[13px] transition ${
          running
            ? 'border-cyan/50 bg-cyan/10 text-cyan'
            : finished
              ? 'border-green/50 bg-green/10 text-green'
              : 'border-line text-muted hover:text-ink'
        }`}
      >
        {running ? `${fmt(left)} · stop` : finished ? 'Go · next set' : `Rest ${fmt(length)}`}
      </button>
      {!running && (
        <button
          type="button"
          onClick={() => adjust(30)}
          aria-label="30 seconds more rest"
          className="mono h-11 w-8 rounded-lg text-[13px] text-muted hover:text-ink"
        >
          +
        </button>
      )}
    </div>
  );
}
