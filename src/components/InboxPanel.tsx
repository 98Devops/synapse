'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { INTENTS, type Intent, type Note, type Space } from '@/lib/types';

const INTENT_COLOR: Record<string, string> = {
  task: 'var(--amber)',
  decision: 'var(--accent)',
  idea: 'var(--cyan)',
  question: 'var(--rose)',
  observation: 'var(--muted)',
  reflection: 'var(--rose)',
  reference: 'var(--muted)',
  log: 'var(--muted)',
  unclassified: 'var(--faint)',
};

interface Props {
  notes: Note[];
  spaces: Space[];
  onSelect: (id: string) => void;
  onFiled: () => void;
}

/**
 * Everything the classifier wasn't confident about, with the reason it gave.
 * This is the answer to "where does a note live before it's classified" —
 * nothing is auto-filed silently, and nothing is thrown away.
 */
export default function InboxPanel({ notes, spaces, onSelect, onFiled }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function file(noteId: string, patch: { intent?: Intent; spaceName?: string }) {
    setBusy(noteId);
    try {
      await fetch(`/api/notes/${noteId}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      onFiled();
    } finally {
      setBusy(null);
      setOpen(null);
    }
  }

  if (notes.length === 0) {
    return (
      <p className="py-8 text-center text-[12px] leading-relaxed text-muted">
        Inbox is clear. Everything the classifier was confident about has been filed.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        These weren&apos;t confident enough to file automatically. Confirm or correct — your
        choices teach the classifier.
      </p>

      {notes.map((n, i) => (
        <motion.div
          key={n.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className="rounded-xl border border-amber/30 bg-bg/40 p-3"
        >
          <button onClick={() => onSelect(n.id)} className="block w-full text-left">
            <div className="mb-1 flex items-center gap-2">
              <span
                className="mono rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                style={{ color: INTENT_COLOR[n.intent], background: 'var(--accent-soft)' }}
              >
                {n.intent}
              </span>
              <span className="mono text-[9px] text-faint">
                {Math.round(n.intentConfidence * 100)}% confident
              </span>
            </div>
            <div className="text-[13px] font-medium leading-snug text-ink">{n.title}</div>
            {n.unclassifiedReason && (
              <div className="mt-1 text-[11px] leading-relaxed text-amber">
                {n.unclassifiedReason}
              </div>
            )}
          </button>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => file(n.id, { intent: n.intent as Intent })}
              disabled={busy === n.id || n.intent === 'unclassified'}
              className="rounded-lg bg-green/15 px-2 py-1 text-[11px] text-green transition hover:bg-green/25 disabled:opacity-30"
            >
              {busy === n.id ? 'Filing…' : 'Confirm'}
            </button>

            <button
              onClick={() => setOpen(open === n.id ? null : n.id)}
              className="hoverable rounded-lg border border-line px-2 py-1 text-[11px] text-muted"
            >
              Reclassify
            </button>
          </div>

          <AnimatePresence>
            {open === n.id && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2.5 border-t border-line pt-2.5">
                  <div className="label mb-1.5">Intent</div>
                  <div className="mb-3 flex flex-wrap gap-1">
                    {INTENTS.filter((x) => x !== 'unclassified').map((intent) => (
                      <button
                        key={intent}
                        onClick={() => file(n.id, { intent })}
                        className="mono rounded-md border border-line px-1.5 py-0.5 text-[10px] transition hover:border-accent"
                        style={{ color: INTENT_COLOR[intent] }}
                      >
                        {intent}
                      </button>
                    ))}
                  </div>

                  {spaces.length > 0 && (
                    <>
                      <div className="label mb-1.5">Space</div>
                      <div className="flex flex-wrap gap-1">
                        {spaces.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => file(n.id, { spaceName: s.name })}
                            className="hoverable rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted"
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  );
}
