// tests/pinning.test.mjs — DRAG-TO-PIN chart UX (2026-07-22).
// Pure pin math + persistence contract for src/correlation/pinning.js:
// pin exactly at release coords, apply onto live force-graph nodes (fx/fy),
// unpin releases the node, storage round-trip survives reload, and stale
// fx/fy from removed pins is cleared. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pinKey, pinNode, unpinNode, applyPins, isPinned, loadPins, savePins,
} from '../src/correlation/pinning.js';

// minimal localStorage shim so load/save are testable in node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

test('pinNode: records the EXACT release position (rounded to 2dp), immutably', () => {
  const p0 = {};
  const p1 = pinNode(p0, 'adq', 123.456789, -87.65432);
  assert.deepEqual(p1.adq, { x: 123.46, y: -87.65 });
  assert.deepEqual(p0, {}, 'input object untouched');
  // invalid coords / id are no-ops
  assert.deepEqual(pinNode(p1, '', 1, 2), p1);
  assert.deepEqual(pinNode(p1, 'x', NaN, 2), p1);
});

test('applyPins: pinned node gets fx/fy AND x/y at the pinned spot (sticks where released)', () => {
  const nodes = [{ id: 'adq', x: 0, y: 0 }, { id: 'eg', x: 10, y: 10 }];
  const pins = pinNode({}, 'adq', 42.5, -17.25);
  const applied = applyPins(nodes, pins);
  assert.equal(applied, 1);
  assert.equal(nodes[0].fx, 42.5);
  assert.equal(nodes[0].fy, -17.25);
  assert.equal(nodes[0].x, 42.5, 'visual position jumps immediately even with physics off');
  assert.ok(isPinned(nodes[0]));
  assert.ok(!isPinned(nodes[1]), 'unpinned node untouched');
  assert.equal(nodes[1].fx, undefined);
});

test('unpin: removes the pin and applyPins clears stale fx/fy so the simulation may move it', () => {
  const nodes = [{ id: 'adq', x: 5, y: 5 }];
  let pins = pinNode({}, 'adq', 5, 5);
  applyPins(nodes, pins);
  assert.ok(isPinned(nodes[0]));
  pins = unpinNode(pins, 'adq');
  applyPins(nodes, pins);
  assert.equal(nodes[0].fx, undefined, 'fx cleared after unpin');
  assert.equal(nodes[0].fy, undefined, 'fy cleared after unpin');
  assert.ok(!isPinned(nodes[0]));
});

test('persistence: savePins/loadPins round-trip per country; pins survive a reload', () => {
  const pins = pinNode(pinNode({}, 'adq', 1.5, 2.5), 'masdar', -3, 4);
  savePins('eg', pins);
  const back = loadPins('EG'); // case-normalized key
  assert.deepEqual(back, pins);
  assert.equal(pinKey('eg'), 'ce-pins-EG');
  // reload simulation: fresh nodes re-anchor at the persisted spots
  const nodes = [{ id: 'adq', x: 0, y: 0 }, { id: 'masdar', x: 0, y: 0 }];
  assert.equal(applyPins(nodes, back), 2);
  assert.equal(nodes[0].fx, 1.5);
  assert.equal(nodes[1].fy, 4);
});

test('loadPins: storage failure or garbage yields empty object (never throws)', () => {
  store.set('ce-pins-XX', '{not json');
  assert.deepEqual(loadPins('xx'), {});
  assert.deepEqual(loadPins('never-saved'), {});
});
