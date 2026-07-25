// interpreter.js — GLM 4.7 low-latency request interpretation (MIGRATION_MAP M14).
// Emits STRUCTURED CONTROL JSON ONLY — no chain-of-thought exposure, no prose.
// The interpreter NEVER authors deliverable content: its output steers routing and
// is confirmed downstream by the relevant Sonnet 5 worker before it can affect any
// final output (the orchestrator passes control.intent into the worker brief, and
// the worker re-states its own understanding as part of the Thinker plan).
// Safe status labels only — the UI shows these while the run is being understood.
import { interpreterCall } from './models.js';
import { getManifest, listManifests, COMPAT_ROUTES } from './manifests.js';
import { validatePipeline, isEdgeAllowed } from './sequencing.js';

/** Safe, user-facing status labels (contracts.d.ts ODASafeStatus). */
export const SAFE_STATUSES = Object.freeze([
  'Understanding the request',
  'Gathering evidence',
  'Structuring the analysis',
  'Designing the deliverable',
  'Preparing your document',
  'Building the model',
  'Reviewing quality',
  'Translating the document',
]);

const SKILL_IDS = Object.freeze([
  'design', 'problem-solve', 'benchmark', 'data-scout', 'model', 'storyline', 'translate', 'media',
]);

const ARTIFACT_TYPES = Object.freeze([
  'workbook-md', 'issue-tree-svg', 'xlsx-model', 'xlsx-data', 'insight-pack-md', 'fast-facts-md',
  'benchmark-report-md', 'storyline-md', 'one-pager-summary', 'action-titles-md', 'deck-html',
  'deck-pptx', 'docx', 'pdf', 'media-bilingual-md', 'arabic-docx', 'arabic-pptx', 'image', 'markdown',
]);

const RENDERERS = Object.freeze(['workbook', 'deck', 'document', 'data', 'model', 'media', 'chat']);

/** System prompt: the interpreter is a router, not an author. Control JSON only. */
const INTERPRETER_SYSTEM_PROMPT = `You are the request interpreter for the ODA application (Office of Development Affairs, Abu Dhabi). You DO NOT answer the request. You DO NOT reveal reasoning. You emit EXACTLY ONE JSON object and nothing else — no prose, no markdown fences.

Shape:
{"intent": "<one sentence, what the user wants>",
 "mode": "fast"|"full",
 "primary_skill": one of ${JSON.stringify(SKILL_IDS)},
 "pipeline": [{"nodeId":"n1","skill":"<skill>","mode":"fast"|"full","dependsOn":[],"route":"SUMMARY"|"TITLES" (storyline only, optional),"objective":"<one line>"}, ...],
 "deliverables": subset of ${JSON.stringify(ARTIFACT_TYPES)},
 "workspace_renderer": one of ${JSON.stringify(RENDERERS)},
 "requires_user_gate": true|false,
 "safe_status": one of ${JSON.stringify(SAFE_STATUSES)},
 "confidence": 0.0-1.0,
 "clarifying_questions": [{"question":"<one focused question that materially changes the deliverable>","options":["<short answer option>","<short answer option>"],"why":"<one line why it matters>"}] (0-3 entries)}

Skill routing rules (from the bundle disambiguation matrix):
- Build/design a NEW branded deck, one-pager or asset → design. Condense an EXISTING deck/doc into the five-zone executive one-pager → storyline with route "SUMMARY". Title/re-title slides → storyline with route "TITLES".
- Work ONE problem to a recommendation (solve X, is X feasible, issue tree) → problem-solve. Scan comparable programmes worldwide / precedents / case studies → benchmark. Both wanted → problem-solve FIRST (confirm the problem definition), THEN benchmark scoped by it (benchmark dependsOn the problem-solve node).
- Country profiles / development data / statistics / "pull the numbers" → data-scout. Quantitative model / scoring matrix / scenarios → model.
- English→Arabic or Arabic QA → translate (the only Arabic skill; English is approved before Arabic starts).
- Press releases, media strategy, calendars, PR/crisis plans, launch kits → media (already bilingual EN-then-AR; never chain its Arabic to translate).
Pipeline sequencing (only these downstream edges are legal): problem-solve→storyline→design; benchmark→storyline→design; benchmark→problem-solve; problem-solve→benchmark; data-scout→problem-solve; problem-solve→data-scout→model→problem-solve; data-scout→model→design; storyline(SUMMARY)→translate; media→design; design→storyline(TITLES); translate last for final document layouts.
mode "full" when: Chairman/board/Presidential-Court-bound, multi-skill pipeline, campaign/launch package, the user asks for full/verified treatment, or a deck of 3+ slides. Otherwise "fast".
requires_user_gate true when mode is "full" (approval gates apply) or the request is ambiguous enough to need a confirmation.
Every quantitative deliverable implies a data-scout stage before the consuming skill (no-invent rule).
Clarifying questions: when mode is "full", ALWAYS emit 2-3 clarifying_questions — the questions whose answers most change the deliverable (audience, scope, length, emphasis, comparator set). Each question carries 2-4 SHORT tappable options covering the likely answers. When mode is "fast", emit at most 1 question and only if the request is genuinely ambiguous; otherwise emit [].`;

