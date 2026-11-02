'use client';

import { useState } from 'react';
import { dateInZone } from '../rules';
import type { Program } from '../types';

interface ImportResponse {
  created: boolean;
  counts: { sessions: number; entries: number; sets: number; checkins: number; measurements: number };
  warnings: { week: number; message: string }[];
}

/** Shown before the first run: start fresh, or bring the old log over. */
export default function StartPanel({ program, onStarted }: { program: Program; onStarted: () => void }) {
  return (
    <div className="space-y-4">
      <section className="panel rounded-2xl p-4">
        <div className="label mb-2">{program.name}</div>
        <p className="text-[14px] leading-relaxed text-muted">
          {program.weeks} weeks, three sessions a week alternating workouts A and B. Pick the day you start (or
          started); the log opens on the right week from then on.
        </p>
        <StartForm onStarted={onStarted} label="Start program" />
      </section>
      <ImportForm onImported={onStarted} />
    </div>
  );
}

export function StartForm({ onStarted, label }: { onStarted: () => void; label: string }) {
  const [date, setDate] = useState(() => dateInZone());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/training/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not start (${res.status})`);
      onStarted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Start date"
          className="mono focus-ring h-12 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-[14px] text-ink outline-none"
        />
        <button
          type="button"
          onClick={start}
          disabled={busy || !date}
          className="h-12 shrink-0 rounded-lg bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Starting…' : label}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-rose">{error}</p>}
    </div>
  );
}

export function ImportForm({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(text);
        // localStorage exports are sometimes a JSON string of JSON
        if (typeof body === 'string') body = JSON.parse(body);
      } catch {
        throw new Error('That is not valid JSON. Paste the export exactly as copied.');
      }
      const res = await fetch('/api/training/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="panel rounded-2xl p-4">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between">
        <span className="label">Import from the old log</span>
        <span className="text-[12px] text-faint">Paste JSON</span>
      </summary>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Paste the account export (<span className="mono">[{'{'} id, data {'}'}, …]</span>) or the browser copy from{' '}
        <span className="mono">localStorage.sbl</span>. To merge both, paste{' '}
        <span className="mono">{'{'} &quot;account&quot;: …, &quot;local&quot;: … {'}'}</span>. Safe to run again.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        aria-label="Old log JSON"
        placeholder='[{"id":"meta","data":{"start":"2026-10-20"}}, {"id":"w01","data":{…}}]'
        className="mono focus-ring mt-3 w-full rounded-lg border border-line bg-raised p-3 text-[12px] text-ink outline-none placeholder:text-faint"
      />
      <button
        type="button"
        onClick={run}
        disabled={busy || !text.trim()}
        className="mt-2 h-12 w-full rounded-lg border border-accent/50 bg-accent-soft text-[14px] font-semibold text-accent disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Import'}
      </button>
      {error && <p className="mt-2 text-[12px] text-rose">{error}</p>}
      {result && (
        <div className="mt-3 rounded-xl border border-green/40 bg-green/10 p-3 text-[13px]">
          <p className="text-green">
            Imported {result.counts.sets} sets in {result.counts.sessions} sessions, {result.counts.checkins} check-ins
            and {result.counts.measurements} measurement weeks
            {result.created ? ' into a new run' : ''}.
          </p>
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px] text-amber">
              {result.warnings.map((w, i) => (
                <li key={i}>
                  Week {w.week}: {w.message}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onImported}
            className="mt-3 h-11 w-full rounded-lg bg-accent text-[14px] font-semibold text-white"
          >
            Open the log
          </button>
        </div>
      )}
    </details>
  );
}
