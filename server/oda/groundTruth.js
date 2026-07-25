// groundTruth.js — verified reference facts + data-correctness cross-check
// (E2E QA pass, 2026-07-22). Two jobs:
//   1. GROUND_TRUTH: the verified reference facts injected into data-scout /
//      problem-solve context so skill outputs match verified reality instead
//      of unverified brief numbers (requirement 4 of the QA pass).
//   2. crossCheckContent(): audits produced artifact text against the facts,
//      flagging contradictions (wrong rank, wrong totals) — used by tests and
//      available to the verifier prompt as structured findings input.
// Sources are named per fact — the no-invent rule applies to us too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Verified reference facts (each with source attribution). */
export const GROUND_TRUTH = Object.freeze([
  Object.freeze({
    id: 'uae-donor-rank-2025',
    fact: 'UAE was the third-largest global humanitarian donor in 2025 with US$1.46 billion — 7.2% of the $20.28 billion total tracked by UNOCHA FTS, behind only the United States and the European Union',
    figures: Object.freeze({ amountUsd: 1.46e9, sharePct: 7.2, totalTrackedUsd: 20.28e9, rank: 3 }),
    source: 'UNOCHA FTS (fts.unocha.org, 2025 flows)',
  }),
  Object.freeze({
    id: 'uae-gaza-relief',
    fact: 'UAE Gaza relief totalled $2.57 billion; the UAE field hospital treated 53,000+ people and the floating hospital in Egypt cared for ~21,000 patients',
    figures: Object.freeze({ totalUsd: 2.57e9, fieldHospitalPatients: 53000, floatingHospitalPatients: 21000 }),
    source: 'WAM / Emirates News Agency (Gaza response reporting)',
  }),
  Object.freeze({
    id: 'uae-cumulative-aid',
    fact: 'Cumulative UAE foreign aid exceeds $100 billion (Dh370 billion) since 1971, reaching over one billion people in 200+ countries',
    figures: Object.freeze({ cumulativeUsd: 100e9, cumulativeAed: 370e9, peopleReached: 1e9, countries: 200 }),
    source: 'UAE Ministry of Foreign Affairs / uaeaid.ae',
  }),
  Object.freeze({
    id: 'horn-food-security-2025',
    fact: 'Horn of Africa: ~85 million people highly food insecure in the region as of March 2025 (FSNWG)',
    figures: Object.freeze({ peopleFoodInsecure: 85e6 }),
    source: 'Food Security and Nutrition Working Group (FSNWG), March 2025',
  }),
  Object.freeze({
    id: 'somalia-ipc-2025',
    fact: 'Somalia: 4.4 million people projected at IPC Phase 3+ April–June 2025, with 1.7 million children under five facing acute malnutrition (466,000 severe)',
    figures: Object.freeze({ ipc3plus: 4.4e6, childrenAcute: 1.7e6, childrenSevere: 466000 }),
    source: 'IPC Somalia projection, April–June 2025',
  }),
  Object.freeze({
    id: 'sudan-famine-2025',
    fact: 'Sudan: famine confirmed in El Fasher and Kadugli; 21.2 million people at IPC Phase 3+ (November 2025 IPC)',
    figures: Object.freeze({ ipc3plus: 21.2e6, famineLocations: Object.freeze(['El Fasher', 'Kadugli']) }),
    source: 'IPC Sudan analysis, November 2025',
  }),
]);

/** Compact context block injected into data-heavy skill calls (M6-selective). */
export function groundTruthContext() {
  return `--- VERIFIED REFERENCE FACTS (cite by source; do not contradict) ---\n${GROUND_TRUTH.map((g) => `• ${g.fact} [source: ${g.source}]`).join('\n')}`;
}

/** Which skills receive the ground-truth block (data-bearing surfaces only). */
export const GROUND_TRUTH_SKILLS = Object.freeze(['data-scout', 'problem-solve', 'benchmark', 'storyline', 'model']);