/**
 * Deterministic fallback interpretation — used when the GLM call fails or emits
 * unusable JSON, so interpretation NEVER hard-fails a run. Loudly flagged in the
 * result (source: 'heuristic') and pinned at low confidence.
 */
export function heuristicInterpret(text) {
  const t = String(text || '').toLowerCase();
  let skill = 'problem-solve';
  let route;
  if (/\b(action title|slide title|re-?title|fix this title|title this)\b/.test(t)) { skill = 'storyline'; route = 'TITLES'; }
  else if (/\b(exec(utive)? summary|one-?pager from|condense|summari[sz]e)\b/.test(t)) { skill = 'storyline'; route = 'SUMMARY'; }
  else if (/\b(translate|arabic|بالعربية|للعربية)\b/.test(t)) skill = 'translate';
  else if (/\b(press release|media statement|content calendar|crisis plan|launch kit|talking points|social post)\b/.test(t)) skill = 'media';
  else if (/\b(benchmark|case stud|precedent|worked elsewhere|comparable programme)\b/.test(t)) skill = 'benchmark';
  else if (/\b(country (profile|data)|fast facts|statistics|indicator|top \d+ countries|pull the numbers)\b/.test(t)) skill = 'data-scout';
  else if (/\b(scoring matrix|quantitative model|scenario|size.of.prize|sensitivity|business case model)\b/.test(t)) skill = 'model';
  else if (/\b(deck|slides?|presentation|one-?pager|briefing|design|lay ?out|mock)\b/.test(t)) skill = 'design';
  const full = /\b(chairman|board|presidential court|leadership|full treatment|verified|campaign|launch)\b/.test(t);
  const mode = full ? 'full' : 'fast';
  const node = { nodeId: 'n1', skill, mode, dependsOn: [], objective: String(text || '').slice(0, 200) };
  if (route) node.route = route;
  return {
    intent: String(text || '').slice(0, 240),
    mode,
    primary_skill: skill,
    pipeline: [node],
    deliverables: [defaultDeliverable(skill, route)],
    workspace_renderer: defaultRenderer(skill),
    requires_user_gate: mode === 'full',
    safe_status: 'Understanding the request',
    confidence: 0.3,
    // The heuristic never invents questions — only GLM has the judgement to ask.
    clarifying_questions: [],
  };
}

function defaultDeliverable(skill, route) {
  if (skill === 'storyline') return route === 'TITLES' ? 'action-titles-md' : route === 'SUMMARY' ? 'one-pager-summary' : 'storyline-md';
  return {
    design: 'deck-pptx', 'problem-solve': 'workbook-md', benchmark: 'benchmark-report-md',
    'data-scout': 'xlsx-data', model: 'xlsx-model', translate: 'arabic-docx', media: 'media-bilingual-md',
  }[skill] || 'markdown';
}

function defaultRenderer(skill) {
  return {
    design: 'deck', 'problem-solve': 'workbook', benchmark: 'document', 'data-scout': 'data',
    model: 'model', storyline: 'document', translate: 'document', media: 'media',
  }[skill] || 'chat';
}

