'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import InboxPanel from '@/components/InboxPanel';
import type { Cluster } from '@/lib/cluster';
import type { Insight } from '@/lib/insights';
import type { Note, Space } from '@/lib/types';

type Tab = 'inbox' | 'pulse' | 'actions' | 'spaces';

const SENTIMENT_COLOR: Record<string, string> = {
  positive: '#34d399',
  neutral: '#6366f1',
  negative: '#f472b6',
  urgent: '#fbbf24',
};

interface Props {
  insight: Insight;
  clusters: Cluster[];
  notes: Note[];
  spaces: Space[];
  onSelect: (id: string) => void;
  onToggleAction: (noteId: string, item: string, done: boolean) => void;
  onFocusCluster: (c: Cluster) => void;
  onFiled: () => void;
}

export default function PulsePanel({
  insight,
  clusters,
  notes,
  spaces,
  onSelect,
  onToggleAction,
  onFocusCluster,
  onFiled,
}: Props) {
  const inbox = notes.filter((n) => n.status === 'needs_review');
  const [tab, setTab] = useState<Tab>(inbox.length > 0 ? 'inbox' : 'pulse');
  const peak = Math.max(1, ...insight.activity);
  const totalSentiment = Object.values(insight.sentimentMix).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex shrink-0 gap-1 border-b border-line/60 p-2">
        {(
          [
            ['inbox', `Inbox${inbox.length ? ` · ${inbox.length}` : ''}`],
            ['pulse', 'Pulse'],
            ['actions', `Actions${insight.openActions.length ? ` · ${insight.openActions.length}` : ''}`],
            ['spaces', 'Spaces'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`mono relative flex-1 rounded-lg px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] transition ${
              tab === key ? 'text-ink' : 'text-muted hover:text-ink/80'
            }`}
          >
            {tab === key && (
              <motion.span
                layoutId="pulse-tab"
                className="absolute inset-0 rounded-lg bg-accent/20"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {tab === 'inbox' && (
            <motion.div
              key="inbox"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              <InboxPanel notes={inbox} spaces={spaces} onSelect={onSelect} onFiled={onFiled} />
            </motion.div>
          )}

          {tab === 'pulse' && (
            <motion.div
              key="pulse"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="space-y-5"
            >
              {/* activity sparkline */}
              <div>
                <Label>Last 14 days</Label>
                <div className="flex h-12 items-end gap-[3px]">
                  {insight.activity.map((v, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 2 }}
                      animate={{ height: `${Math.max(6, (v / peak) * 100)}%` }}
                      transition={{ delay: i * 0.02, type: 'spring', stiffness: 260, damping: 24 }}
                      className={`flex-1 rounded-sm ${v > 0 ? 'bg-accent' : 'bg-line'}`}
                      title={`${v} note${v === 1 ? '' : 's'}`}
                    />
                  ))}
                </div>
              </div>

              {/* sentiment mix */}
              <div>
                <Label>Mood</Label>
                <div className="flex h-2 overflow-hidden rounded-full bg-line">
                  {Object.entries(insight.sentimentMix).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        width: `${(v / totalSentiment) * 100}%`,
                        background: SENTIMENT_COLOR[k] ?? '#6366f1',
                      }}
                    />
                  ))}
                </div>
                <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                  {Object.entries(insight.sentimentMix).map(([k, v]) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: SENTIMENT_COLOR[k] ?? '#6366f1' }}
                      />
                      {k} {v}
                    </span>
                  ))}
                </div>
              </div>

              {/* hubs */}
              <div>
                <Label>Strongest hubs</Label>
                <div className="space-y-1">
                  {insight.hubs.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => onSelect(h.id)}
                      className="hoverable flex w-full items-center gap-2 rounded-lg border border-line/50 px-2.5 py-1.5 text-left"
                    >
                      <span className="flex-1 truncate text-[12px] text-ink/85">{h.label}</span>
                      <span className="mono text-[10px] text-muted">{h.variant}</span>
                      <span className="mono rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                        {h.degree}
                      </span>
                    </button>
                  ))}
                  {insight.hubs.length === 0 && <Empty>No hubs yet.</Empty>}
                </div>
              </div>

              {/* orphans */}
              {insight.orphans.length > 0 && (
                <div>
                  <Label>Unconnected</Label>
                  <p className="mb-2 text-[11px] leading-relaxed text-muted">
                    Nothing links these to the rest of your brain yet.
                  </p>
                  <div className="space-y-1">
                    {insight.orphans.slice(0, 4).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => onSelect(n.id)}
                        className="hoverable w-full truncate rounded-lg border border-amber/30 px-2.5 py-1.5 text-left text-[12px] text-ink/85"
                      >
                        {n.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {tab === 'actions' && (
            <motion.div
              key="actions"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              {insight.openActions.length === 0 && insight.doneCount === 0 && (
                <Empty>No action items yet. Say something you need to do.</Empty>
              )}

              <div className="space-y-1.5">
                {insight.openActions.map(({ note, item }, i) => (
                  <motion.div
                    key={`${note.id}:${item}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="hoverable group flex items-start gap-2.5 rounded-lg border border-line/50 px-2.5 py-2"
                  >
                    <button
                      onClick={() => onToggleAction(note.id, item, true)}
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded border border-muted/50 transition hover:border-green hover:bg-green/20"
                      aria-label="Mark done"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] leading-snug text-ink/90">{item}</div>
                      <button
                        onClick={() => onSelect(note.id)}
                        className="mono mt-0.5 truncate text-[10px] text-muted transition hover:text-cyan"
                      >
                        {note.title}
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>

              {insight.doneCount > 0 && (
                <div className="mono mt-4 border-t border-line/60 pt-3 text-[10px] text-green">
                  ✓ {insight.doneCount} completed
                </div>
              )}
            </motion.div>
          )}

          {tab === 'spaces' && (
            <motion.div
              key="spaces"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="space-y-2"
            >
              {spaces.length > 0 && (
                <div className="mb-4">
                  <Label>Spaces</Label>
                  <div className="space-y-1">
                    {spaces.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: s.color }}
                        />
                        <span className="flex-1 truncate text-[12px] text-ink/85">{s.name}</span>
                        <span className="mono text-[10px] text-muted">{s.noteCount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Label>Auto-detected themes</Label>
              {clusters.length === 0 && (
                <Empty>Themes appear once your notes start clustering. Add a few more.</Empty>
              )}
              {clusters.map((c, i) => (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => onFocusCluster(c)}
                  className="hoverable relative w-full overflow-hidden rounded-xl border border-line/50 p-3 text-left"
                >
                  <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: c.color }} />
                  <div className="mb-1 text-[13px] font-semibold text-ink">{c.name}</div>
                  <div className="mono text-[10px] text-muted">
                    {c.noteIds.length} notes · {c.nodeIds.length - c.noteIds.length} entities
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono mb-2 text-[9px] uppercase tracking-[0.18em] text-muted/70">{children}</div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[12px] leading-relaxed text-muted">{children}</p>;
}
