// chatTurns.js — resumable chat turns.
//
// A "turn" is one assistant answer in flight. It decouples the UPSTREAM OnDemand query
// lifecycle from the BROWSER connection so a mid-stream transport drop can resume from the
// exact point it broke, with zero duplication.
//
// HOW RESUME WORKS
//   • Every browser-bound SSE frame is buffered and tagged with a native SSE `id:` (a
//     monotonic index). The client tracks the highest id it has seen.
//   • On a drop the client reconnects to /api/chat/resume?turnId&lastEventIndex=N. We replay
//     only the buffered frames with id > N, then attach the new socket as a live subscriber —
//     so the answer continues seamlessly (fulfillment answer tokens after N are appended, not
//     re-sent).
//   • The upstream query keeps running while the browser is briefly gone (GRACE_MS). If nobody
//     resumes within the grace window the upstream is aborted. Completed turns keep their buffer
//     for DONE_TTL_MS so a late reconnect can still replay the tail + the `done` frame.
//
// NOTE (serverless): the registry is in-process. On a multi-instance/serverless deploy a resume
// may land on a different instance and miss — the client falls back gracefully (see api.js /
// App.jsx). Single-instance (local `node server`) resumes fully.

import { randomUUID } from 'node:crypto';

const GRACE_MS = 90_000; // keep upstream alive this long after the browser detaches
const DONE_TTL_MS = 120_000; // keep a finished turn's buffer this long for late resume
const KEEPALIVE_MS = 10_000; // SSE comment ping to attached subscribers

/** @type {Map<string, Turn>} */
const turns = new Map();

/**
 * @typedef {Object} Subscriber
 * @property {import('http').ServerResponse} res
 * @property {boolean} closed
 * @property {(() => void)=} onFinish
 */

/**
 * @typedef {Object} Turn
 * @property {string} id
 * @property {string} conversationId
 * @property {'running'|'done'|'error'} status
 * @property {Array<{i:number, evName:string|null, data:string}>} frames
 * @property {number} nextIndex
 * @property {Set<Subscriber>} subscribers
 * @property {ReturnType<typeof setTimeout>|null} graceTimer
 * @property {ReturnType<typeof setTimeout>|null} ttlTimer
 * @property {ReturnType<typeof setInterval>|null} keepAlive
 * @property {(() => void)|null} onAbandon  // called when grace elapses with no subscribers
 * @property {boolean} cancelled
 */

export function createTurn(conversationId) {
  const id = randomUUID();
  /** @type {Turn} */
  const turn = {
    id,
    conversationId: conversationId || null,
    status: 'running',
    frames: [],
    nextIndex: 0,
    subscribers: new Set(),
    graceTimer: null,
    ttlTimer: null,
    keepAlive: null,
    onAbandon: null,
    cancelled: false,
  };
  turn.keepAlive = setInterval(() => {
    for (const sub of turn.subscribers) {
      if (sub.closed) continue;
      try {
        sub.res.write(': keepalive\n\n');
        sub.res.flush?.();
      } catch {
        /* socket gone — removeSubscriber will clean up on its own close event */
      }
    }
  }, KEEPALIVE_MS);
  turns.set(id, turn);
  return turn;
}

export function getTurn(id) {
  return id ? turns.get(id) || null : null;
}

function writeBlock(res, i, evName, data) {
  let s = `id:${i}\n`;
  if (evName && evName !== 'message') s += `event:${evName}\n`;
  s += `data:${data}\n\n`;
  res.write(s);
  res.flush?.();
}

/**
 * Buffer a frame and fan it out to every attached subscriber. Returns the assigned index.
 * `data` is the exact string that follows `data:` on the wire (raw passthrough JSON or a
 * synthesized frame's JSON) — kept byte-identical so passthrough stays lossless.
 */
export function emit(turn, evName, data) {
  const i = turn.nextIndex++;
  turn.frames.push({ i, evName: evName || null, data });
  for (const sub of turn.subscribers) {
    if (sub.closed) continue;
    try {
      writeBlock(sub.res, i, evName, data);
    } catch {
      /* socket gone */
    }
  }
  return i;
}

/**
 * Attach a browser response to a turn. Replays every buffered frame with id > lastEventIndex
 * FIRST (synchronously, so no live frame can interleave), then registers for live frames.
 */
export function addSubscriber(turn, res, lastEventIndex = -1, onFinish) {
  for (const f of turn.frames) {
    if (f.i > lastEventIndex) {
      try {
        writeBlock(res, f.i, f.evName, f.data);
      } catch {
        /* socket gone */
      }
    }
  }
  /** @type {Subscriber} */
  const sub = { res, closed: false, onFinish };
  turn.subscribers.add(sub);
  if (turn.graceTimer) {
    clearTimeout(turn.graceTimer);
    turn.graceTimer = null;
  }
  return sub;
}

export function removeSubscriber(turn, sub) {
  if (!sub || sub.closed) return;
  sub.closed = true;
  turn.subscribers.delete(sub);
  // No one is listening. If the turn is still running, keep the upstream alive for a grace
  // window so a reconnect can resume; abort only if nobody comes back.
  if (turn.status === 'running' && turn.subscribers.size === 0 && !turn.graceTimer) {
    turn.graceTimer = setTimeout(() => {
      turn.graceTimer = null;
      if (turn.subscribers.size === 0 && turn.status === 'running') {
        turn.cancelled = true;
        try {
          turn.onAbandon?.();
        } catch {
          /* noop */
        }
        destroy(turn);
      }
    }, GRACE_MS);
  }
}

/** Mark the turn finished. Ends any attached subscribers and keeps the buffer for late resume. */
export function finishTurn(turn, status = 'done') {
  if (!turn) return;
  turn.status = status === 'error' ? 'error' : 'done';
  if (turn.graceTimer) {
    clearTimeout(turn.graceTimer);
    turn.graceTimer = null;
  }
  for (const sub of turn.subscribers) {
    try {
      sub.onFinish?.();
    } catch {
      /* noop */
    }
  }
  if (turn.keepAlive) {
    clearInterval(turn.keepAlive);
    turn.keepAlive = null;
  }
  turn.ttlTimer = setTimeout(() => destroy(turn), DONE_TTL_MS);
}

/** Explicit cancel (user pressed Stop): abort upstream and drop the turn immediately. */
export function cancelTurn(id) {
  const turn = turns.get(id);
  if (!turn) return false;
  turn.cancelled = true;
  try {
    turn.onAbandon?.();
  } catch {
    /* noop */
  }
  destroy(turn);
  return true;
}

function destroy(turn) {
  if (turn.graceTimer) clearTimeout(turn.graceTimer);
  if (turn.ttlTimer) clearTimeout(turn.ttlTimer);
  if (turn.keepAlive) clearInterval(turn.keepAlive);
  turn.graceTimer = turn.ttlTimer = turn.keepAlive = null;
  turns.delete(turn.id);
}