/** Extract the first JSON object from raw model text (fences tolerated). */
function extractJson(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/**
 * Normalise + validate a raw control object into a legal ODAControlJSON.
 * Coerces enums, resolves compat skill ids, and validates the pipeline against
 * the sequencing rules — an illegal pipeline falls back to a single-node plan
 * on the primary skill (never ships an invalid graph).
 */
export function normaliseControl(raw, requestText) {
  if (!raw || typeof raw !== 'object') return heuristicInterpret(requestText);
  const c = { ...raw };
  // Resolve compat ids (summary / action-titles) into storyline routes.
  const resolveSkill = (s) => {
    if (COMPAT_ROUTES[s]) return { skill: COMPAT_ROUTES[s].skill, route: COMPAT_ROUTES[s].route };
    return { skill: s, route: undefined };
  };
  const prim = resolveSkill(String(c.primary_skill || ''));
  c.primary_skill = SKILL_IDS.includes(prim.skill) ? prim.skill : heuristicInterpret(requestText).primary_skill;
  c.mode = c.mode === 'full' ? 'full' : 'fast';
  c.intent = typeof c.intent === 'string' && c.intent.trim() ? c.intent.trim().slice(0, 400) : String(requestText || '').slice(0, 240);
  // Pipeline normalisation.
  let pipeline = Array.isArray(c.pipeline) ? c.pipeline : [];
  pipeline = pipeline
    .filter((n) => n && typeof n === 'object')
    .map((n, i) => {
      const rs = resolveSkill(String(n.skill || ''));
      const node = {
        nodeId: typeof n.nodeId === 'string' && n.nodeId ? n.nodeId : `n${i + 1}`,
        skill: rs.skill,
        mode: n.mode === 'full' ? 'full' : c.mode,
        dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn.filter((d) => typeof d === 'string') : [],
        objective: typeof n.objective === 'string' ? n.objective.slice(0, 300) : undefined,
      };
      const route = n.route || rs.route;
      if (route === 'SUMMARY' || route === 'TITLES') node.route = route;
      return node;
    })
    .filter((n) => SKILL_IDS.includes(n.skill));
  if (!pipeline.length) pipeline = [{ nodeId: 'n1', skill: c.primary_skill, mode: c.mode, dependsOn: [], objective: c.intent }];
  try {
    validatePipeline(pipeline);
  } catch (err) {
    // Illegal graph from the interpreter → single-node fallback on the primary skill.
    console.warn(`[oda-interpreter] pipeline rejected by sequencing rules — falling back to single node: ${err.message}`);
    pipeline = [{ nodeId: 'n1', skill: c.primary_skill, mode: c.mode, dependsOn: [], objective: c.intent }];
  }
  c.pipeline = pipeline;
  c.deliverables = (Array.isArray(c.deliverables) ? c.deliverables : []).filter((d) => ARTIFACT_TYPES.includes(d));
  if (!c.deliverables.length) c.deliverables = [defaultDeliverable(c.primary_skill, pipeline[0]?.route)];
  // A "deck" always renders as PPTX, never HTML. Coerce here so BOTH the GLM
  // interpreter and the heuristic fallback yield deck-pptx (product rule).
  c.deliverables = c.deliverables.map((d) => (d === 'deck-html' ? 'deck-pptx' : d));
  c.workspace_renderer = RENDERERS.includes(c.workspace_renderer) ? c.workspace_renderer : defaultRenderer(c.primary_skill);
  c.requires_user_gate = typeof c.requires_user_gate === 'boolean' ? c.requires_user_gate : c.mode === 'full';
  c.safe_status = SAFE_STATUSES.includes(c.safe_status) ? c.safe_status : 'Understanding the request';
  const conf = Number(c.confidence);
  c.confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5;
  // Clarifying questions (AUDIT RC-5): sanitise to at most 3 questions, each
  // with at most 4 short tappable options — malformed entries are dropped, not
  // repaired, so downstream consumers can trust the shape.
  c.clarifying_questions = Array.isArray(c.clarifying_questions) ? c.clarifying_questions.filter(q => q && typeof q.question === 'string' && q.question.trim()).slice(0, 3).map(q => ({ question: q.question.trim().slice(0, 300), options: Array.isArray(q.options) ? q.options.filter(o => typeof o === 'string' && o.trim()).slice(0, 4).map(o => o.trim().slice(0, 120)) : [], why: typeof q.why === 'string' ? q.why.trim().slice(0, 200) : null })) : [];
  return c;
}

// ---------------------------------------------------------------------------
// Explicit Output selection → HARD deliverable-class constraint (2026-07-24).
// The sidebar Output dropdown (deck/document/data/model) is a user command, not
// a hint. It must deterministically decide the deliverable CLASS — a "Document"
// request may never terminate in a deck (design), and a "Deck" request must end
// in design. Both the GLM prompt (soft steer) and this post-validation guard
// (hard enforcement) apply, so the class holds even when GLM disobeys.
// ---------------------------------------------------------------------------

const DECK_ARTIFACT_TYPES = Object.freeze(['deck-html', 'deck-pptx', 'arabic-pptx']);
const DATA_ARTIFACT_TYPES = Object.freeze(['xlsx-model', 'xlsx-data']);

/** Resolve the requested output class. Only 'deck' | 'document' | 'auto' — the
 *  Data/Model standalone outputs were removed (data-scout/model remain as
 *  in-pipeline stages). 'auto' is resolved to deck-or-document downstream. */
export function resolveOutputClass(output, text) {
  const o = String(output || '').toLowerCase();
  if (['deck', 'document', 'data', 'model'].includes(o)) return o;
  const m = String(text || '').match(/output:\s*(deck|document|data|model)/i);
  return m ? m[1].toLowerCase() : 'auto';
}

/** Lightweight deck-vs-document decision for Output=Auto, read from the GLM
 *  interpreter's own routing (a deck if it designs/renders a deck, else a doc). */
function deriveClassFromControl(c) {
  const deckish = c.workspace_renderer === 'deck'
    || c.primary_skill === 'design'
    || (Array.isArray(c.deliverables) && c.deliverables.some((d) => DECK_ARTIFACT_TYPES.includes(d)));
  return deckish ? 'deck' : 'document';
}

/** The terminal node of a pipeline (nothing depends on it; last one wins). */
function terminalOf(pipeline) {
  const depended = new Set(pipeline.flatMap((n) => n.dependsOn || []));
  const terminals = pipeline.filter((n) => !depended.has(n.nodeId));
  return terminals[terminals.length - 1] || pipeline[pipeline.length - 1] || null;
}

const nextNodeId = (pipeline) => {
  let i = pipeline.length + 1;
  const ids = new Set(pipeline.map((n) => n.nodeId));
  while (ids.has(`n${i}`)) i += 1;
  return `n${i}`;
};

/** Coerce the deliverables list to the requested class (display + contract). */
function coerceDeliverables(deliverables, cls, pipeline) {
  let d = (Array.isArray(deliverables) ? deliverables : []).filter((x) => ARTIFACT_TYPES.includes(x));
  if (cls === 'document') {
    // The final document always ships as a PDF — label it honestly so the live
    // card matches the download, regardless of the terminal skill's native type.
    d = ['pdf'];
  } else if (cls === 'deck') {
    d = ['deck-pptx'];
  } else if (cls === 'data') {
    d = ['xlsx-data'];
  } else if (cls === 'model') {
    d = ['xlsx-model'];
  }
  return d;
}

/** GLM prompt preamble that steers routing toward the requested class. */
function outputConstraintPrompt(cls) {
  switch (cls) {
    case 'document':
      return 'OUTPUT CONSTRAINT (mandatory): the user requires a DOCUMENT — a multi-page written report (delivered as PDF), NOT a slide deck. The pipeline MUST terminate in a document-authoring skill (problem-solve, benchmark, storyline, data-scout or media). Do NOT use "design" as the final step and do NOT emit deck-html/deck-pptx deliverables. Set workspace_renderer to "document".\n\n';
    case 'deck':
      return 'OUTPUT CONSTRAINT (mandatory): the user requires a DECK — a slide presentation (delivered as PPTX). The pipeline MUST terminate in the "design" skill and deliverables MUST include deck-pptx. Set workspace_renderer to "deck".\n\n';
    case 'data':
      return 'OUTPUT CONSTRAINT (mandatory): the user requires a DATA deliverable — a cited Excel dataset. Keep it LIGHT — a single quick data pass gathering only the key figures/series, NO deep research. Terminate in data-scout with an xlsx-data deliverable.\n\n';
    case 'model':
      return 'OUTPUT CONSTRAINT (mandatory): the user requires a quantitative MODEL — an Excel model. Keep it LIGHT — a single quick pass with the essential inputs/scenarios, NO deep research. Terminate in the "model" skill with an xlsx-model deliverable.\n\n';
    default:
      return '';
  }
}

/**
 * Deterministically force a control's deliverable class to match the explicit
 * Output selection. Runs AFTER normalisation (or on the heuristic control), and
 * re-validates the rewritten pipeline — any illegal rewrite falls back to a safe
 * single-node plan rather than shipping a broken graph.
 */
export function enforceOutputClass(control, outputClass) {
  if (!control || outputClass === 'auto') return control;
  // Mutates the control in place (no field-by-field rebuild), so fields it does
  // not touch — notably clarifying_questions — survive every class branch.
  const c = control;
  const mode = c.mode === 'full' ? 'full' : 'fast';
  const intent = c.intent || '';
  let p = (Array.isArray(c.pipeline) ? c.pipeline : []).map((n) => ({ ...n, dependsOn: [...(n.dependsOn || [])] }));

  const safeValidate = (candidate, fallback) => {
    try { validatePipeline(candidate); return candidate; }
    catch { return fallback; }
  };

  if (outputClass === 'document') {
    // A document is never a deck — drop design nodes and any dangling deps.
    p = p.filter((n) => n.skill !== 'design');
    const ids = new Set(p.map((n) => n.nodeId));
    p.forEach((n) => { n.dependsOn = n.dependsOn.filter((d) => ids.has(d)); });
    if (!p.length) p = [{ nodeId: 'n1', skill: 'problem-solve', mode, dependsOn: [], objective: intent }];
    // A spreadsheet terminal (model) is not a document: synthesise one from it
    // (model → problem-solve is a legal edge).
    const term = terminalOf(p);
    if (term && term.skill === 'model') {
      p.push({ nodeId: nextNodeId(p), skill: 'problem-solve', mode, dependsOn: [term.nodeId], objective: intent });
    }
    const docPrimary = c.primary_skill === 'design' ? 'problem-solve' : c.primary_skill;
    c.pipeline = safeValidate(p, [{ nodeId: 'n1', skill: docPrimary, mode, dependsOn: [], objective: intent }]);
    // DEPTH controls thoroughness: FAST → a compressed pass; FULL → the deep
    // multi-step chain above. ROOT_CAUSES Problem 1 fix (2026-07-25): FAST no
    // longer deletes a planned Evidence stage — when the interpreter's own plan
    // included data-scout AND the terminal legally consumes it, FAST keeps a
    // two-node evidence → author pipeline (compressed EXTRACT, no invented
    // figures). Only evidence-free plans collapse to a single authoring node.
    if (mode === 'fast') {
      const t = terminalOf(c.pipeline);
      const terminalSkill = t?.skill || docPrimary || 'problem-solve';
      const hadEvidenceNode = c.pipeline.some((n) => n.skill === 'data-scout' || n.skill === 'benchmark');
      const evidenceEdgeLegal = terminalSkill === 'problem-solve' || terminalSkill === 'model'; // data-scout→problem-solve / data-scout→model
      if (hadEvidenceNode && evidenceEdgeLegal) {
        c.pipeline = [
          { nodeId: 'n1', skill: 'data-scout', mode, dependsOn: [], objective: intent },
          { nodeId: 'n2', skill: terminalSkill, mode, dependsOn: ['n1'], objective: intent },
        ];
      } else {
        c.pipeline = [{ nodeId: 'n1', skill: terminalSkill, mode, dependsOn: [], objective: intent }];
      }
    }
    c.primary_skill = c.pipeline[0].skill;
    c.deliverables = coerceDeliverables(c.deliverables, 'document', c.pipeline);
    c.workspace_renderer = 'document';
  } else if (outputClass === 'deck') {
    // DEPTH controls thoroughness (not Output): FAST → a single design node (one
    // authoring pass); FULL → an evidence-backed MULTI-STEP deck. In FULL we keep
    // the interpreter's chain if it already ends in design, else build the
    // canonical data-scout → model → design pipeline.
    const CANONICAL_DECK = [
      { nodeId: 'n1', skill: 'data-scout', mode, dependsOn: [], objective: intent },
      { nodeId: 'n2', skill: 'model', mode, dependsOn: ['n1'], objective: intent },
      { nodeId: 'n3', skill: 'design', mode, dependsOn: ['n2'], objective: intent },
    ];
    if (mode === 'full') {
      const endsDesign = p.length >= 2 && terminalOf(p)?.skill === 'design';
      c.pipeline = safeValidate(endsDesign ? p : CANONICAL_DECK, CANONICAL_DECK);
    } else {
      c.pipeline = [{ nodeId: 'n1', skill: 'design', mode, dependsOn: [], objective: intent }];
    }
    c.primary_skill = c.pipeline[0].skill;
    c.deliverables = coerceDeliverables(c.deliverables, 'deck', c.pipeline);
    c.workspace_renderer = 'deck';
  } else if (outputClass === 'data' || outputClass === 'model') {
    // LIGHT by design: a single FAST node gathers the essentials, then the
    // terminal tool builds the .xlsx. No deep multi-stage research, regardless of
    // the Depth setting (data/model are meant to be quick).
    const skill = outputClass === 'model' ? 'model' : 'data-scout';
    c.pipeline = [{ nodeId: 'n1', skill, mode: 'fast', dependsOn: [], objective: intent }];
    c.primary_skill = skill;
    c.mode = 'fast';
    c.deliverables = coerceDeliverables(c.deliverables, outputClass, c.pipeline);
    c.workspace_renderer = outputClass === 'model' ? 'model' : 'data';
  }
  return c;
}

/**
 * Interpret a request via GLM 4.7 (low latency, control JSON only), with the
 * deterministic heuristic as the never-fail fallback. The explicit Output
 * selection steers the GLM prompt AND is hard-enforced on the result.
 * @returns {{ control: object, source: 'glm-4.7'|'heuristic', rawLength: number }}
 */
export async function interpretRequest({ sessionId, text, attachmentsSummary = '', output = 'auto', depth = null }) {
  const requested = resolveOutputClass(output, text); // 'deck' | 'document' | 'auto'
  const constraint = outputConstraintPrompt(requested); // '' for auto — let GLM decide
  const body = attachmentsSummary
    ? `REQUEST:\n${text}\n\nATTACHMENTS (summaries):\n${attachmentsSummary}`
    : `REQUEST:\n${text}`;
  const query = `${constraint}${body}`;
  // Auto → resolve deck-vs-document from the interpreter's own routing, then
  // shape the pipeline for that class; explicit deck/document is honoured as-is.
  // The explicit Depth selection is a user command, not a hint: it overrides the
  // interpreter's mode BEFORE enforceOutputClass (which reads mode to decide
  // between single-pass and multi-node pipelines), so both the GLM and the
  // heuristic paths honour it identically.
  const finalize = (control, source, rawLength) => {
    if (depth === 'full' || depth === 'fast') {
      control.mode = depth;
      control.requires_user_gate = depth === 'full';
      if (Array.isArray(control.pipeline)) control.pipeline.forEach((n) => { n.mode = depth; });
    }
    const cls = requested === 'auto' ? deriveClassFromControl(control) : requested;
    return { control: enforceOutputClass(control, cls), source, rawLength, outputClass: cls };
  };
  try {
    const raw = await interpreterCall({ sessionId, query, systemPrompt: INTERPRETER_SYSTEM_PROMPT });
    const parsed = extractJson(raw);
    if (!parsed) {
      console.warn('[oda-interpreter] GLM output carried no parseable JSON — heuristic fallback engaged');
      return finalize(heuristicInterpret(text), 'heuristic', (raw || '').length);
    }
    return finalize(normaliseControl(parsed, text), 'glm-4.7', raw.length);
  } catch (err) {
    console.warn(`[oda-interpreter] GLM interpretation failed (${err.message}) — heuristic fallback engaged`);
    return finalize(heuristicInterpret(text), 'heuristic', 0);
  }
}

export { INTERPRETER_SYSTEM_PROMPT };
