'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import GraphCanvas, { type GraphControls } from '@/components/GraphCanvas';
import GraphToolbar from '@/components/GraphToolbar';
import CapturePanel from '@/components/CapturePanel';
import AgentPanel from '@/components/AgentPanel';
import DetailPanel from '@/components/DetailPanel';
import PulsePanel from '@/components/PulsePanel';
import CommandPalette, { type Command } from '@/components/CommandPalette';
import Dashboard from '@/components/Dashboard';
import LensBar, { DEFAULT_LENS, type Lens } from '@/components/LensBar';
import { computeInsights } from '@/lib/insights';
import { useTheme } from '@/lib/useTheme';
import Link from 'next/link';
import { canInstall, promptInstall } from '@/components/PwaRegister';
import type { Cluster } from '@/lib/cluster';
import type { GraphData, Note, Space } from '@/lib/types';

const EMPTY: GraphData = {
  nodes: [],
  edges: [],
  stats: { notes: 0, entities: 0, connections: 0, density: 0 },
};

/** Last-known state, so the app paints instantly on open (and offline). Cleared on sign-out. */
const CACHE_KEY = 'synapse:cache:v1';

interface CachedBrain {
  graph?: GraphData;
  notes?: Note[];
  spaces?: Space[];
  clusters?: Cluster[];
}

function readCache(): CachedBrain | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function writeCache(patch: CachedBrain) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...patch }));
  } catch {
    // quota or private mode — the cache is an optimisation, never a requirement
  }
}

function clearLocalData() {
  try {
    for (const key of Object.keys(localStorage)) {
      // Theme ('synapse-theme') is a device preference and survives sign-out.
      if (key.startsWith('synapse:') || key.startsWith('synapse-training:')) localStorage.removeItem(key);
    }
  } catch {}
}

/** 'home' = no sheet open; the header switch decides graph vs dashboard. */
type MobileTab = 'home' | 'capture' | 'agent' | 'pulse';
type View = 'graph' | 'dashboard';