// ---------------------------------------------------------------------------
// Contradiction cross-check
// ---------------------------------------------------------------------------

/** Patterns that CONTRADICT the verified facts (wrong rank / totals). */
const CONTRADICTIONS = [
  { re: /\b(second|2nd|fourth|4th|fifth|5th)[-\s]largest\s+(global\s+)?humanitarian\s+donor\b/i, factId: 'uae-donor-rank-2025', why: 'UAE 2025 humanitarian-donor rank is THIRD (UNOCHA FTS)' },
  { re: /\$\s?1\.46\s?B(?:illion)?\b[^.]{0,80}\b(2024|2023)\b/i, factId: 'uae-donor-rank-2025', why: 'The $1.46B figure is 2025, not an earlier year' },
  { re: /\bGaza[^.]{0,120}\$\s?(1\.\d|2\.[0-4]|[03-9](?:\.\d)?)\s?B(?:illion)?\b/i, factId: 'uae-gaza-relief', why: 'UAE Gaza relief total is $2.57B (WAM)' },
  { re: /\bcumulative[^.]{0,120}\$\s?([2-9]\d?|1[1-9])\s?B(?:illion)?\b/i, factId: 'uae-cumulative-aid', why: 'Cumulative UAE aid exceeds $100B since 1971' },
  { re: /\bSomalia[^.]{0,140}\b([05-9]|[1-3])\.?\d?\s?million\s+people\s+(?:projected\s+)?at\s+IPC/i, factId: 'somalia-ipc-2025', why: 'Somalia IPC 3+ projection Apr–Jun 2025 is 4.4M people' },
];

/**
 * Cross-check produced content against the verified facts.
 * @param {string} text artifact content
 * @returns {{ ok: boolean, contradictions: Array<{factId, why, match}>, corroborations: string[] }}
 */
export function crossCheckContent(text) {
  const t = String(text || '');
  const contradictions = [];
  for (const c of CONTRADICTIONS) {
    const m = t.match(c.re);
    if (m) contradictions.push({ factId: c.factId, why: c.why, match: m[0].slice(0, 120) });
  }
  const corroborations = [];
  // Figures may appear as '85 million' OR the ODA uppercase-suffix style '85M'.
  const mil = (n) => new RegExp(`\\b${n.replace('.', '\\.')}\\s?(?:million|M)\\b`, 'i');
  if (/third[-\s]largest/i.test(t) && /1\.46/.test(t)) corroborations.push('uae-donor-rank-2025');
  if (/2\.57/.test(t) && /gaza/i.test(t)) corroborations.push('uae-gaza-relief');
  if (mil('85').test(t) && /horn of africa|food.?insecur/i.test(t)) corroborations.push('horn-food-security-2025');
  if (mil('4.4').test(t) && /somalia/i.test(t)) corroborations.push('somalia-ipc-2025');
  if (mil('21.2').test(t) && /sudan/i.test(t)) corroborations.push('sudan-famine-2025');
  return { ok: contradictions.length === 0, contradictions, corroborations };
}

// ---------------------------------------------------------------------------
// Per-country reference file access (KE/MA/PK/… intel-seed ground truth)
// ---------------------------------------------------------------------------

const ISO_CODES = Object.freeze(['KE', 'MA', 'PK', 'RW', 'SD', 'EG', 'ID', 'YE', 'JO', 'SO', 'SY', 'UG', 'BD', 'ET', 'LB', 'TZ']);

/** Load a per-country reference JSON from the repo's intel-seed store. */
export function loadCountryReference(iso) {
  const code = String(iso || '').toUpperCase();
  if (!ISO_CODES.includes(code)) return null;
  const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'intel-seed', `${code}.json`);
  try { return JSON.parse(fs.readFileSync(base, 'utf8')); } catch { return null; }
}

export function listCountryReferences() {
  return ISO_CODES.map((iso) => ({ iso, available: loadCountryReference(iso) !== null }));
}
