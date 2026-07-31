'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { convexHull, type Cluster } from '@/lib/cluster';
import type { LayoutMode } from '@/components/LensBar';
import type { GraphData, GraphEdge, GraphNode } from '@/lib/types';

interface SimNode extends SimulationNodeDatum, GraphNode {
  /** 0..1 entrance progress — nodes fade and scale in as they arrive */
  born: number;
  /** eased hover/selection intensity, 0..1 */
  heat: number;
}

type SimLink = SimulationLinkDatum<SimNode> & { kind: GraphEdge['kind']; weight: number };

/** Light needs deeper, less luminous hues to stay legible on a pale field. */
const PALETTE: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    positive: '#46c58a',
    neutral: '#7c8cff',
    negative: '#f2789e',
    urgent: '#f0b542',
    person: '#4dd4e8',
    project: '#a78bfa',
    org: '#f2789e',
    concept: '#7c8cff',
    place: '#46c58a',
    tool: '#f0b542',
  },
  light: {
    positive: '#14875b',
    neutral: '#4f5bd5',
    negative: '#d94f7d',
    urgent: '#b57608',
    person: '#0e9bb5',
    project: '#7c4ddb',
    org: '#d94f7d',
    concept: '#4f5bd5',
    place: '#14875b',
    tool: '#b57608',
  },
};
const radiusOf = (n: SimNode) =>
  n.kind === 'note' ? 7 + Math.min(n.degree, 8) * 1.2 : 4 + Math.min(n.degree, 10) * 1.0;

interface Props {
  data: GraphData;
  highlight: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  clusters: Cluster[];
  layout: LayoutMode;
  /** null = show everything; otherwise only these ids are drawn at full strength */
  visibleIds: Set<string> | null;
  showClusters: boolean;
  isDark: boolean;
}