export default function Home() {
  const [graph, setGraph] = useState<GraphData>(EMPTY);
  const [notes, setNotes] = useState<Note[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [lens, setLens] = useState<Lens>(DEFAULT_LENS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<View>('graph');
  const [installable, setInstallable] = useState(false);
  const graphControls = useRef<GraphControls | null>(null);
  const { isDark, toggle } = useTheme();

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user?.email && setEmail(d.user.email))
      .catch(() => {});

    // Phones open on the dashboard (the graph is a big-screen view), and the
    // PWA shortcuts can deep-link straight into a sheet.
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'capture' || tab === 'agent' || tab === 'pulse') setMobileTab(tab);
    if (window.matchMedia('(max-width: 1023px)').matches) setView('dashboard');

    const onInstallable = () => setInstallable(canInstall());
    onInstallable();
    window.addEventListener('synapse:installable', onInstallable);
    return () => window.removeEventListener('synapse:installable', onInstallable);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [g, n, s] = await Promise.all([
        fetch('/api/graph').then((r) => r.json()),
        fetch('/api/notes').then((r) => r.json()),
        fetch('/api/spaces').then((r) => r.json()),
      ]);
      if (g.error) throw new Error(g.error);
      if (n.error) throw new Error(n.error);
      setGraph(g);
      setNotes(n.notes ?? []);
      setSpaces(s.spaces ?? []);
      setError(null);
      writeCache({ graph: g, notes: n.notes ?? [], spaces: s.spaces ?? [] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    fetch('/api/clusters')
      .then((r) => r.json())
      .then((c) => {
        if (c.error) return;
        setClusters(c.clusters ?? []);
        writeCache({ clusters: c.clusters ?? [] });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Paint the last known brain immediately, then reconcile with the server.
    const cached = readCache();
    if (cached?.notes) {
      setGraph(cached.graph ?? EMPTY);
      setNotes(cached.notes);
      setSpaces(cached.spaces ?? []);
      setClusters(cached.clusters ?? []);
      setLoading(false);
    }
    refresh();
  }, [refresh]);

  const insight = useMemo(() => computeInsights(graph, notes), [graph, notes]);

  // Facet counts so each filter can say what it would actually do.
  const lensCounts = useMemo(() => {
    const sentiments: Record<string, number> = {};
    for (const n of notes) sentiments[n.sentiment] = (sentiments[n.sentiment] ?? 0) + 1;
    const entityTypes: Record<string, number> = {};
    for (const n of graph.nodes) {
      if (n.kind === 'entity') entityTypes[n.variant] = (entityTypes[n.variant] ?? 0) + 1;
    }
    return { sentiments, entityTypes };
  }, [notes, graph.nodes]);

  const visibleIds = useMemo(() => {
    const q = lens.query.trim().toLowerCase();
    const filtering =
      q || lens.sentiments.length || lens.entityTypes.length || lens.days !== null || !lens.showEntities;
    if (!filtering) return null;

    const cutoff = lens.days ? Date.now() - lens.days * 86_400_000 : null;
    const visibleNotes = new Set<string>();

    for (const n of notes) {
      if (lens.sentiments.length && !lens.sentiments.includes(n.sentiment)) continue;
      if (cutoff && new Date(n.createdAt).getTime() < cutoff) continue;
      if (
        q &&
        !`${n.title} ${n.text} ${n.tags.join(' ')} ${n.entities.map((e) => e.name).join(' ')}`
          .toLowerCase()
          .includes(q)
      )
        continue;
      visibleNotes.add(n.id);
    }

    const out = new Set(visibleNotes);
    if (lens.showEntities) {
      const entityNotes = new Map<string, string[]>();
      for (const e of graph.edges) {
        if (e.kind !== 'mentions') continue;
        if (!entityNotes.has(e.target)) entityNotes.set(e.target, []);
        entityNotes.get(e.target)!.push(e.source);
      }
      for (const node of graph.nodes) {
        if (node.kind !== 'entity') continue;
        if (lens.entityTypes.length && !lens.entityTypes.includes(node.variant)) continue;
        const attached = entityNotes.get(node.id) ?? [];
        if (!attached.some((id) => visibleNotes.has(id))) continue;
        out.add(node.id);
      }
    }
    return out;
  }, [lens, notes, graph]);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setSelectedId(null);
      await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      refresh();
    },
    [refresh]
  );

  const handleToggleAction = useCallback(
    async (noteId: string, item: string, done: boolean) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== noteId) return n;
          const set = new Set(n.completedActions ?? []);
          done ? set.add(item) : set.delete(item);
          return { ...n, completedActions: [...set] };
        })
      );
      await fetch(`/api/notes/${noteId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, done }),
      }).catch(() => refresh());
    },
    [refresh]
  );

  const handleCitations = useCallback((ids: string[]) => setHighlight(new Set(ids)), []);

  const selectFromPanel = useCallback((id: string) => {
    setSelectedId(id);
    setMobileTab('home');
    setView('graph');
  }, []);

  const focusCluster = useCallback((c: Cluster) => {
    setHighlight(new Set(c.nodeIds));
    setSelectedId(c.noteIds[0] ?? null);
    setMobileTab('home');
    setView('graph');
  }, []);

  const exportBrain = useCallback((format: 'json' | 'md') => {
    window.location.href = `/api/export?format=${format}`;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing) return;

      if (e.key === '?') setHelpOpen((v) => !v);
      if (e.key === 'Escape') {
        setSelectedId(null);
        setHighlight(new Set());
        setHelpOpen(false);
      }
      if (e.key === 'r' || e.key === 'R') window.dispatchEvent(new Event('synapse:record'));
      if (e.key === 'f' || e.key === 'F') graphControls.current?.fit();
      if (e.key === '0') graphControls.current?.reset();
      if (e.key === 'h' || e.key === 'H') setView('dashboard');
      if (e.key === 'g' || e.key === 'G') setView('graph');
      if (e.key === '1') setLens((l) => ({ ...l, layout: 'constellation' }));
      if (e.key === '2') setLens((l) => ({ ...l, layout: 'timeline' }));
      if (e.key === '3') setLens((l) => ({ ...l, layout: 'radial' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands: Command[] = useMemo(
    () => [
      { id: 'act:record', label: 'Record a voice note', hint: 'R', group: 'Actions', run: () => window.dispatchEvent(new Event('synapse:record')) },
      { id: 'act:home', label: 'Go to Home dashboard', hint: 'H', group: 'Actions', run: () => setView('dashboard') },
      { id: 'act:graph', label: 'Go to Graph', hint: 'G', group: 'Actions', run: () => setView('graph') },
      { id: 'act:theme', label: `Switch to ${isDark ? 'light' : 'dark'} mode`, group: 'Actions', run: toggle },
      { id: 'act:refresh', label: 'Rebuild graph', group: 'Actions', run: () => refresh() },
      { id: 'act:clear', label: 'Clear highlights and selection', hint: 'esc', group: 'Actions', run: () => { setHighlight(new Set()); setSelectedId(null); } },
      { id: 'act:json', label: 'Export brain as JSON', group: 'Actions', run: () => exportBrain('json') },
      { id: 'act:md', label: 'Export brain as Markdown', group: 'Actions', run: () => exportBrain('md') },
      { id: 'act:layout1', label: 'Layout: Constellation', hint: '1', group: 'Actions', run: () => setLens((l) => ({ ...l, layout: 'constellation' })) },
      { id: 'act:layout2', label: 'Layout: Timeline', hint: '2', group: 'Actions', run: () => setLens((l) => ({ ...l, layout: 'timeline' })) },
      { id: 'act:layout3', label: 'Layout: Radial', hint: '3', group: 'Actions', run: () => setLens((l) => ({ ...l, layout: 'radial' })) },
    ],
    [refresh, exportBrain, isDark, toggle]
  );

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden">
      <div className="absolute inset-0">
        <GraphCanvas
          data={graph}
          highlight={highlight}
          selectedId={selectedId}
          onSelect={setSelectedId}
          clusters={clusters}
          layout={lens.layout}
          visibleIds={visibleIds}
          showClusters={lens.showClusters}
          isDark={isDark}
          onViewChange={setZoom}
          controlsRef={graphControls}
          paused={view === 'dashboard'}
        />
      </div>

      {/* dashboard sits over the graph, which keeps simulating underneath */}
      <AnimatePresence>
        {view === 'dashboard' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[15] bg-bg/92 backdrop-blur-md"
          >
            <Dashboard
              notes={notes}
              spaces={spaces}
              graph={graph}
              insight={insight}
              onSelect={(id) => {
                setView('graph');
                selectFromPanel(id);
              }}
              onToggleAction={handleToggleAction}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* zoom / fit controls — the way back out when you've zoomed in */}
      <div
        className={`pointer-events-none absolute bottom-[76px] left-1/2 z-20 -translate-x-1/2 lg:bottom-5 lg:left-auto lg:right-[340px] lg:translate-x-0 xl:right-[364px] ${
          view === 'dashboard' ? 'hidden' : ''
        }`}
      >
        <GraphToolbar
          controls={graphControls}
          zoom={zoom}
          hidden={visibleIds ? graph.nodes.length - visibleIds.size : 0}
          total={graph.nodes.length}
        />
      </div>

      {/* ---------------- header ---------------- */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3 sm:p-5">
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="label">Second Brain</div>
          <h1 className="text-gradient text-[20px] font-extrabold tracking-tight sm:text-[26px]">Synapse</h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="panel pointer-events-auto flex items-center gap-3 rounded-xl px-3 py-2 sm:gap-4 sm:px-4 sm:py-2.5"
        >
          {/* view switch */}
          <div className="flex items-center gap-0.5 rounded-lg bg-bg/50 p-0.5">
            {(
              [
                ['graph', 'Graph'],
                ['dashboard', 'Home'],
              ] as Array<[View, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`relative rounded-md px-2 py-1 text-[11px] transition ${
                  view === key ? 'text-ink' : 'text-muted hover:text-ink/80'
                }`}
              >
                {view === key && (
                  <motion.span
                    layoutId="view-pill"
                    className="absolute inset-0 rounded-md bg-accent-soft"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
          <Link
            href="/training"
            className="hidden rounded-md px-2 py-1 text-[11px] text-muted transition hover:text-ink lg:block"
          >
            Training
          </Link>
          <Divider />
          <Stat value={graph.stats.notes} label="notes" className="text-accent" />
          <Divider className="hidden sm:block" />
          <div className="hidden sm:block">
            <Stat value={graph.stats.entities} label="entities" className="text-cyan" />
          </div>
          <Divider />
          <button
            onClick={toggle}
            className="rounded-lg p-1.5 text-muted transition hover:bg-accent-soft hover:text-ink"
            aria-label="Toggle theme"
          >
            {isDark ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="mono hidden rounded-lg border border-line px-2 py-1.5 text-[10px] text-muted transition hover:border-accent hover:text-ink sm:block"
          >
            ⌘K
          </button>
          {installable && (
            <button
              onClick={() => promptInstall()}
              className="rounded-lg bg-accent-soft px-2 py-1 text-[10px] font-medium text-accent transition hover:text-ink"
            >
              Install
            </button>
          )}
          <form action="/auth/signout" method="post" className="flex" onSubmit={clearLocalData}>
            <button
              type="submit"
              title={email ? `Signed in as ${email} — sign out` : 'Sign out'}
              className="rounded-lg p-1.5 text-muted transition hover:bg-rose/10 hover:text-rose"
              aria-label="Sign out"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 17l5-5-5-5M20 12H9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" strokeLinecap="round" />
              </svg>
            </button>
          </form>
        </motion.div>
      </header>

      {/* ---------------- lens bar (desktop) ---------------- */}
      <div
        className={`pointer-events-none absolute left-1/2 top-[74px] z-20 -translate-x-1/2 ${
          view === 'dashboard' ? 'hidden' : 'hidden xl:block'
        }`}
      >
        <LensBar
          lens={lens}
          onChange={setLens}
          matchCount={visibleIds ? visibleIds.size : graph.nodes.length}
          counts={lensCounts}
        />
      </div>

      {/* ---------------- desktop rails ---------------- */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="absolute bottom-5 left-5 top-[136px] z-20 hidden w-[330px] flex-col gap-4 lg:flex"
      >
        <CapturePanel onStored={() => setTimeout(refresh, 400)} />
        <AgentPanel
          onCitations={handleCitations}
          onSelect={selectFromPanel}
          noteCount={graph.stats.notes}
          onSaved={() => setTimeout(refresh, 400)}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className={`absolute bottom-5 right-5 top-[136px] z-20 w-[310px] flex-col ${
          view === 'dashboard' ? 'hidden' : 'hidden xl:flex'
        }`}
      >
        <PulsePanel
          insight={insight}
          clusters={clusters}
          notes={notes}
          spaces={spaces}
          onSelect={selectFromPanel}
          onToggleAction={handleToggleAction}
          onFocusCluster={focusCluster}
          onFiled={refresh}
        />
      </motion.div>

      {/* ---------------- mobile sheet ---------------- */}
      <AnimatePresence>
        {mobileTab !== 'home' && (
          <motion.div
            key={mobileTab}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="absolute inset-x-0 bottom-[64px] top-[84px] z-30 flex flex-col px-3 lg:hidden"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {mobileTab === 'capture' && <CapturePanel onStored={() => setTimeout(refresh, 400)} />}
              {mobileTab === 'agent' && (
                <AgentPanel
                  onCitations={handleCitations}
                  onSelect={selectFromPanel}
                  noteCount={graph.stats.notes}
                  onSaved={() => setTimeout(refresh, 400)}
                />
              )}
              {mobileTab === 'pulse' && (
                <PulsePanel
                  insight={insight}
                  clusters={clusters}
                  notes={notes}
                  spaces={spaces}
                  onSelect={selectFromPanel}
                  onToggleAction={handleToggleAction}
                  onFocusCluster={focusCluster}
                  onFiled={refresh}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- mobile tab bar ---------------- */}
      <nav className="safe-bottom panel absolute inset-x-0 bottom-0 z-40 flex items-stretch lg:hidden">
        {MOBILE_TABS.map(({ key, label, icon }) =>
          key === 'capture' ? (
            <button
              key={key}
              onClick={() => setMobileTab(mobileTab === 'capture' ? 'home' : 'capture')}
              className="relative flex flex-1 items-center justify-center"
              aria-label="Capture a thought"
            >
              <span
                className={`-mt-5 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition ${
                  mobileTab === 'capture' ? 'bg-rose text-white' : 'glow bg-accent text-white'
                }`}
              >
                <TabIcon d={icon} size={20} />
              </span>
            </button>
          ) : (
            <button
              key={key}
              onClick={() => {
                setMobileTab(key);
                if (key === 'home') setView('dashboard');
              }}
              className={`relative flex flex-1 flex-col items-center gap-0.5 pb-2.5 pt-2 text-[10px] font-medium transition ${
                mobileTab === key ? 'text-accent' : 'text-muted'
              }`}
            >
              {mobileTab === key && (
                <motion.span layoutId="mobile-tab" className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-accent" />
              )}
              <span className="relative">
                <TabIcon d={icon} />
                {key === 'pulse' && insight.openActions.length > 0 && (
                  <span className="absolute -right-2.5 -top-1 rounded-full bg-amber px-1 text-[8px] leading-[13px] text-bg">
                    {insight.openActions.length}
                  </span>
                )}
              </span>
              {label}
            </button>
          )
        )}
        <Link
          href="/training"
          className="relative flex flex-1 flex-col items-center gap-0.5 pb-2.5 pt-2 text-[10px] font-medium text-muted transition active:text-accent"
        >
          <TabIcon d={TRAIN_ICON} />
          Train
        </Link>
      </nav>

      {/* ---------------- detail drawer ---------------- */}
      <div className="pointer-events-none absolute inset-0 z-40">
        <DetailPanel
          node={selectedNode}
          notes={notes}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          onDelete={handleDelete}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        nodes={graph.nodes}
        clusters={clusters}
        actions={commands}
        onSelectNode={selectFromPanel}
      />

      {/* ---------------- states ---------------- */}
      <AnimatePresence>
        {!loading && !error && graph.stats.notes === 0 && mobileTab === 'home' && view === 'graph' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-8"
          >
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-5 h-14 w-14 rounded-full border border-accent/40 bg-accent-soft" />
              <h2 className="mb-2 text-lg font-semibold text-ink">Your graph is empty</h2>
              <p className="text-sm leading-relaxed text-muted">
                Record a thought. Synapse pulls out the people, projects and concepts inside it and
                starts wiring them together.
              </p>
            </div>
          </motion.div>
        )}

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center"
          >
            <div className="label">Loading graph…</div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel absolute bottom-20 left-1/2 z-40 max-w-[92vw] -translate-x-1/2 rounded-xl px-4 py-3 lg:bottom-5"
          >
            <div className="label mb-1 text-rose">Error</div>
            <p className="text-[12px] leading-relaxed text-ink/85">{error}</p>
          </motion.div>
        )}

        {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}
      </AnimatePresence>

      <div className="label pointer-events-none absolute bottom-5 left-1/2 z-[5] hidden -translate-x-1/2 xl:block">
        press ? for shortcuts
      </div>
    </main>
  );
}

const MOBILE_TABS: Array<{ key: MobileTab; label: string; icon: string }> = [
  { key: 'home', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { key: 'agent', label: 'Ask', icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z' },
  { key: 'capture', label: 'Capture', icon: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3' },
  { key: 'pulse', label: 'Pulse', icon: 'M3 12h4l3-8 4 16 3-8h4' },
];
const TRAIN_ICON = 'M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11';

function TabIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Stat({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className="text-center">
      <motion.div
        key={value}
        initial={{ scale: 1.3, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`text-[15px] font-bold leading-none sm:text-[17px] ${className}`}
      >
        {value}
      </motion.div>
      <div className="label mt-1">{label}</div>
    </div>
  );
}

function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-7 w-px bg-line ${className}`} />;
}

const SHORTCUTS: Array<[string, string]> = [
  ['⌘K / Ctrl+K', 'Command palette — jump anywhere'],
  ['R', 'Start / stop recording'],
  ['H / G', 'Home dashboard / Graph'],
  ['F', 'Fit the whole graph to view'],
  ['0', 'Reset zoom to 100%'],
  ['1 / 2 / 3', 'Constellation / Timeline / Radial layout'],
  ['Esc', 'Clear selection and highlights'],
  ['?', 'Toggle this panel'],
  ['Scroll', 'Zoom toward cursor'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="panel fixed left-1/2 top-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6"
      >
        <div className="label mb-4">Shortcuts</div>
        <div className="space-y-2.5">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <kbd className="mono shrink-0 rounded border border-line bg-bg/60 px-2 py-1 text-[10px] text-ink">
                {k}
              </kbd>
              <span className="text-[12.5px] text-muted">{v}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
}
