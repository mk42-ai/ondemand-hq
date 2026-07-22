// pinning.js — DRAG-TO-PIN chart UX (2026-07-22).
// When the user drags a data point (graph node) and releases it, the point
// STICKS exactly where it was dropped: onNodeDragEnd fixes the d3 node
// (fx/fy = release coordinates) and the position is persisted per country in
// localStorage, so pins survive run switches and full page reloads. Edges
// (the chart's lines) anchor to their pinned endpoints automatically.
// Pure helpers are separated from storage so the pin math is unit-testable
// without a browser (same pattern as gestures.js).

/** localStorage key per country view. */
export const pinKey = (iso) => `ce-pins-${String(iso || '').toUpperCase()}`;

/** Immutable add/replace of one pinned position. */
export function pinNode(pins, id, x, y) {
  if (!id || !Number.isFinite(+x) || !Number.isFinite(+y)) return pins || {};
  return { ...(pins || {}), [id]: { x: +(+x).toFixed(2), y: +(+y).toFixed(2) } };
}

/** Immutable removal of one pin. */
export function unpinNode(pins, id) {
  const next = { ...(pins || {}) };
  delete next[id];
  return next;
}

/**
 * Apply persisted pins onto live force-graph nodes:
 *   pinned   → fx/fy (d3 fixed position) AND x/y (immediate visual jump even
 *              with physics off / cooldown 0)
 *   unpinned → clear any stale fx/fy so the simulation may move the node again.
 * Returns how many pins were applied (testable signal).
 */
export function applyPins(nodes, pins) {
  let applied = 0;
  for (const n of nodes || []) {
    const p = pins?.[n.id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      n.fx = p.x; n.fy = p.y;
      n.x = p.x; n.y = p.y;
      applied += 1;
    } else if (n.fx != null || n.fy != null) {
      delete n.fx; delete n.fy;
    }
  }
  return applied;
}

/** True if a node is currently anchored (used for the pin glyph + unpin affordance). */
export const isPinned = (n) => n != null && n.fx != null && n.fy != null;

/** Load persisted pins for a country (empty object on any storage failure). */
export function loadPins(iso) {
  try {
    const raw = globalThis.localStorage?.getItem(pinKey(iso));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/** Persist pins for a country (best-effort — private mode safe). */
export function savePins(iso, pins) {
  try { globalThis.localStorage?.setItem(pinKey(iso), JSON.stringify(pins || {})); } catch { /* storage unavailable */ }
}
