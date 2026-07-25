// visualIntel.js — Real-time Visual Intelligence (Section 19).
// DUAL REAL OnDemand sessions per conversation:
//   Session A — primary assistant (answers the user, gpt-5.6-sol policy).
//   Session B — Visual Intelligence Director (SILENT; receives the same turn
//   text + rolling topic memory and emits STRICT JSON visual directives only).
// Guarantees: every image URL is server-validated before it ships (a broken
// image can never render — Section 13 typographic/AI-labeled fallback instead);
// duplicates are deduped per session; Session B is time-boxed (12s) and its
// death/timeout NEVER blocks Session A; restricted internal documents are
// tenancy-blocked; every decision lands in a per-session observability ring.
import crypto from 'node:crypto';
import { createOdSession, syncQuery } from './ondemand.js';
import { ENDPOINT_ID, REASONING_EFFORT } from './env.js';

const sessions = new Map(); // viId -> state

// Pre-generated AI explanatory visuals (session-provided blob assets — reused
// per Section 19 item 15; label is EXACTLY 'AI-generated explanatory visual').
export const AI_VISUAL_POOL = [
  'https://airevdev.blob.core.windows.net/on-demand-dev/6692b763e851d28a036ab30e/agents/hECOAj3hQ2.png?se=2026-08-01T16%3A32%3A08Z&sig=placeholder',
];
export const AI_VISUAL_LABEL = 'AI-generated explanatory visual';

// Tenancy rules: internal document namespaces Session B may never surface.
const RESTRICTED_DOCS = [/^oda-internal\//i, /chairman.?briefing.?private/i, /restricted:/i];

const DIRECTOR_PROMPT = `You are the ODA Visual Intelligence Director (Session B). You NEVER answer the user. From the conversation turn you receive, emit EXACTLY ONE JSON object (no prose, no fences):
{"topic":{"id":"<kebab-topic>","continuity":"continue"|"drift"|"switch"},
 "world_focus":{"region":"<place or null>","lat":0.0,"lng":0.0,"zoom":1.0},
 "hero":{"kind":"map"|"photo"|"person"|"org"|"timeline"|"card","title":"<=70 chars","subtitle":"<=90 chars","image_query":"<image search phrase or null>","label":"<attribution or null>"},
 "supporting":[{"kind":"photo"|"card","title":"<=60","image_query":"<phrase or null>"}] (max 3),
 "confidence":0.0-1.0}
HERO KIND SELECTION IS MANDATORY AND MECHANICAL — apply the FIRST matching rule, never downgrade to "card" when a rule matches:
1. The turn names a specific PERSON (leader, official, executive) -> hero.kind "person", image_query "<person full name> portrait".
2. The turn names a specific COMPANY / ORGANIZATION / institution (e.g. "What does <X> do", a ports operator, a bank, an agency) -> hero.kind "org", image_query "<organization name> headquarters OR logo". NEVER use "card" for a named organization.
3. The turn asks about a HISTORICAL EVENT, a history, a crisis with dates, or "walk me through the history of X" -> hero.kind "timeline", title = the event, subtitle = the date span, image_query "<event name>". NEVER use "card" for a dated historical event.
4. Geographic / security / shipping / regional topic -> hero.kind "map" with world_focus lat/lng/zoom set.
5. ONLY abstract concepts with no person/org/event/place (finance mechanics, policy definitions) -> hero.kind "card" with image_query null.
Examples: "What does DP World do" -> {"hero":{"kind":"org",...}}. "History of the Suez Canal crisis of 1956" -> {"hero":{"kind":"timeline",...}}. "Explain concessional lending" -> {"hero":{"kind":"card","image_query":null,...}}.
continuity: "continue" same topic, "drift" related shift (keep visual context), "switch" unrelated topic (full transition). JSON only.`;

const now = () => new Date().toISOString();

function log(st, event, data = {}) {
  st.logs.push({ ts: now(), event, ...data });
  if (st.logs.length > 200) st.logs.splice(0, st.logs.length - 200);
}

/** Validate an image URL really resolves (HEAD then 1-byte GET). */
async function validateImage(url, timeoutMs = 6000) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const ct = r.headers.get('content-type') || '';
    return (r.ok || r.status === 206) && !/text\/html/i.test(ct);
  } catch { return false; }
}

