// dataFetch.js — HARD-FORCE DATA-FETCH LAYER (rewrite, 2026-07-20).
// Replaces the old "Up to 60 records, no minimum" Stage C extraction with a
// strict-floor guarantee: every Correlation Engine run MUST come back with a
// MINIMUM of 100+ clean, deduped, validated evidence/data-point records —
// no odd counts, no partial batches. Any model response short of the floor is
// REJECTED and automatically RETRIED (reject+retry mandate); chunked
// sub-batches that return short of their requested size are treated as
// PARTIAL and re-requested before being merged. Cerebras (GLM 4.7 BYOI) was
// wired first for ultimate speed, but the 2026-07-21 4-run verification
// checkpoint (CORRELATION_TESTS.md) failed it (1/4 runs ≥100 model points);
// per the fallback policy the VERIFIED PRIMARY is now fable-5-medium
// (predefined-claude-fable-5 + reasoningEffort 'medium', 4/4 runs passed),
// with Cerebras retained as the automatic second rung. As an absolute
// last-resort guarantee (so the pipeline NEVER blocks the user), the shortfall
// is backfilled from the real, on-disk evidence corpus — never simulated data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOdSession, syncQuery } from '../ondemand.js';
import * as log from '../log.js';
import { SOURCE_TYPES } from './sources.js';
import {
  CEREBRAS_ENDPOINT_ID, CE_DATAFETCH_REASONING_EFFORT,
  FABLE_FALLBACK_ENDPOINT_ID, FABLE_FALLBACK_REASONING_EFFORT,
  CE_MIN_DATA_POINTS,
} from '../env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MIN_DATA_POINTS = CE_MIN_DATA_POINTS;      // strict floor — ≥100, clamped in env.js
export const TARGET_DATA_POINTS = 120;                  // even target per run
export const MAX_FETCH_ATTEMPTS = 4;                    // reject+retry budget PER ENDPOINT (ladder rung)

export const EXTRACTION_SYSTEM = 'You are the ODA Correlation Engine extractor. Respond with ONE valid JSON array only — no prose, no markdown fences. Ground every record in the provided material; null when unknown; never invent URLs, dates, or facts.';

/** Validate + normalize one candidate data point. Returns a clean record or null. */
export function validateDataPoint(p) {
  if (!p || typeof p !== 'object') return null;
  const claim = String(p.claim ?? '').trim().slice(0, 400);
  if (claim.length < 15) return null;

  const source_type = SOURCE_TYPES.includes(p.source_type) ? p.source_type : 'perplexity_research';
  const source = String(p.source ?? '').slice(0, 120).trim() || 'unknown';
  const url = typeof p.url === 'string' && p.url.startsWith('http') ? p.url : null;
  const pdCandidate = typeof p.publish_date === 'string' ? p.publish_date.slice(0, 10) : '';
  const publish_date = /^\d{4}-\d{2}-\d{2}$/.test(pdCandidate) ? pdCandidate : null;
  const snippet = String(p.snippet ?? '').slice(0, 400);
  const entities = Array.isArray(p.entities)
    ? p.entities.map(e => String(e).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean)
    : [];
  const confRaw = Number(p.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5;

  return { claim, source_type, source, url, publish_date, snippet, entities, confidence };
}

/**
 * Validate + dedupe an entire candidate batch.
 * Dedupe key: normalized claim (lowercase, alphanumeric only, first 120 chars).
 * `points` (the valid, deduped, normalized records) is carried alongside the
 * documented {ok,count,reasons} shape — callers need the actual records to
 * assemble the accepted batch, not just the pass/fail verdict.
 */
export function validateBatch(points) {
  const reasons = [];
  if (!Array.isArray(points)) return { ok: false, count: 0, reasons: ['not_an_array'], points: [] };
  const seen = new Set();
  const valid = [];
  for (const raw of points) {
    const v = validateDataPoint(raw);
    if (!v) { reasons.push('invalid_record'); continue; }
    const key = v.claim.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);
    if (!key || seen.has(key)) { reasons.push('duplicate_claim'); continue; }
    seen.add(key);
    valid.push(v);
  }
  const count = valid.length;
  return { ok: count >= MIN_DATA_POINTS, count, reasons, points: valid };
}

