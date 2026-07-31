'use client';

import { motion } from 'framer-motion';

export type LayoutMode = 'constellation' | 'timeline' | 'radial';

export interface Lens {
  query: string;
  sentiments: string[];
  entityTypes: string[];
  days: number | null;
  layout: LayoutMode;
  showClusters: boolean;
  showEntities: boolean;
}

export const DEFAULT_LENS: Lens = {
  query: '',
  sentiments: [],
  entityTypes: [],
  days: null,
  layout: 'constellation',
  showClusters: true,
  showEntities: true,
};

const SENTIMENTS = [
  ['positive', '#34d399'],
  ['neutral', '#6366f1'],
  ['negative', '#f472b6'],
  ['urgent', '#fbbf24'],
] as const;

const ENTITY_TYPES = [
  ['person', '#22d3ee'],
  ['project', '#a78bfa'],
  ['org', '#f472b6'],
  ['tool', '#fbbf24'],
  ['concept', '#818cf8'],
  ['place', '#34d399'],
] as const;

const LAYOUTS: Array<[LayoutMode, string]> = [
  ['constellation', 'Constellation'],
  ['timeline', 'Timeline'],
  ['radial', 'Radial'],
];

interface Props {
  lens: Lens;
  onChange: (next: Lens) => void;
  matchCount: number;
  /** Live counts per facet, so a filter that would hide everything says so. */
  counts?: { sentiments: Record<string, number>; entityTypes: Record<string, number> };
}

export default function LensBar({ lens, onChange, matchCount, counts }: Props) {
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const active =
    lens.query ||
    lens.sentiments.length ||
    lens.entityTypes.length ||
    lens.days !== null ||
    !lens.showEntities;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="panel pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
    >
      {/* search */}
      <div className="relative">
        <input
          value={lens.query}
          onChange={(e) => onChange({ ...lens, query: e.target.value })}
          placeholder="Filter graph…"
          className="w-[150px] rounded-lg border border-line/70 bg-bg/60 py-1 pl-7 pr-2 text-[12px] outline-none transition placeholder:text-muted/60 focus:border-accent/70 focus:w-[200px]"
        />
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
      </div>

      <Divider />

      {/* sentiment dots */}
      <div className="flex items-center gap-1">
        {SENTIMENTS.map(([s, c]) => {
          const on = lens.sentiments.includes(s);
          const n = counts?.sentiments[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => onChange({ ...lens, sentiments: toggle(lens.sentiments, s) })}
              title={`${s} — ${n} note${n === 1 ? '' : 's'}${n === 0 ? ' (nothing to show)' : ''}`}
              disabled={n === 0}
              className={`h-4 w-4 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-20 ${
                on ? 'scale-110' : 'opacity-45 hover:opacity-80'
              }`}
              style={{ background: on ? c : 'transparent', borderColor: c }}
            />
          );
        })}
      </div>

      <Divider />

      {/* entity type chips */}
      <div className="flex items-center gap-1">
        {ENTITY_TYPES.map(([t, c]) => {
          const on = lens.entityTypes.includes(t);
          const n = counts?.entityTypes[t] ?? 0;
          return (
            <button
              key={t}
              onClick={() => onChange({ ...lens, entityTypes: toggle(lens.entityTypes, t) })}
              disabled={n === 0}
              title={`${t} — ${n} in your graph${n === 0 ? ' (nothing to show)' : ''}`}
              className="mono rounded-md border px-1.5 py-0.5 text-[9px] uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-25"
              style={{
                borderColor: on ? c : 'var(--line)',
                color: on ? c : 'var(--muted)',
                background: on ? `${c}1f` : 'transparent',
              }}
            >
              {t}
              {n > 0 && <span className="ml-1 opacity-60">{n}</span>}
            </button>
          );
        })}
      </div>

      <Divider />

      {/* time window */}
      <div className="flex items-center gap-1">
        {[
          [7, '7d'],
          [30, '30d'],
          [null, 'All'],
        ].map(([d, label]) => (
          <button
            key={String(label)}
            onClick={() => onChange({ ...lens, days: d as number | null })}
            className={`mono rounded-md px-1.5 py-0.5 text-[10px] transition ${
              lens.days === d ? 'bg-accent/25 text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {label as string}
          </button>
        ))}
      </div>

      <Divider />

      {/* layout switch */}
      <div className="flex items-center gap-0.5 rounded-lg bg-bg/50 p-0.5">
        {LAYOUTS.map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onChange({ ...lens, layout: mode })}
            className={`relative rounded-md px-2 py-1 text-[10px] transition ${
              lens.layout === mode ? 'text-ink' : 'text-muted hover:text-ink/80'
            }`}
          >
            {lens.layout === mode && (
              <motion.span
                layoutId="layout-pill"
                className="absolute inset-0 rounded-md bg-accent/25"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <Divider />

      <Toggle
        on={lens.showEntities}
        onClick={() => onChange({ ...lens, showEntities: !lens.showEntities })}
        label="Entities"
      />
      <Toggle
        on={lens.showClusters}
        onClick={() => onChange({ ...lens, showClusters: !lens.showClusters })}
        label="Themes"
      />

      {active && (
        <>
          <Divider />
          <span
            className={`mono text-[10px] ${matchCount === 0 ? 'text-amber' : 'text-cyan'}`}
            title="Nodes still visible under the current filters"
          >
            {matchCount === 0 ? 'nothing matches' : `${matchCount} shown`}
          </span>
          <button
            onClick={() => onChange({ ...DEFAULT_LENS, layout: lens.layout })}
            className="mono rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted transition hover:border-rose hover:text-rose"
          >
            clear filters
          </button>
        </>
      )}
    </motion.div>
  );
}

function Divider() {
  return <div className="h-4 w-px shrink-0 bg-line" />;
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`mono rounded-md px-1.5 py-0.5 text-[10px] transition ${
        on ? 'text-ink' : 'text-muted/50 line-through'
      }`}
    >
      {label}
    </button>
  );
}
