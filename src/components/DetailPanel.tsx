'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { GraphNode, Note } from '@/lib/types';

const VARIANT_COLOR: Record<string, string> = {
  positive: '#34d399',
  neutral: '#6366f1',
  negative: '#f472b6',
  urgent: '#fbbf24',
  person: '#22d3ee',
  project: '#a78bfa',
  org: '#f472b6',
  concept: '#818cf8',
  place: '#34d399',
  tool: '#fbbf24',
};

interface Props {
  node: GraphNode | null;
  notes: Note[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function DetailPanel({ node, notes, onClose, onSelect, onDelete }: Props) {
  const note = node?.kind === 'note' ? notes.find((n) => n.id === node.id) ?? null : null;

  // For an entity node, find every note that mentions it.
  const related =
    node?.kind === 'entity'
      ? notes.filter((n) =>
          (n.entities || []).some(
            (e) =>
              `entity:${e.type}:${e.name.trim().toLowerCase().replace(/\s+/g, '-')}` === node.id
          )
        )
      : [];

  const accent = node ? VARIANT_COLOR[node.variant] ?? '#6366f1' : '#6366f1';

  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="panel pointer-events-auto absolute right-4 top-4 bottom-4 z-20 flex w-[340px] flex-col overflow-hidden rounded-2xl"
        >
          <div className="h-[3px] w-full shrink-0" style={{ background: accent }} />

          <div className="flex items-start justify-between gap-3 p-5 pb-3">
            <div className="min-w-0">
              <div className="mono mb-1 text-[10px] uppercase tracking-[0.18em]" style={{ color: accent }}>
                {node.kind === 'note' ? note?.sentiment ?? 'note' : node.variant}
              </div>
              <h2 className="text-[17px] font-semibold leading-snug text-ink">{node.label}</h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-ink"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {note && (
              <>
                {note.summary && (
                  <p className="mb-4 text-[13px] leading-relaxed text-muted">{note.summary}</p>
                )}

                <Section label="Transcript">
                  <p className="rounded-xl border border-line/60 bg-bg/50 p-3 text-[13px] leading-relaxed text-ink/85">
                    {note.text}
                  </p>
                </Section>

                {note.actionItems.length > 0 && (
                  <Section label="Action items">
                    <ul className="space-y-1.5">
                      {note.actionItems.map((a, i) => (
                        <li key={i} className="flex gap-2 text-[13px] text-ink/85">
                          <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                          {a}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {note.entities.length > 0 && (
                  <Section label="Entities">
                    <div className="flex flex-wrap gap-1.5">
                      {note.entities.map((e) => (
                        <button
                          key={`${e.type}:${e.name}`}
                          onClick={() =>
                            onSelect(
                              `entity:${e.type}:${e.name.trim().toLowerCase().replace(/\s+/g, '-')}`
                            )
                          }
                          className="hoverable rounded-full border border-line/70 px-2.5 py-1 text-[11px]"
                          style={{ color: VARIANT_COLOR[e.type] }}
                        >
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </Section>
                )}

                {note.tags.length > 0 && (
                  <Section label="Tags">
                    <div className="flex flex-wrap gap-1.5">
                      {note.tags.map((t) => (
                        <span key={t} className="mono rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </Section>
                )}

                <div className="mono mt-5 flex items-center justify-between border-t border-line/60 pt-3 text-[10px] text-muted/70">
                  <span>{new Date(note.createdAt).toLocaleString()}</span>
                  <button
                    onClick={() => onDelete(note.id)}
                    className="rounded px-1.5 py-0.5 text-muted/70 transition hover:bg-rose/10 hover:text-rose"
                  >
                    delete
                  </button>
                </div>
              </>
            )}

            {node.kind === 'entity' && (
              <>
                <p className="mb-4 text-[13px] text-muted">
                  Appears in {related.length} note{related.length === 1 ? '' : 's'}. This is a
                  junction in your graph.
                </p>
                <Section label="Mentioned in">
                  <div className="space-y-1.5">
                    {related.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => onSelect(n.id)}
                        className="hoverable w-full rounded-xl border border-line/60 p-3 text-left"
                      >
                        <div className="mb-1 text-[13px] font-medium text-ink">{n.title}</div>
                        <div className="line-clamp-2 text-[12px] leading-relaxed text-muted">
                          {n.summary || n.text}
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mono mb-2 text-[10px] uppercase tracking-[0.18em] text-muted/70">{label}</div>
      {children}
    </div>
  );
}
