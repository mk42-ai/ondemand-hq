// graphAdapter.js — PURE adapter: Correlation Engine run JSON → react-force-graph
// {nodes, links}. No fetching, no globals — the date scrubber simply feeds different
// run objects through this same function.
//   weight        → link width (linkWidthOf)
//   recency       → link opacity (rgbaOf)
//   relationship  → color (TYPE_COLORS)
//   platform mix  → glyph badges (node.glyphs / link.glyphs)
//   IG media      → image refs (node.img, first proof thumbnail)
// Graphology pre-render pass: PageRank → node size, Louvain communities → hue tints.
import Graph from 'graphology';
import pagerank from 'graphology-metrics/centrality/pagerank';
import louvain from 'graphology-communities-louvain';

export const TYPE_COLORS = {
  Investment: '#0f6b5c', Trade: '#b08d3c', 'Aid/Humanitarian': '#7c5cbf',
  Diplomatic: '#2563aa', Infrastructure: '#8a6d3b', Energy: '#c05621',
  Technology: '#0e7490', Security: '#9b2c2c', 'Media narrative': '#6b7280',
};
export const PLATFORM_GLYPH = { web: '🌐', x: '𝕏', instagram: '◨', reddit: '◎' };
// Subtle community hue tints layered over the white ODA canvas (Louvain id → tint).
const COMMUNITY_TINTS = ['#0f6b5c', '#b08d3c', '#2563aa', '#7c5cbf', '#c05621', '#0e7490', '#9b2c2c'];

export function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * adaptRun(run, evidenceIndex?, prevRun?) → { nodes, links, stats }
 * evidenceIndex: {id → evidence record} for media/thumbnail lookup.
 * prevRun: previous run object — its diff drives the new-edge pulse flag.
 */
export function adaptRun(run, evidenceIndex = {}, opts = {}) {
  if (!run) return { nodes: [], links: [], stats: null };
  const g = new Graph({ multi: false, type: 'undirected' });
  for (const n of run.graph.nodes) if (!g.hasNode(n.id)) g.addNode(n.id);
  for (const e of run.graph.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
      g.addEdge(e.source, e.target, { weight: Math.max(0.01, e.weight) });
    }
  }
  // PageRank → node size; Louvain → community tint. Deterministic, pure, client-side.
  let ranks = {}, communities = {};
  try { ranks = pagerank(g, { alpha: 0.85, getEdgeWeight: 'weight' }); } catch { /* singleton graphs */ }
  try { communities = louvain(g, { getEdgeWeight: 'weight' }); } catch { /* < 2 nodes */ }

  const newEdgeIds = new Set(run.diff?.newEdges || []);
  const nodes = run.graph.nodes.map(n => {
    const igProof = (n.evidenceIds || [])
      .map(id => evidenceIndex[id]).filter(Boolean)
      .flatMap(ev => ev.media || []).find(Boolean) || null;
    return {
      id: n.id, label: n.label || n.id, type: n.type,
      evidenceIds: n.evidenceIds || [], platforms: n.platforms || [],
      glyphs: (n.platforms || []).map(p => PLATFORM_GLYPH[p]).filter(Boolean).join(''),
      pagerank: ranks[n.id] || 0.02,
      community: communities[n.id] ?? 0,
      tint: COMMUNITY_TINTS[(communities[n.id] ?? 0) % COMMUNITY_TINTS.length],
      img: igProof,                       // IG proof thumbnail path (public/proofs/…)
      val: 4 + 300 * (ranks[n.id] || 0.02),  // PageRank-scaled size
    };
  });
  const links = run.graph.edges.map(e => ({
    id: e.id, source: e.source, target: e.target,
    type: e.type, claim: e.claim, direction: e.direction,
    evidenceIds: e.evidenceIds, evidenceCount: e.evidenceCount,
    platforms: e.platforms, avgConfidence: e.avgConfidence,
    weight: e.weight, recency: e.recency, contradiction: e.contradiction,
    isNew: newEdgeIds.has(e.id),          // daily-diff pulse flag
    color: hexToRgba(TYPE_COLORS[e.type] || '#888888', 0.25 + 0.75 * (e.recency ?? 0.5)),
    baseColor: TYPE_COLORS[e.type] || '#888888',
    width: 1 + (e.weight || 0.1) * 6,
    particleSpeed: 0.002 + 0.01 * (e.recency ?? 0.3), // recency-scaled particle speed
    particles: Math.max(1, Math.round((e.weight || 0.1) * 6)),
  }));
  const stats = {
    nodes: nodes.length, links: links.length,
    communities: new Set(Object.values(communities)).size || 1,
    topNode: nodes.slice().sort((a, b) => b.pagerank - a.pagerank)[0]?.id || null,
  };
  return { nodes, links, stats };
}

/** Filter helper for the control rail — pure, re-runs on every control change. */
export function filterGraph({ nodes, links }, { types, minWeight = 0, maxAgeDays = null }) {
  const okType = (l) => !types || types.size === 0 || types.has(l.type);
  const okWeight = (l) => (l.weight || 0) >= minWeight;
  const okAge = (l) => maxAgeDays == null || (l.recency ?? 0) >= Math.pow(0.5, maxAgeDays / 14) * 0.999 - 1e-9
    ? true : (l.recency ?? 0) >= Math.pow(0.5, maxAgeDays / 14);
  const keptLinks = links.filter(l => okType(l) && okWeight(l) && (maxAgeDays == null || (l.recency ?? 0) >= Math.pow(0.5, maxAgeDays / 14)));
  const keep = new Set(keptLinks.flatMap(l => [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target]));
  return { nodes: nodes.filter(n => keep.has(n.id)), links: keptLinks };
}
