// liveStream.js — concurrent Cerebras live feed for authoring streams (2026-07-23).
// Consulted LIVE OnDemand docs (Chat & Agent Tools API — submitquery with
// responseMode "stream": fulfillment frames carry the answer token in .answer,
// terminal data:[DONE]) — see MIGRATION_MAP.md §4.2 and server/ondemand.js.
//
// Design:
//   • The FINAL document still streams from opus-4.8 (FINAL_DOC_ENDPOINT_ID —
//     enforcement unchanged, assertFinalDocEndpoint throws on substitution).
//   • As fulfillment tokens arrive they are buffered; every CHUNK_TOKENS (200)
//     tokens the chunk is dispatched IMMEDIATELY to Cerebras (the GLM 4.7 byoi
//     endpoint api.cerebras.ai) IN PARALLEL — we never wait for the OnDemand
//     stream to finish before feeding Cerebras.
//   • Each Cerebras response is a tiny digest JSON that patches the live-render
//     cards (slide.update frames) progressively — continuous incremental
//     rendering on the canvas.
//   • Chunk ordering: every chunk carries a seq; digests are applied strictly
//     in seq order (out-of-order completions buffer until their turn).
//   • Partial-token boundaries: a chunk is cut at the last whitespace so no
//     word is split across chunks; the held-back tail joins the next chunk.
//   • Tail flush: when the OnDemand stream ends, any remaining <200-token tail
//     is dispatched as the final chunk, then all in-flight digests settle.
import { streamQuery, createOdSession } from '../ondemand.js';
import { emitRunEvent } from './events.js';
import { interpreterCall, FINAL_DOC_ENDPOINT_ID, assertFinalDocEndpoint } from './models.js';

const CHUNK_TOKENS = 200;

const DIGEST_PROMPT = 'You are a live-render condenser. From the document fragment, emit ONLY JSON '
  + '{"headline":"<=70 chars what this section establishes","points":["<=80 chars",".. max 2"]}. '
  + 'Use only what is IN the fragment. No prose, no fences.';

function parseDigest(raw, seq) {
  try {
    const cleaned = String(raw || '').replace(/```(?:json)?/g, '');
    const a = cleaned.indexOf('{'); const b = cleaned.lastIndexOf('}');
    const j = JSON.parse(cleaned.slice(a, b + 1));
    return {
      headline: String(j.headline || '').slice(0, 70),
      points: (Array.isArray(j.points) ? j.points : []).map((p) => String(p).slice(0, 80)).slice(0, 2),
    };
  } catch {
    return { headline: `Section ${seq + 1} drafted`, points: [] };
  }
}

/**
 * Stream the opus-4.8 authoring while feeding 200-token chunks to Cerebras in
 * parallel; Cerebras digests patch slide 3 (core findings) progressively.
 * Returns the FULL opus-4.8 draft text (the final document source).
 */
export async function streamAuthoringWithLiveFeed({ run, node, sessionId, query, systemPrompt, persist = () => {} }) {
  assertFinalDocEndpoint(FINAL_DOC_ENDPOINT_ID); // no silent downgrades — throws otherwise

  // Dedicated Cerebras feed session so parallel digest calls never contend
  // with the authoring session.
  let feedSessionId = null;
  try { feedSessionId = await createOdSession(`oda-livefeed-${run.runId.slice(0, 8)}`, []); }
  catch (err) { console.warn(`[oda-livefeed] feed session unavailable (${err.message}) — live feed disabled, authoring continues`); }

  let full = '';
  let chunkBuf = '';
  let chunkTokens = 0;
  let chunkSeq = 0;
  let nextApply = 0;
  const ready = new Map();     // seq -> digest (completed, awaiting ordered apply)
  const inflight = [];         // promises of dispatched Cerebras calls

  const applyReadyInOrder = () => {
    while (ready.has(nextApply)) {
      const digest = ready.get(nextApply);
      ready.delete(nextApply);
      const slides = run.liveDeck?.slides;
      if (slides && slides[2]) {
        const s3 = slides[2];
        const bullets = [...(s3.bullets || []), ...digest.points].slice(-4);
        const title = digest.headline || s3.title || 'Core findings — rendering live';
        Object.assign(s3, { title, bullets, status: 'filling' });
        emitRunEvent(run, 'slide.update', {
          slideNo: 3,
          patch: { title, bullets, status: 'filling' },
          chunkSeq: nextApply,
          feed: 'cerebras',
        });
        persist();
      }
      nextApply += 1;
    }
  };

  const dispatchChunk = (text, seq, isTail) => {
    if (!feedSessionId || !text.trim()) {
      ready.set(seq, { headline: '', points: [] });
      applyReadyInOrder();
      return;
    }
    emitRunEvent(run, 'skill.progress', {
      nodeId: node?.nodeId || null,
      note: `live feed: chunk ${seq + 1}${isTail ? ' (tail)' : ''} → cerebras (${text.length} chars)`,
      feed: 'cerebras', chunkSeq: seq,
    });
    const p = interpreterCall({ sessionId: feedSessionId, query: text.slice(0, 6000), systemPrompt: DIGEST_PROMPT })
      .then((raw) => { ready.set(seq, parseDigest(raw, seq)); applyReadyInOrder(); })
      .catch((err) => {
        console.warn(`[oda-livefeed] chunk ${seq} digest failed: ${err.message}`);
        ready.set(seq, { headline: '', points: [] });
        applyReadyInOrder();
      });
    inflight.push(p);
  };

  // ---- The opus-4.8 authoring stream (OnDemand submitquery, responseMode stream) ----
  await streamQuery({
    odSessionId: sessionId,
    query,
    systemPrompt,
    pluginIds: [],
    endpointId: FINAL_DOC_ENDPOINT_ID,
    reasoningEffort: 'medium',
    fulfillmentOnly: true,
    // streamQuery invokes onEvent('answer', <delta>) per fulfillment frame
    // (see server/ondemand.js parseFrame) — positional args, not an object.
    onEvent: (kind, delta) => {
      if (kind !== 'answer' || typeof delta !== 'string') return;
      full += delta;
      chunkBuf += delta;
      chunkTokens += 1;
      if (chunkTokens >= CHUNK_TOKENS) {
        // Cut at the last whitespace so no word splits across chunks; the
        // held-back partial word starts the next chunk.
        let cut = chunkBuf.length;
        const lastWs = Math.max(chunkBuf.lastIndexOf(' '), chunkBuf.lastIndexOf('\n'));
        if (lastWs > chunkBuf.length * 0.5) cut = lastWs + 1;
        dispatchChunk(chunkBuf.slice(0, cut), chunkSeq, false);
        chunkSeq += 1;
        chunkBuf = chunkBuf.slice(cut);
        chunkTokens = 0;
      }
    },
  });

  // ---- Tail flush: remaining <200-token tail when the OnDemand stream ends ----
  if (chunkBuf.trim()) {
    dispatchChunk(chunkBuf, chunkSeq, true);
    chunkSeq += 1;
  }
  await Promise.allSettled(inflight);
  applyReadyInOrder(); // drain anything that completed last

  if (!full.trim()) {
    const err = new Error('opus-4.8 authoring stream produced no fulfillment tokens');
    err.code = 'ODA_EMPTY_STREAM';
    throw err;
  }
  return full;
}
