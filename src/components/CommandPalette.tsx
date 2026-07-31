'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Cluster } from '@/lib/cluster';
import type { GraphNode } from '@/lib/types';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  color?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  clusters: Cluster[];
  actions: Command[];
  onSelectNode: (id: string) => void;
}

/** Subsequence match — "pjatl" finds "Project Atlas". Returns a score or -1. */
function fuzzy(needle: string, hay: string): number {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h.includes(n)) return 1000 - h.indexOf(n);

  let hi = 0;
  let score = 0;
  let streak = 0;
  for (const ch of n) {
    const found = h.indexOf(ch, hi);
    if (found === -1) return -1;
    streak = found === hi ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - hi, 10);
    hi = found + 1;
  }
  return score;
}

export default function CommandPalette({
  open,
  onClose,
  nodes,
  clusters,
  actions,
  onSelectNode,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo(() => {
    const all: Command[] = [
      ...actions,
      ...clusters.map((c) => ({
        id: `cluster:${c.id}`,
        label: c.name,
        hint: `${c.noteIds.length} notes`,
        group: 'Themes',
        color: c.color,
        run: () => c.noteIds[0] && onSelectNode(c.noteIds[0]),
      })),
      ...nodes.map((n) => ({
        id: n.id,
        label: n.label,
        hint: n.kind === 'note' ? 'note' : n.variant,
        group: n.kind === 'note' ? 'Notes' : 'Entities',
        run: () => onSelectNode(n.id),
      })),
    ];

    if (!query.trim()) return all.slice(0, 40);

    return all
      .map((c) => ({ c, s: fuzzy(query.trim(), c.label) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [query, actions, clusters, nodes, onSelectNode]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, items.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[cursor];
        if (it) {
          it.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, cursor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup = '';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="panel fixed left-1/2 top-[15vh] z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-3 border-b border-line/70 px-4 py-3.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to anything, or run a command…"
                className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted/70"
              />
              <kbd className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 && (
                <div className="px-3 py-8 text-center text-[13px] text-muted">
                  Nothing matches “{query}”.
                </div>
              )}
              {items.map((it, i) => {
                const showGroup = it.group !== lastGroup;
                lastGroup = it.group;
                return (
                  <div key={it.id}>
                    {showGroup && (
                      <div className="mono px-3 pb-1 pt-3 text-[9px] uppercase tracking-[0.18em] text-muted/60">
                        {it.group}
                      </div>
                    )}
                    <button
                      data-active={i === cursor}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => {
                        it.run();
                        onClose();
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                        i === cursor ? 'bg-accent/20' : 'hover:bg-white/5'
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: it.color ?? (i === cursor ? '#818cf8' : '#3a4368') }}
                      />
                      <span className="flex-1 truncate text-[13px] text-ink">{it.label}</span>
                      {it.hint && <span className="mono shrink-0 text-[10px] text-muted">{it.hint}</span>}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mono flex items-center gap-3 border-t border-line/70 px-4 py-2 text-[10px] text-muted/70">
              <span>↑↓ navigate</span>
              <span>⏎ open</span>
              <span className="ml-auto">{items.length} results</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