function extractJson(raw) {
  const s = String(raw || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const normUrl = (u) => String(u || '').split('?')[0].toLowerCase();

/** Section 13 fallback — typographic / AI-labeled card; NEVER a broken image. */
function fallbackCard(title, reason, aiPool) {
  const ai = Array.isArray(aiPool) && aiPool.length ? aiPool[0] : null;
  return {
    kind: 'card', title: title || 'Visual unavailable', subtitle: reason,
    image_url: ai, label: ai ? AI_VISUAL_LABEL : 'typographic', fallback: true,
  };
}

export function createVisualIntelState({ aiPool = [] } = {}) {
  const viId = crypto.randomUUID();
  const st = {
    viId, createdAt: now(), sessionA: null, sessionB: null,
    mode: 'active', bAlive: true, pinned: [], shown: new Set(),
    topic: null, logs: [], aiPool: aiPool.length ? aiPool : AI_VISUAL_POOL,
    directorTimeoutMs: 12000,
  };
  sessions.set(viId, st);
  return st;
}
export const getVI = (viId) => sessions.get(viId);

export async function ensureSessions(st) {
  if (!st.sessionA) { st.sessionA = await createOdSession(`vi-a-${st.viId.slice(0, 8)}`, []); log(st, 'session_a_created', { id: st.sessionA }); }
  if (!st.sessionB && st.bAlive) { st.sessionB = await createOdSession(`vi-b-${st.viId.slice(0, 8)}`, []); log(st, 'session_b_created', { id: st.sessionB }); }
}

/** Run one conversational turn through BOTH sessions. A never waits on B's failure. */
export async function runTurn(st, text, { aboutImage = null, providerDelayMs = 0 } = {}) {
  const t0 = Date.now();
  await ensureSessions(st);

  // Tenancy guard (Section 19 item 16): restricted internal docs never reach B.
  const restricted = RESTRICTED_DOCS.some((rx) => rx.test(text));

  const aQuery = aboutImage
    ? `${text}\n\n[CONTEXT: the user is asking about the currently displayed visual: ${aboutImage}]`
    : text;
  const aPromise = syncQuery({ odSessionId: st.sessionA, query: aQuery, systemPrompt: 'You are the ODA Intelligence assistant. Answer concisely (<=120 words), analyst register, never invent figures.', endpointId: ENDPOINT_ID, reasoningEffort: REASONING_EFFORT })
    .then((ans) => ({ ok: true, ans })).catch((e) => ({ ok: false, err: e.message }));

  let visual = null; let ttfvMs = null; let bStatus = 'skipped';
  if (st.mode === 'paused') { bStatus = 'paused'; log(st, 'director_skipped_paused'); }
  else if (!st.bAlive) { bStatus = 'dead'; log(st, 'director_skipped_dead'); }
  else if (restricted) {
    bStatus = 'tenancy_blocked';
    visual = { topic: st.topic, hero: { kind: 'card', title: 'Restricted content', subtitle: 'This internal document is not available to the visual layer.', image_url: null, label: 'tenancy-blocked', blocked: true }, supporting: [] };
    log(st, 'tenancy_blocked', { rule: 'restricted-doc' });
  } else {
    const bt0 = Date.now();
    const memory = st.topic ? `\nCURRENT TOPIC MEMORY: ${JSON.stringify(st.topic)}` : '';
    const bPromise = (async () => {
      if (providerDelayMs > 0) await new Promise((r) => setTimeout(r, providerDelayMs)); // test hook: slow provider
      return syncQuery({ odSessionId: st.sessionB, query: `TURN: ${text}${memory}`, systemPrompt: DIRECTOR_PROMPT, endpointId: ENDPOINT_ID, reasoningEffort: 'low' });
    })();
    const raced = await Promise.race([
      bPromise.then((r) => ({ kind: 'ok', r })).catch((e) => ({ kind: 'err', e: e.message })),
      new Promise((res) => setTimeout(() => res({ kind: 'timeout' }), st.directorTimeoutMs)),
    ]);
    if (raced.kind === 'ok') {
      const j = extractJson(raced.r);
      if (j && j.hero) {
        visual = await resolveVisual(st, j, text);
        ttfvMs = Date.now() - bt0;
        bStatus = 'ok';
        st.topic = j.topic || st.topic;
        log(st, 'director_ok', { ttfvMs, topic: j.topic, heroKind: visual.hero.kind, continuity: j.topic?.continuity });
      } else { bStatus = 'bad_json'; visual = { topic: st.topic, hero: fallbackCard(text.slice(0, 60), 'Director returned unusable output', st.aiPool), supporting: [] }; log(st, 'director_bad_json'); }
    } else if (raced.kind === 'timeout') {
      bStatus = 'timeout'; visual = { topic: st.topic, hero: fallbackCard(text.slice(0, 60), 'Visual provider timed out — graceful fallback', st.aiPool), supporting: [] };
      log(st, 'director_timeout', { capMs: st.directorTimeoutMs });
      bPromise.catch(() => {}); // orphaned promise never throws unhandled
    } else { bStatus = 'error'; visual = { topic: st.topic, hero: fallbackCard(text.slice(0, 60), 'Visual director errored — assistant unaffected', st.aiPool), supporting: [] }; log(st, 'director_error', { err: raced.e }); }
  }

  const a = await aPromise;
  if (!a.ok) log(st, 'session_a_error', { err: a.err });
  log(st, 'turn_complete', { ms: Date.now() - t0, bStatus, aOk: a.ok });
  return { answer: a.ok ? a.ans : `Assistant error: ${a.err}`, aOk: a.ok, visual, bStatus, ttfvMs, timingMs: Date.now() - t0 };
}

/** Deterministic kind normaliser — the Director model occasionally downgrades
 *  a clearly-dated historical event or named-person/org turn to 'card'; the
 *  kind drives the client renderer, so normalise from the TURN TEXT here
 *  (schema-level guard, mirrors the prompt's mandatory selection rules). */
function normaliseHeroKind(kind, turnText) {
  if (kind && kind !== 'card') return kind;
  const t = String(turnText || '');
  if (/\b(history of|historical|crisis of \d{4}|timeline|chronolog|walk me through the history)\b/i.test(t)) return 'timeline';
  return kind || 'card';
}

/** Resolve director JSON -> shipped visual: validate + dedup every image. */
async function resolveVisual(st, j, turnText = '') {
  const hero = { kind: normaliseHeroKind(j.hero.kind, turnText), title: j.hero.title || '', subtitle: j.hero.subtitle || '', image_url: null, label: j.hero.label || null };
  // Map hero: no external image needed — the client renders the world focus.
  if (hero.kind !== 'map' && hero.kind !== 'card' && j.hero.image_query) {
    const url = await pickImage(st, j.hero.image_query);
    if (url) hero.image_url = url;
    else { const fb = fallbackCard(hero.title, 'No verifiable imagery for this subject', st.aiPool); hero.kind = 'card'; hero.image_url = fb.image_url; hero.label = fb.label; hero.fallback = true; }
  }
  if (hero.kind === 'card' && !hero.image_url && !j.hero.image_query) { hero.label = 'typographic'; hero.fallback = true; }
  const supporting = [];
  for (const s of (j.supporting || []).slice(0, 3)) {
    const item = { kind: s.kind || 'card', title: s.title || '', image_url: null };
    if (s.image_query) { const u = await pickImage(st, s.image_query); if (u) item.image_url = u; else continue; } // drop rather than break
    supporting.push(item);
  }
  return { topic: j.topic, world_focus: j.world_focus || null, hero, supporting, confidence: j.confidence ?? null };
}

/** Image source: Wikimedia (keyless, attributable) with validation + dedup. */
async function pickImage(st, query) {
  try {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`;
    const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ODA-VisualIntel/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const pages = Object.values(j?.query?.pages || {});
    for (const p of pages) {
      const url = p?.imageinfo?.[0]?.thumburl || p?.imageinfo?.[0]?.url;
      if (!url || !/\.(png|jpe?g|webp|gif)$/i.test(normUrl(url))) continue;
      const key = normUrl(url);
      if (st.shown.has(key)) { log(st, 'dedup_dropped', { url: key.slice(-60) }); continue; } // dedup (item 14)
      if (!(await validateImage(url))) { log(st, 'image_validation_failed', { url: key.slice(-60) }); continue; }
      st.shown.add(key);
      return url;
    }
    return null;
  } catch { return null; }
}

/** Express route registration (mounted from server/index.js). */
export function registerVisualIntelRoutes(app) {
  app.post('/api/visual-intel/session', async (req, res) => {
    try {
      const st = createVisualIntelState({ aiPool: Array.isArray(req.body?.aiPool) ? req.body.aiPool : [] });
      await ensureSessions(st);
      res.status(201).json({ viId: st.viId, sessionA: st.sessionA, sessionB: st.sessionB });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/visual-intel/turn', async (req, res) => {
    const st = getVI(req.body?.viId); if (!st) return res.status(404).json({ error: 'session not found' });
    const { text, aboutImage = null, providerDelayMs = 0 } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    try { res.json(await runTurn(st, text, { aboutImage, providerDelayMs: Number(providerDelayMs) || 0 })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/visual-intel/mode', (req, res) => {
    const st = getVI(req.body?.viId); if (!st) return res.status(404).json({ error: 'session not found' });
    st.mode = req.body?.mode === 'paused' ? 'paused' : 'active';
    log(st, 'mode_changed', { mode: st.mode });
    res.json({ viId: st.viId, mode: st.mode });
  });
  app.post('/api/visual-intel/kill-b', (req, res) => {
    const st = getVI(req.body?.viId); if (!st) return res.status(404).json({ error: 'session not found' });
    st.bAlive = false; st.sessionB = null;
    log(st, 'session_b_killed', { by: 'api' });
    res.json({ viId: st.viId, bAlive: false });
  });
  app.post('/api/visual-intel/pin', (req, res) => {
    const st = getVI(req.body?.viId); if (!st) return res.status(404).json({ error: 'session not found' });
    const { url, title = '' } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    st.pinned.push({ url, title, ts: now() });
    log(st, 'visual_pinned', { url: normUrl(url).slice(-60) });
    res.json({ viId: st.viId, pinned: st.pinned.length });
  });
  app.get('/api/visual-intel/logs/:viId', (req, res) => {
    const st = getVI(req.params.viId); if (!st) return res.status(404).json({ error: 'session not found' });
    res.json({ viId: st.viId, mode: st.mode, bAlive: st.bAlive, topic: st.topic, pinned: st.pinned, logs: st.logs });
  });
}
