'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Insight } from '@/lib/insights';
import type { Note, Space } from '@/lib/types';
import type { GraphData } from '@/lib/types';

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
  graph: GraphData;
  insight: Insight;
  onSelect: (id: string) => void;
  onToggleAction: (noteId: string, item: string, done: boolean) => void;
}

/**
 * The "what's going on" view. The graph shows structure; this shows state —
 * what's due, what's unanswered, what's waiting on you.
 */
export default function Dashboard({
  notes,
  spaces,
  graph,
  insight,
  onSelect,
  onToggleAction,
}: Props) {
  const inbox = notes.filter((n) => n.status === 'needs_review');

  const openQuestions = useMemo(
    () => notes.flatMap((n) => n.questions.map((q) => ({ note: n, text: q }))),
    [notes]
  );

  const overdue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return insight.openActions.filter(({ note, item }) => {
      const a = note.actions?.find((x) => x.text === item);
      return a?.dueDate && a.dueDate <= today;
    });
  }, [insight.openActions]);

  const recent = notes.slice(0, 6);

  return (
    // Left padding clears the capture/agent rail, which stays available here.
    <div className="h-full overflow-y-auto px-5 pb-24 pt-[136px] lg:pb-8 lg:pl-[358px]">
      <div className="mx-auto grid max-w-[1100px] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* ---- headline numbers ---- */}
        <Card className="md:col-span-2 xl:col-span-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Metric label="notes" value={graph.stats.notes} tone="text-accent" />
            <Metric label="entities" value={graph.stats.entities} tone="text-cyan" />
            <Metric label="connections" value={graph.stats.connections} tone="text-rose" />
            <Metric label="open actions" value={insight.openActions.length} tone="text-amber" />
            <Metric label="needs review" value={inbox.length} tone={inbox.length ? 'text-amber' : 'text-muted'} />
          </div>
        </Card>

        {/* ---- actions ---- */}
        <Card>
          <Header
            title="Open actions"
            hint={overdue.length ? `${overdue.length} due or overdue` : undefined}
          />
          {insight.openActions.length === 0 ? (
            <Empty>Nothing outstanding.</Empty>
          ) : (
            <div className="space-y-1.5">
              {insight.openActions.slice(0, 8).map(({ note, item }) => {
                const meta = note.actions?.find((a) => a.text === item);
                const due = meta?.dueDate;
                const isOverdue = due && due <= new Date().toISOString().slice(0, 10);
                return (
                  <div key={`${note.id}:${item}`} className="flex items-start gap-2.5">
                    <button
                      onClick={() => onToggleAction(note.id, item, true)}
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded border border-muted/50 transition hover:border-green hover:bg-green/20"
                      aria-label="Mark done"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] leading-snug text-ink/90">{item}</div>
                      <button
                        onClick={() => onSelect(note.id)}
                        className="mono truncate text-[10px] text-muted transition hover:text-accent"
                      >
                        {note.title}
                        {due && (
                          <span className={isOverdue ? ' text-rose' : ' text-amber'}>
                            {' · '}
                            {new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ---- open questions ---- */}
        <Card>
          <Header title="Unresolved" />
          {openQuestions.length === 0 ? (
            <Empty>No open questions.</Empty>
          ) : (
            <div className="space-y-2">
              {openQuestions.slice(0, 6).map(({ note, text }) => (
                <button
                  key={`${note.id}:${text}`}
                  onClick={() => onSelect(note.id)}
                  className="block w-full text-left"
                >
                  <div className="text-[12.5px] leading-snug text-ink/90">{text}</div>
                  <div className="mono truncate text-[10px] text-muted">{note.title}</div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* ---- inbox ---- */}
        <Card>
          <Header title="Needs review" hint={inbox.length ? undefined : 'all clear'} />
          {inbox.length === 0 ? (
            <Empty>Everything has been classified.</Empty>
          ) : (
            <div className="space-y-2">
              {inbox.slice(0, 6).map((n) => (
                <button key={n.id} onClick={() => onSelect(n.id)} className="block w-full text-left">
                  <div className="text-[12.5px] leading-snug text-ink/90">{n.title}</div>
                  <div className="text-[10px] leading-tight text-amber">{n.unclassifiedReason}</div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* ---- spaces ---- */}
        <Card>
          <Header title="Spaces" />
          {spaces.length === 0 ? (
            <Empty>Spaces appear as notes cluster into areas.</Empty>
          ) : (
            <div className="space-y-1.5">
              {spaces.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1 truncate text-[12.5px] text-ink/90">{s.name}</span>
                  <span className="mono text-[10px] text-muted">{s.noteCount}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---- activity ---- */}
        <Card>
          <Header title="Last 14 days" />
          <div className="flex h-16 items-end gap-[3px]">
            {insight.activity.map((v, i) => (
              <motion.div
                key={i}
                initial={{ height: 2 }}
                animate={{ height: `${Math.max(6, (v / Math.max(1, ...insight.activity)) * 100)}%` }}
                transition={{ delay: i * 0.02, type: 'spring', stiffness: 260, damping: 24 }}
                className={`flex-1 rounded-sm ${v > 0 ? 'bg-accent' : 'bg-line'}`}
                title={`${v} note${v === 1 ? '' : 's'}`}
              />
            ))}
          </div>
        </Card>

        {/* ---- recent ---- */}
        <Card>
          <Header title="Recent" />
          {recent.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <div className="space-y-2">
              {recent.map((n) => (
                <button key={n.id} onClick={() => onSelect(n.id)} className="block w-full text-left">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="mono text-[9px] uppercase tracking-wider"
                      style={{ color: INTENT_COLOR[n.intent] }}
                    >
                      {n.intent}
                    </span>
                    <span className="mono text-[9px] text-faint">
                      {new Date(n.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="truncate text-[12.5px] text-ink/90">{n.title}</div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`panel rounded-2xl p-4 ${className}`}
    >
      {children}
    </motion.div>
  );
}

function Header({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="label">{title}</span>
      {hint && <span className="mono text-[10px] text-amber">{hint}</span>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className={`text-[24px] font-bold leading-none ${tone}`}>{value}</div>
      <div className="label mt-1.5">{label}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-[12px] leading-relaxed text-muted">{children}</p>;
}
