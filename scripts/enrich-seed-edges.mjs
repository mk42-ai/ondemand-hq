// enrich-seed-edges.mjs — TYPED-EDGE ENRICHMENT for prefilled seed runs (2026-07-22).
//
// The 2026-07-22 prefill ran the pipeline in seeded/offline mode, so its runs
// carry ONLY deterministic 'Influence-network' inference edges. This job runs
// the REAL Stage-D edge extraction on FABLE-5 (the correlation model) against
// each seed run's own evidence, hard-gates every stated edge on resolvable
// evidence ids, merges with the existing inferred edges, recomputes weights +
// verification tiers, and rewrites the seed run IN PLACE — giving the canvas
// real typed correlation links (Investment/Trade/Diplomatic/…) between clusters.
//
// Usage: ONDEMAND_API_KEY=... node scripts/enrich-seed-edges.mjs [--concurrency N] [--only ISO,ISO]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOdSession, syncQuery } from '../server/ondemand.js';
import { CE_ANALYSIS_ENDPOINT_ID, CE_ANALYSIS_REASONING_EFFORT } from '../server/env.js';
import { UAE_REGISTRY, RELATIONSHIP_TYPES } from '../server/correlation.js';
import { COUNTRIES } from '../server/intel.js';
import { edgeWeightFromEvidence } from '../server/intelligence/weighting.js';
import { assignVerification } from '../server/intelligence/correlationLayer.js';
import { EDGE_STYLE } from '../server/intelligence/deepPipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_ROOT = path.join(__dirname, '..', 'server', 'data', 'correlation-seed');

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CONCURRENCY = Math.max(1, parseInt(argVal('--concurrency', '5'), 10) || 5);
const ONLY = (argVal('--only', '') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const extractJson = (text) => {
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
};

function newestRunFile(iso) {
  const d = path.join(SEED_ROOT, iso);
  const files = fs.readdirSync(d).filter(f => /^run-.*\.json$/i.test(f)).sort();
  return files.length ? path.join(d, files[files.length - 1]) : null;
}

async function enrich(c) {
  const t0 = Date.now();
  const file = newestRunFile(c.iso);
  if (!file) return { iso: c.iso, skipped: 'no seed run' };
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const typed = run.edges.filter(e => e.relationship_type !== 'Influence-network');
  if (typed.length >= 8) return { iso: c.iso, skipped: `already has ${typed.length} typed edges` };

  const evidence = run.evidence;
  const evList = evidence.map(v => `${v.id}: [${v.source_type}/${v.source}${v.publish_date ? '/' + v.publish_date : ''}] ${v.claim}`).join('\n').slice(0, 90000);
  const sid = await createOdSession(`seed-edges-${c.iso}`, []);
  const raw = await syncQuery({
    odSessionId: sid,
    endpointId: CE_ANALYSIS_ENDPOINT_ID, reasoningEffort: CE_ANALYSIS_REASONING_EFFORT, // Fable 5 MAX
    systemPrompt: 'ODA Correlation Engine edge extractor. ONE valid JSON array only. Never create an edge without supporting evidence ids; never use general knowledge.',
    query: `UAE registry: ${UAE_REGISTRY.map(r => `${r.id} (${r.fullName})`).join('; ')}.
Country node id "${c.iso.toLowerCase()}" (${c.name}).
Evidence:
${evList}

Extract 15-30 RELATIONSHIP EDGES connecting the country cluster to UAE entities — JSON array of:
{"entity_a","entity_b","relationship_type":one of ${JSON.stringify(RELATIONSHIP_TYPES)},
 "direction":"a->b"|"b->a"|"both","claim":string,
 "evidence_record_ids":[ids from above ONLY],"confidence":0-1,"stance":"cooperation"|"tension"|"neutral"}
Use the registry ids (uae, adq, mubadala, g42, adnoc, adports, masdar, adfd, ...) and "${c.iso.toLowerCase()}" as entity ids where they apply; lowercase-slug any other entity. Spread across relationship types where the evidence supports it.`,
  });
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('no edges extracted');

  const evidenceById = new Map(evidence.map(v => [v.id, v]));
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  // HARD GATE: stated edges need >=1 resolvable evidence id
  const gated = parsed.map(e => {
    const ids = [...new Set((e.evidence_record_ids || []).filter(id => evidenceById.has(id)))];
    if (!ids.length) return null;
    return { ...e, entity_a: slug(e.entity_a), entity_b: slug(e.entity_b), evidence_record_ids: ids, inference: false };
  }).filter(e => e && e.entity_a && e.entity_b && e.entity_a !== e.entity_b
    && RELATIONSHIP_TYPES.includes(e.relationship_type));

  // Merge: new stated edges first, keep existing inferred edges that don't duplicate a pair+type
  const seen = new Set(gated.map(e => `${[e.entity_a, e.entity_b].sort().join('~')}|${e.relationship_type}`));
  const kept = run.edges.filter(e => !seen.has(`${[e.entity_a, e.entity_b].sort().join('~')}|${e.relationship_type}`));
  const all = [...gated, ...kept].map((e, i) => {
    const evs = (e.evidence_record_ids || []).map(id => evidenceById.get(id)).filter(Boolean);
    const { rawWeight, weight } = edgeWeightFromEvidence(evs);
    const confidence = +(Math.max(0, Math.min(1, e.confidence ?? 0.5))).toFixed(3);
    const verification = e.verification || assignVerification({ ...e, confidence }, evs);
    return {
      ...e, id: `ED${i + 1}`, confidence, verification,
      style: EDGE_STYLE[verification] || EDGE_STYLE.Possible,
      weight: e.weight ?? weight, rawWeight: e.rawWeight ?? rawWeight,
      stance: e.stance || 'neutral',
      sourceTypes: e.sourceTypes || [...new Set(evs.map(v => v.source_type))],
    };
  });

  // Node set: ensure every edge endpoint exists as a node
  const nodeIds = new Set(run.nodes.map(n => n.id));
  for (const e of all) for (const id of [e.entity_a, e.entity_b]) {
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      run.nodes.push({ id, label: id.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()), fullName: id, kind: 'country-side' });
    }
  }

  run.edges = all;
  run.stats.edgeCount = all.length;
  run.stats.statedEdges = all.filter(e => !e.inference).length;
  run.stats.inferredEdges = all.filter(e => e.inference).length;
  run.edgeEnrichment = { job: 'enrich-seed-edges', model: 'Fable 5 MAX', at: new Date().toISOString(), statedAdded: gated.length };
  fs.writeFileSync(file, JSON.stringify(run, null, 1));
  return { iso: c.iso, stated: gated.length, total: all.length, ms: Date.now() - t0 };
}

const targets = COUNTRIES.filter(c => !ONLY.length || ONLY.includes(c.iso));
console.log(`[enrich] targets=${targets.map(c => c.iso).join(',')} concurrency=${CONCURRENCY}`);
const queue = [...targets];
const results = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const c = queue.shift();
    if (!c) return;
    try {
      const r = await enrich(c);
      results.push(r);
      console.log(r.skipped ? `[enrich] SKIP ${r.iso}: ${r.skipped}` : `[enrich] OK ${r.iso} stated=${r.stated} total=${r.total} in ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      results.push({ iso: c.iso, error: String(e?.message || e).slice(0, 160) });
      console.error(`[enrich] FAIL ${c.iso}: ${e.message}`);
    }
  }
}));
const bad = results.filter(r => r.error);
console.log(`[enrich] done: ${results.length - bad.length} ok/skip, ${bad.length} failed${bad.length ? ' -> ' + bad.map(b => b.iso).join(',') : ''}`);
process.exit(bad.length ? 1 : 0);