/** No odd batches: if length is odd, drop the single lowest-confidence record. */
export function enforceEvenBatch(points) {
  const arr = Array.isArray(points) ? points.slice() : [];
  if (arr.length % 2 === 0) return arr;
  let minIdx = 0;
  for (let i = 1; i < arr.length; i++) {
    if ((arr[i].confidence ?? 0) < (arr[minIdx].confidence ?? 0)) minIdx = i;
  }
  arr.splice(minIdx, 1);
  return arr;
}

function loadMainCorpusRecords() {
  try {
    const p = path.join(__dirname, '..', 'data', 'evidence-corpus-v2.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    log.error('datafetch.corpus_load_failed', { file: 'evidence-corpus-v2.json', error: String(e?.message || e).slice(0, 160) });
    return [];
  }
}

function loadSeedRecords(iso) {
  const out = [];
  try {
    const seedDir = path.join(__dirname, '..', 'data', 'correlation-seed', String(iso || '').toUpperCase());
    const files = fs.readdirSync(seedDir).filter(f => /^run-.*\.json$/i.test(f));
    for (const f of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8'));
        if (Array.isArray(parsed?.evidence)) out.push(...parsed.evidence);
      } catch { /* skip unreadable seed run file */ }
    }
  } catch { /* no correlation-seed dir for this iso — fine, corpus alone still covers the floor */ }
  return out;
}

function renderCorpusLine(r) {
  const source = r?.source || r?.platform || 'unknown';
  const date = r?.publish_date || 'undated';
  const url = r?.url || 'no-url';
  const claim = String(r?.claim || '').slice(0, 300);
  const snippet = String(r?.snippet || '').slice(0, 200);
  const tags = Array.isArray(r?.tags) ? r.tags.join(',') : (Array.isArray(r?.entities) ? r.entities.join(',') : '');
  return `- [${source}|${date}|${url}] ${claim} — ${snippet} (${tags})`;
}

/**
 * Real raw material for the extraction prompt — NEVER simulated. Loads the
 * 509-record evidence-corpus-v2.json plus any correlation-seed/<ISO>/run-*.json
 * evidence (if present for this country), renders every record as a bullet
 * line, and chunks into "=== CORPUS SECTION n ===" blocks of ~50 records each.
 */
export function buildExtractionMaterial({ iso, countryName } = {}) {
  void countryName; // material is the raw real corpus; country context is injected via the prompt, not the material
  const records = [...loadMainCorpusRecords(), ...loadSeedRecords(iso)];
  const lines = records.map(renderCorpusLine);
  const CHUNK = 50;
  const sections = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    sections.push(`=== CORPUS SECTION ${sections.length + 1} ===\n${lines.slice(i, i + CHUNK).join('\n')}`);
  }
  const material = sections.join('\n\n');
  const CAP = 60000;
  return material.length > CAP ? material.slice(0, CAP) : material;
}

/** Build the extraction prompt — hard requirements on minimum + target record counts. */
export function buildExtractionPrompt({ countryName, phrase, material, min, target }) {
  return `Extract an EVIDENCE/DATA-POINT ARRAY documenting UAE relations with ${countryName} over ${phrase}, grounded strictly in the material below.
Each record schema: {"id":"E1"(sequential),"claim":string,"source_type":one of ${JSON.stringify(SOURCE_TYPES)},"source":string,"url":string(verbatim from material or null),"publish_date":"YYYY-MM-DD"|null,"snippet":string(<=40 words),"entities":[lowercase entity slugs],"confidence":number 0-1}
HARD REQUIREMENTS: Return AT LEAST ${min} records and aim for ${target}. Responses with fewer than ${min} records are rejected and retried. Maximise data-point density: decompose every compound fact into multiple granular records (one per statistic, per entity-pair, per event, per date). ONLY claims present in the material.
MATERIAL:
${material}`;
}

/** Robust JSON extraction — fence+shrink parser (same pattern as deepPipeline.js's extractJson). */
function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const c of [fence?.[1], text]) {
    if (!c) continue;
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    for (let end = c.length; end > start; end--) {
      try { return JSON.parse(c.slice(start, end)); } catch { /* shrink */ }
    }
  }
  return null;
}

/** Split combined material into N roughly-equal slices at "=== ... ===" section boundaries. */
function sliceMaterialIntoParts(material, parts) {
  const raw = String(material || '');
  const chunks = raw.split(/\n(?=== )/).map(s => s.trim()).filter(Boolean);
  const buckets = Array.from({ length: parts }, () => []);
  if (chunks.length) {
    chunks.forEach((c, i) => buckets[i % parts].push(c));
  } else {
    const chunkLen = Math.max(1, Math.ceil(raw.length / parts));
    for (let i = 0; i < parts; i++) buckets[i].push(raw.slice(i * chunkLen, (i + 1) * chunkLen));
  }
  return buckets.map(arr => arr.join('\n\n') || raw.slice(0, 4000));
}