export default function GraphCanvas({
  data,
  highlight,
  selectedId,
  onSelect,
  clusters,
  layout,
  visibleIds,
  showClusters,
  isDark,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);

  const viewRef = useRef({ x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1 });
  const pointerRef = useRef({ x: -1e6, y: -1e6, down: false, moved: false, dragging: null as SimNode | null });
  const hoverRef = useRef<SimNode | null>(null);
  const highlightRef = useRef(highlight);
  const selectedRef = useRef(selectedId);
  const visibleRef = useRef(visibleIds);
  const clustersRef = useRef(clusters);
  const showClustersRef = useRef(showClusters);
  const darkRef = useRef(isDark);
  const timeRef = useRef(0);
  darkRef.current = isDark;

  highlightRef.current = highlight;
  selectedRef.current = selectedId;
  visibleRef.current = visibleIds;
  clustersRef.current = clusters;
  showClustersRef.current = showClusters;

  // ---- build / update the simulation when data changes -------------------
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));

    const nodes: SimNode[] = data.nodes.map((n) => {
      const old = prev.get(n.id);
      return old
        ? Object.assign(old, n)
        : ({ ...n, born: 0, heat: 0, x: (Math.random() - 0.5) * 240, y: (Math.random() - 0.5) * 240 } as SimNode);
    });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = data.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, kind: e.kind, weight: e.weight }));

    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          // Semantic links are springier and shorter the stronger they are.
          .distance((l) => (l.kind === 'similar' ? 150 - l.weight * 70 : 70))
          .strength((l) => (l.kind === 'similar' ? 0.12 : 0.5))
      )
      .force('charge', forceManyBody<SimNode>().strength((d) => (d.kind === 'note' ? -320 : -140)))
      .force('collide', forceCollide<SimNode>().radius((d) => radiusOf(d) + 14).strength(0.9));

    if (layout === 'timeline') {
      // Notes are pinned along x by recency; entities float between the notes
      // that mention them, so the graph reads left-to-right as a history.
      const times = nodes
        .filter((n) => n.createdAt)
        .map((n) => new Date(n.createdAt!).getTime());
      const min = Math.min(...times);
      const max = Math.max(...times);
      const span = Math.max(1, max - min);
      const WIDTH = 1100;

      sim
        .force(
          'x',
          forceX<SimNode>((d) =>
            d.createdAt ? ((new Date(d.createdAt).getTime() - min) / span - 0.5) * WIDTH : 0
          ).strength((d) => (d.kind === 'note' ? 0.9 : 0.04))
        )
        .force('y', forceY<SimNode>(0).strength(0.05))
        .force('center', null)
        .force('radial', null);
    } else if (layout === 'radial') {
      // Entities form an inner ring ordered by importance; notes orbit outside.
      sim
        .force(
          'radial',
          forceRadial<SimNode>(
            (d) => (d.kind === 'entity' ? 190 - Math.min(d.degree, 8) * 12 : 420),
            0,
            0
          ).strength(0.7)
        )
        .force('x', forceX(0).strength(0.01))
        .force('y', forceY(0).strength(0.01))
        .force('center', null);
    } else {
      sim
        .force('center', forceCenter(0, 0).strength(0.06))
        .force('x', forceX(0).strength(0.02))
        .force('y', forceY(0).strength(0.02))
        .force('radial', null);
    }

    sim.alpha(0.9).alphaDecay(0.022);
    simRef.current = sim;
    return () => void sim.stop();
  }, [data, layout]);

  // ---- render loop -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      timeRef.current += 1 / 60;
      const t = timeRef.current;

      const view = viewRef.current;
      // Critically-damped-ish easing gives the camera weight without wobble.
      view.x += (view.tx - view.x) * 0.12;
      view.y += (view.ty - view.y) * 0.12;
      view.k += (view.tk - view.k) * 0.12;

      const nodes = nodesRef.current;
      const links = linksRef.current;
      const hl = highlightRef.current;
      const sel = selectedRef.current;
      const dimmed = hl.size > 0 || sel !== null;

      // Which nodes are "live" — cited, selected, or adjacent to the selection.
      const live = new Set<string>(hl);
      if (sel) {
        live.add(sel);
        for (const l of links) {
          const s = l.source as SimNode;
          const tg = l.target as SimNode;
          if (s.id === sel) live.add(tg.id);
          if (tg.id === sel) live.add(s.id);
        }
      }

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 + view.x, height / 2 + view.y);
      ctx.scale(view.k, view.k);

      const hovered = hoverRef.current;
      const dark = darkRef.current;
      const palette = PALETTE[dark ? 'dark' : 'light'];
      const color = (n: GraphNode) => palette[n.variant] ?? palette.neutral;
      const coreColor = dark ? '#0b0d12' : '#ffffff';
      const labelHalo = dark ? 'rgba(11,13,18,0.9)' : 'rgba(255,255,255,0.92)';
      const labelInk = dark ? '#e9ecf3' : '#14171f';
      const labelMuted = dark ? '#9aa2b8' : '#5c6478';
      const vis = visibleRef.current;
      const isVisible = (id: string) => !vis || vis.has(id);

      // ---- cluster hulls (behind everything) ----
      if (showClustersRef.current) {
        const posById = new Map(nodes.map((n) => [n.id, n]));
        for (const cl of clustersRef.current) {
          const pts: Array<[number, number]> = [];
          for (const id of cl.nodeIds) {
            const n = posById.get(id);
            if (n?.x != null && n.y != null && n.born > 0.5 && isVisible(id)) pts.push([n.x, n.y]);
          }
          if (pts.length < 3) continue;

          const hull = convexHull(pts);
          if (hull.length < 3) continue;

          // Push the hull outward from its centroid so it wraps the nodes.
          const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
          const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
          const PAD = 34;
          const padded = hull.map(([x, y]) => {
            const d = Math.hypot(x - cx, y - cy) || 1;
            return [x + ((x - cx) / d) * PAD, y + ((y - cy) / d) * PAD] as [number, number];
          });

          ctx.beginPath();
          // Quadratic through midpoints gives a soft blob rather than a polygon.
          for (let i = 0; i < padded.length; i++) {
            const cur = padded[i];
            const next = padded[(i + 1) % padded.length];
            const mx = (cur[0] + next[0]) / 2;
            const my = (cur[1] + next[1]) / 2;
            if (i === 0) ctx.moveTo(mx, my);
            else ctx.quadraticCurveTo(cur[0], cur[1], mx, my);
          }
          ctx.closePath();

          ctx.globalAlpha = 0.07;
          ctx.fillStyle = cl.color;
          ctx.fill();
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = cl.color;
          ctx.lineWidth = 1 / view.k;
          ctx.setLineDash([6 / view.k, 8 / view.k]);
          ctx.stroke();
          ctx.setLineDash([]);

          // theme label sits above the blob
          const topY = Math.min(...padded.map((p) => p[1]));
          ctx.globalAlpha = 0.75;
          ctx.font = `600 ${12 / view.k ** 0.6}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = cl.color;
          ctx.fillText(cl.name.toUpperCase(), cx, topY - 8 / view.k);
        }
      }

      // ---- edges ----
      for (const l of links) {
        const s = l.source as SimNode;
        const tgt = l.target as SimNode;
        if (s.x == null || tgt.x == null) continue;

        const shown = isVisible(s.id) && isVisible(tgt.id);
        const isLive = shown && (!dimmed || (live.has(s.id) && live.has(tgt.id)));
        const touchesHover = hovered && (s.id === hovered.id || tgt.id === hovered.id);
        const appear = Math.min(s.born, tgt.born) * (shown ? 1 : 0.25);

        let alpha = l.kind === 'similar' ? 0.3 : 0.16;
        if (!isLive) alpha *= 0.12;
        if (touchesHover) alpha = 0.85;
        alpha *= appear;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = l.kind === 'similar' ? palette.person : dark ? '#7c86c4' : '#8a93ad';
        ctx.lineWidth = (l.kind === 'similar' ? 0.6 + l.weight * 1.6 : 0.7) / view.k ** 0.35;
        if (l.kind === 'similar') ctx.setLineDash([5 / view.k, 6 / view.k]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(tgt.x!, tgt.y!);
        ctx.stroke();
        ctx.setLineDash([]);

        // Travelling pulse — only on live semantic edges, keeps the graph alive.
        if (l.kind === 'similar' && isLive && appear > 0.9) {
          const speed = 0.16 + l.weight * 0.12;
          const p = ((t * speed) % 1 + 1) % 1;
          const px = s.x! + (tgt.x! - s.x!) * p;
          const py = s.y! + (tgt.y! - s.y!) * p;
          ctx.globalAlpha = (touchesHover ? 0.95 : 0.55) * appear;
          ctx.fillStyle = palette.person;
          ctx.beginPath();
          ctx.arc(px, py, 1.8 / view.k ** 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- nodes ----
      for (const n of nodes) {
        if (n.x == null || n.y == null) continue;
        n.born = Math.min(1, n.born + 0.045);

        const shown = isVisible(n.id);
        const isLive = shown && (!dimmed || live.has(n.id));
        const isHover = hovered?.id === n.id;
        const isSel = sel === n.id;
        const target = isHover || isSel ? 1 : 0;
        n.heat += (target - n.heat) * 0.18;

        const ease = 1 - Math.pow(1 - n.born, 3);
        const r = radiusOf(n) * ease * (1 + n.heat * 0.35);
        const c = color(n);

        ctx.globalAlpha = (isLive ? 1 : shown ? 0.15 : 0.06) * ease;

        // breathing halo
        const breathe = 1 + Math.sin(t * 1.4 + n.x! * 0.01) * 0.06;
        const haloR = r * (2.6 + n.heat * 1.6) * breathe;
        const grad = ctx.createRadialGradient(n.x!, n.y!, r * 0.2, n.x!, n.y!, haloR);
        grad.addColorStop(0, `${c}66`);
        grad.addColorStop(1, `${c}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, haloR, 0, Math.PI * 2);
        ctx.fill();

        // body — notes are discs, entities are rotated squares
        ctx.fillStyle = c;
        ctx.beginPath();
        if (n.kind === 'note') {
          ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        } else {
          const a = Math.PI / 4 + t * 0.12;
          for (let i = 0; i < 4; i++) {
            const ang = a + (i * Math.PI) / 2;
            const px = n.x! + Math.cos(ang) * r * 1.15;
            const py = n.y! + Math.sin(ang) * r * 1.15;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
        }
        ctx.fill();

        // inner core keeps big nodes from reading as flat blobs
        ctx.globalAlpha *= 0.9;
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r * 0.42, 0, Math.PI * 2);
        ctx.fill();

        if (isSel) {
          ctx.globalAlpha = ease;
          ctx.strokeStyle = labelInk;
          ctx.lineWidth = 1.5 / view.k;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r + 6 + Math.sin(t * 3) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // ---- labels ----
        const important = n.kind === 'entity' ? n.degree >= 2 : n.degree >= 3;
        const showLabel = isHover || isSel || (view.k > 0.75 && important) || view.k > 1.6;
        if (showLabel && isLive && shown) {
          const fs = (n.kind === 'note' ? 11 : 10) / view.k ** 0.55;
          ctx.font = `${isHover || isSel ? 600 : 500} ${fs}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label;
          const ly = n.y! + r + 6 / view.k ** 0.5;

          ctx.globalAlpha = (isHover || isSel ? 1 : 0.7) * ease;
          ctx.lineWidth = 3 / view.k;
          ctx.strokeStyle = labelHalo;
          ctx.strokeText(label, n.x!, ly);
          ctx.fillStyle = isHover || isSel ? labelInk : labelMuted;
          ctx.fillText(label, n.x!, ly);
        }
      }

      ctx.restore();
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ---- pointer interaction ----------------------------------------------
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - v.x) / v.k,
      y: (clientY - rect.top - rect.height / 2 - v.y) / v.k,
    };
  }, []);

  const pick = useCallback((wx: number, wy: number) => {
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const d = Math.hypot(n.x - wx, n.y - wy);
      const hit = radiusOf(n) + 10;
      if (d < hit && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMove = (e: PointerEvent) => {
      const p = pointerRef.current;
      const w = toWorld(e.clientX, e.clientY);

      if (p.down) {
        p.moved = true;
        if (p.dragging) {
          p.dragging.fx = w.x;
          p.dragging.fy = w.y;
          simRef.current?.alphaTarget(0.25).restart();
        } else {
          const v = viewRef.current;
          v.tx += e.movementX;
          v.ty += e.movementY;
          v.x += e.movementX;
          v.y += e.movementY;
        }
        return;
      }

      const hit = pick(w.x, w.y);
      hoverRef.current = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const w = toWorld(e.clientX, e.clientY);
      const hit = pick(w.x, w.y);
      pointerRef.current = { x: w.x, y: w.y, down: true, moved: false, dragging: hit };
      if (hit) {
        hit.fx = hit.x;
        hit.fy = hit.y;
      }
      canvas.style.cursor = hit ? 'grabbing' : 'grabbing';
    };

    const onUp = (e: PointerEvent) => {
      const p = pointerRef.current;
      canvas.releasePointerCapture(e.pointerId);

      if (p.dragging) {
        p.dragging.fx = null;
        p.dragging.fy = null;
        simRef.current?.alphaTarget(0);
      }
      // A click that didn't drag is a selection.
      if (!p.moved) {
        const w = toWorld(e.clientX, e.clientY);
        const hit = pick(w.x, w.y);
        onSelect(hit ? hit.id : null);
      }
      pointerRef.current = { ...p, down: false, dragging: null };
      canvas.style.cursor = 'grab';
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;

      const factor = Math.exp(-e.deltaY * 0.0015);
      const nk = Math.max(0.25, Math.min(4, v.tk * factor));
      const ratio = nk / v.tk;

      // zoom toward the cursor rather than the origin
      v.tx = mx - (mx - v.tx) * ratio;
      v.ty = my - (my - v.ty) * ratio;
      v.tk = nk;
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [pick, toWorld, onSelect]);

  // Fly the camera to a node when it's selected from outside the canvas.
  useEffect(() => {
    if (!selectedId) return;
    const n = nodesRef.current.find((x) => x.id === selectedId);
    if (!n || n.x == null) return;
    const v = viewRef.current;
    v.tk = Math.max(v.tk, 1.3);
    v.tx = -n.x * v.tk;
    v.ty = -n.y! * v.tk;
  }, [selectedId]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
    </div>
  );
}
