// prefill-correlation-seed.mjs — FULL-COUNTRY CORRELATION PREFILL JOB (2026-07-22).
//
// ROOT CAUSE this job fixes: only BD + KE ever had committed seed runs under
// server/data/correlation-seed/, and live run output (server/data/correlation/)
// is gitignored — so a fresh deployment loads 14 of 16 countries EMPTY and the
// user must click "Start Correlation Engine" manually. This job prefills EVERY
// country at least once: real Fable 5 evidence extraction (hardForceDataPoints,
// parallel workers), deterministic pipeline assembly (runDeepPipeline seeded
// mode — no per-country specialist fan-out, keeping the prefill bounded), and
// persistence into the COMMITTED seed directory so the data ships with the
// deployment and hydrateRuns() surfaces it on first visit.
//
// Subsequent "run" clicks stay INCREMENTAL: runDeepJob seeds priorEvidence from
// the latest persisted run (2026-07-21 v3), so a prefilled country only fetches
// the new/missing delta.
//
// Usage: ONDEMAND_API_KEY=... node scripts/prefill-correlation-seed.mjs [--concurrency N] [--only ISO,ISO]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeepPipeline } from '../server/intelligence/deepPipeline.js';
import { hardForceDataPoints, buildExtractionMaterial } from '../server/intelligence/dataFetch.js';
import { UAE_REGISTRY, RELATIONSHIP_TYPES } from '../server/correlation.js';
import { COUNTRIES } from '../server/intel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_ROOT = path.join(__dirname, '..', 'server', 'data', 'correlation-seed');

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CONCURRENCY = Math.max(1, parseInt(argVal('--concurrency', '4'), 10) || 4);
const ONLY = (argVal('--only', '') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const MATERIAL_CAP = 60000; // bounded prompt per country — prefill must stay affordable

function hasSeed(iso) {
  const d = path.join(SEED_ROOT, iso);
  try { return fs.readdirSync(d).some(f => /^run-.*\.json$/i.test(f)); } catch { return false; }
}

async function prefillCountry(c) {
  const t0 = Date.now();
  const material = buildExtractionMaterial({ iso: c.iso, countryName: c.name }).slice(0, MATERIAL_CAP);
  // Real Fable extraction — the model pass that populates the evidence set.
  const fetchRes = await hardForceDataPoints({
    iso: c.iso, countryName: c.name, phrase: 'the last 2 years',
    material, sessionTag: `prefill-${c.iso}`,
  });
  // Deterministic pipeline assembly in seeded mode: full run snapshot (edges,
  // weighting, impact, enrichment, Fable 5 MAX model stamp) WITHOUT the
  // 10-specialist plugin fan-out — bounded cost, still a valid, diffable run.
  const run = await runDeepPipeline({
    iso: c.iso, countryName: c.name,
    registry: UAE_REGISTRY, relationshipTypes: RELATIONSHIP_TYPES,
    offline: true, seedEvidence: fetchRes.dataPoints,
  });
  run.stats.dataFetch = {
    minRequired: 100, endpointUsed: fetchRes.endpointUsed, fallbackUsed: fetchRes.fallbackUsed,
    corpusBackfilled: fetchRes.corpusBackfilled, primaryCount: fetchRes.primaryCount,
    deltaAdded: fetchRes.deltaAdded, mergedCount: fetchRes.mergedCount,
    passes: fetchRes.passes, attempts: fetchRes.attempts, prefill: true,
  };
  run.prefill = { job: 'prefill-correlation-seed', at: new Date().toISOString() };
  const dir = path.join(SEED_ROOT, c.iso);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `run-${run.runId}.json`), JSON.stringify(run, null, 1));
  return { iso: c.iso, runId: run.runId, evidence: run.stats.evidenceCount, edges: run.stats.edgeCount, ms: Date.now() - t0 };
}

const targets = COUNTRIES.filter(c => (ONLY.length ? ONLY.includes(c.iso) : !hasSeed(c.iso)));
console.log(`[prefill] countries=${targets.map(c => c.iso).join(',') || '(none — all seeded)'} concurrency=${CONCURRENCY}`);

const queue = [...targets];
const results = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const c = queue.shift();
    if (!c) return;
    try {
      const r = await prefillCountry(c);
      results.push(r);
      console.log(`[prefill] OK ${r.iso} run=${r.runId} evidence=${r.evidence} edges=${r.edges} in ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      results.push({ iso: c.iso, error: String(e?.message || e).slice(0, 200) });
      console.error(`[prefill] FAIL ${c.iso}: ${e.message}`);
    }
  }
}));

const ok = results.filter(r => !r.error);
const bad = results.filter(r => r.error);
console.log(`[prefill] done: ${ok.length} ok, ${bad.length} failed${bad.length ? ' -> ' + bad.map(b => b.iso).join(',') : ''}`);
process.exit(bad.length ? 1 : 0);