const claimKey = (v) => String(v?.claim || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);

/**
 * THE hard-force loop. Guarantees a return of ≥ MIN_DATA_POINTS, EVEN-count,
 * validated + deduped evidence records — reject+retry below-minimum model
 * responses, escalate single→chunked extraction, fall back Cerebras→fable-5,
 * and (only if every rung is exhausted) backfill the shortfall from the real
 * on-disk corpus. Throws only if even backfill cannot reach the floor.
 */
export async function hardForceDataPoints({
  iso, countryName, phrase, material, sessionTag,
  // VERIFIED LADDER ORDER (2026-07-21 4-run checkpoint, CORRELATION_TESTS.md):
  // Cerebras GLM 4.7 was wired first for ultimate speed but FAILED verification —
  // only 1/4 runs delivered ≥100 model points (134, then 72/60/27 despite full
  // reject+retry: single + chunked modes). Per policy it fell back to
  // fable-5-medium, which PASSED 4/4 (122/140/122/146 pts, all even, zero
  // backfill, single attempt each) → fable-5-medium is the VERIFIED PRIMARY.
  // Cerebras is retained as the second rung (env-overridable speed path via
  // CE_DATAFETCH_ENDPOINT_ID) and can be re-promoted once it re-verifies.
  endpointLadder = [
    { endpointId: FABLE_FALLBACK_ENDPOINT_ID, effort: FABLE_FALLBACK_REASONING_EFFORT, label: 'fable-5-medium' },
    { endpointId: CEREBRAS_ENDPOINT_ID, effort: CE_DATAFETCH_REASONING_EFFORT, label: 'cerebras-glm-4.7' },
  ],
  onAttempt = () => {},
} = {}) {
  const attempts = [];
  let globalAttemptN = 0;
  const recordAttempt = (rec) => {
    globalAttemptN += 1;
    const full = { attempt: globalAttemptN, ...rec };
    attempts.push(full);
    log.info('datafetch.attempt', full);
    onAttempt?.(full);
    return full;
  };

  const finalize = (points, endpointUsed, fallbackUsed, corpusBackfilled = 0) => {
    const even = enforceEvenBatch(points);
    const dataPoints = even.map((p, i) => ({ ...p, id: `E${i + 1}`, origin: p.origin || 'model' }));
    return { dataPoints, attempts, endpointUsed, fallbackUsed, corpusBackfilled };
  };

  let fallbackUsed = false;
  let bestRejected = { points: [], validCount: -1 };

  for (let rungIdx = 0; rungIdx < endpointLadder.length; rungIdx++) {
    const rung = endpointLadder[rungIdx];
    if (rungIdx > 0) fallbackUsed = true;

    for (let n = 1; n <= MAX_FETCH_ATTEMPTS; n++) {
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      const mode = n <= 2 ? 'single' : 'chunked';
      try {
        if (mode === 'single') {
          const target = n === 1 ? TARGET_DATA_POINTS : 140;
          const sid = await createOdSession(`${sessionTag}-a${n}`, []);
          const prompt = buildExtractionPrompt({ countryName, phrase, material, min: MIN_DATA_POINTS, target });
          const raw = await syncQuery({ odSessionId: sid, query: prompt, systemPrompt: EXTRACTION_SYSTEM, endpointId: rung.endpointId, reasoningEffort: rung.effort });
          const parsed = extractJson(raw);
          const batch = validateBatch(Array.isArray(parsed) ? parsed : []);
          const latencyMs = Date.now() - t0;
          if (batch.count > bestRejected.validCount) bestRejected = { points: batch.points, validCount: batch.count };
          if (batch.ok) {
            recordAttempt({ endpointId: rung.endpointId, effort: rung.effort, mode, requested: target, returnedRaw: Array.isArray(parsed) ? parsed.length : 0, validCount: batch.count, accepted: true, rejectedReason: null, latencyMs, startedAt, error: null });
            return finalize(batch.points, rung.endpointId, fallbackUsed, 0);
          }
          recordAttempt({ endpointId: rung.endpointId, effort: rung.effort, mode, requested: target, returnedRaw: Array.isArray(parsed) ? parsed.length : 0, validCount: batch.count, accepted: false, rejectedReason: `below_minimum:${batch.count}<${MIN_DATA_POINTS}`, latencyMs, startedAt, error: null });
        } else {
          const CHUNKS = 4, CHUNK_MIN = 26, CHUNK_TARGET = 34;
          const slices = sliceMaterialIntoParts(material, CHUNKS);
          const runChunk = async (k, mat, suffix = '') => {
            const sid = await createOdSession(`${sessionTag}-a${n}c${k}${suffix}`, []);
            const prompt = buildExtractionPrompt({ countryName, phrase, material: mat, min: CHUNK_MIN, target: CHUNK_TARGET });
            const rawText = await syncQuery({ odSessionId: sid, query: prompt, systemPrompt: EXTRACTION_SYSTEM, endpointId: rung.endpointId, reasoningEffort: rung.effort });
            const parsed = extractJson(rawText);
            return Array.isArray(parsed) ? parsed : [];
          };
          const results = await Promise.allSettled(slices.map((mat, k) => runChunk(k, mat)));
          const chunkArrays = results.map(r => (r.status === 'fulfilled' ? r.value : []));
          // A chunk short of its requested size is PARTIAL → re-request that chunk ONCE.
          const shortIdx = chunkArrays.map((arr, k) => (validateBatch(arr).count < CHUNK_MIN ? k : -1)).filter(k => k >= 0);
          if (shortIdx.length) {
            const retryResults = await Promise.allSettled(shortIdx.map(k => runChunk(k, slices[k], '-retry')));
            shortIdx.forEach((k, j) => { if (retryResults[j].status === 'fulfilled') chunkArrays[k] = retryResults[j].value; });
          }
          const merged = [].concat(...chunkArrays);
          const batch = validateBatch(merged);
          const latencyMs = Date.now() - t0;
          if (batch.count > bestRejected.validCount) bestRejected = { points: batch.points, validCount: batch.count };
          if (batch.ok) {
            recordAttempt({ endpointId: rung.endpointId, effort: rung.effort, mode, requested: CHUNKS * CHUNK_TARGET, returnedRaw: merged.length, validCount: batch.count, accepted: true, rejectedReason: null, latencyMs, startedAt, error: null });
            return finalize(batch.points, rung.endpointId, fallbackUsed, 0);
          }
          recordAttempt({ endpointId: rung.endpointId, effort: rung.effort, mode, requested: CHUNKS * CHUNK_TARGET, returnedRaw: merged.length, validCount: batch.count, accepted: false, rejectedReason: `below_minimum:${batch.count}<${MIN_DATA_POINTS}`, latencyMs, startedAt, error: null });
        }
      } catch (e) {
        const latencyMs = Date.now() - t0;
        recordAttempt({ endpointId: rung.endpointId, effort: rung.effort, mode, requested: mode === 'single' ? (n === 1 ? TARGET_DATA_POINTS : 140) : 4 * 34, returnedRaw: 0, validCount: 0, accepted: false, rejectedReason: null, latencyMs, startedAt, error: String(e?.message || e).slice(0, 300) });
      }
    }

    if (rungIdx === 0) {
      log.error('datafetch.cerebras_exhausted', { sessionTag, attemptsSoFar: attempts.length, bestValidCount: bestRejected.validCount });
    }
  }

  // ---- LAST-RESORT GUARANTEE: backfill the shortfall from the real corpus ----
  const have = bestRejected.points || [];
  const haveKeys = new Set(have.map(claimKey));
  const validatedCorpus = loadMainCorpusRecords()
    .map(validateDataPoint)
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);

  const backfilled = [];
  for (const rec of validatedCorpus) {
    if (have.length + backfilled.length >= TARGET_DATA_POINTS) break;
    const key = claimKey(rec);
    if (haveKeys.has(key)) continue;
    haveKeys.add(key);
    backfilled.push({ ...rec, origin: 'corpus-backfill' });
  }
  const combined = have.concat(backfilled);
  if (combined.length < MIN_DATA_POINTS) {
    throw new Error(`hardForceDataPoints: corpus backfill insufficient (${combined.length} < ${MIN_DATA_POINTS})`);
  }
  log.error('datafetch.corpus_backfill', { n: backfilled.length, total: combined.length });
  return finalize(combined, endpointLadder[endpointLadder.length - 1]?.endpointId ?? null, fallbackUsed, backfilled.length);
}
