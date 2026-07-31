'use client';

import { motion } from 'framer-motion';
import type { GraphControls } from '@/components/GraphCanvas';

interface Props {
  controls: React.MutableRefObject<GraphControls | null>;
  zoom: number;
  /** How many nodes the lens is currently hiding — surfaced so filters explain themselves. */
  hidden: number;
  total: number;
}

export default function GraphToolbar({ controls, zoom, hidden, total }: Props) {
  const pct = Math.round(zoom * 100);
  const zoomedIn = zoom > 1.35;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.25 }}
      className="pointer-events-auto flex items-center gap-1 rounded-xl border border-line bg-surface px-1.5 py-1.5 backdrop-blur-xl"
      style={{ boxShadow: 'var(--shadow)' }}
    >
      <IconButton label="Zoom out" onClick={() => controls.current?.zoomBy(1 / 1.35)}>
        <path d="M5 12h14" strokeLinecap="round" />
      </IconButton>

      <button
        onClick={() => controls.current?.reset()}
        title="Reset zoom to 100%"
        className="mono min-w-[52px] rounded-lg px-1.5 py-1 text-[11px] tabular-nums text-muted transition hover:bg-accent-soft hover:text-ink"
      >
        {pct}%
      </button>

      <IconButton label="Zoom in" onClick={() => controls.current?.zoomBy(1.35)}>
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </IconButton>

      <div className="mx-0.5 h-5 w-px bg-line" />

      {/* The escape hatch: always frames the whole graph. */}
      <button
        onClick={() => controls.current?.fit()}
        title="Fit entire graph to view"
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
          zoomedIn ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-accent-soft hover:text-ink'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" strokeLinecap="round" />
        </svg>
        Fit
      </button>

      {hidden > 0 && (
        <>
          <div className="mx-0.5 h-5 w-px bg-line" />
          <span
            className="mono rounded-lg bg-amber/15 px-2 py-1 text-[10px] text-amber"
            title={`The lens filter is hiding ${hidden} of ${total} nodes. Clear filters to see everything.`}
          >
            {hidden} hidden
          </span>
        </>
      )}
    </motion.div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-muted transition hover:bg-accent-soft hover:text-ink"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        {children}
      </svg>
    </button>
  );
}
