// liveDeck.js — GLM 4.7 SLIDE DIRECTOR (live-render upgrade, 2026-07-22).
// Translates REAL run events into patches for the pre-cooked four-slide
// template. HARD RULE (M5): a slide.update is only ever emitted from inside a
// real event hook — there are NO timers, NO setInterval, NO simulated
// progress anywhere in this module. GLM 4.7 (interpreter role) condenses real
// artifact excerpts into slide copy; it never authors deliverable content.
import { emitRunEvent } from './events.js';

// ---------------------------------------------------------------------------
// 2026-07-23 evidence-quality fix: meta/status lines from a draft's own
// process headers ('Status: source content not received', '[VERIFY AGAINST
// WAM — …]', 'verification … remains open') are NOT evidence. Single source
// of truth for what may render on card 02 / slide 2.
const EVIDENCE_META_RE = [
  /source content not received/i,
  /remains open/i,
  /verification[^.]*pending/i,
  /^\s*\[?doc\]?\s*status[:\s]/i,
  /^status[:\s]/i,
  /not provided/i,
  /no attachments?/i,
  /verify against wam/i,
  /pending source citation/i,
  /no external evidence/i,
  /awaiting (?:source|content|input)/i,
  /placeholder/i,
  /to be (?:confirmed|verified|added)/i,
  /source document/i,
];

/** True only for substantive, subject-matter evidence text. */
export const isSubstantiveEvidence = (s) => {
  const t = String(s || '').trim();
  return t.length >= 10 && !EVIDENCE_META_RE.some((re) => re.test(t));
};

/** Slide ownership: 1 understanding · 2 evidence · 3 core findings · 4 actions. */
export const SLIDE_MAP = Object.freeze({ interpret: 1, evidence: 2, core: 3, actions: 4 });

const KINDS = ['headline', 'evidence', 'core', 'actions'];
const KICKERS = ['Understanding', 'Evidence & analysis', 'Core findings', 'Recommendations & next steps'];

/** Initialise the pre-cooked scaffold on the run (plain data — persists). */
export function initLiveDeck(run) {
  run.liveDeck = {
    slides: [1, 2, 3, 4].map((no) => ({
      no,
      kind: KINDS[no - 1],
      kicker: KICKERS[no - 1],
      title: '',
      bullets: [],
      status: 'pending',
      confidence: null,
    })),
  };
  return run.liveDeck;
}

export function getLiveDeck(run) {
  return run.liveDeck || null;
}

const clip = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Extract the first JSON object from raw model text (fences tolerated). */
function extractJson(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/```(?:json)?/gi, '');
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { return null; }
}

const DIRECTOR_SYSTEM_PROMPT = 'You are the ODA slide director. From the artifact excerpt, emit ONLY JSON '
  + '{"slide3":{"title":"<=80 chars core finding","bullets":["<=90 chars", "...max 4"]},'
  + '"slide4":{"title":"<=80 chars recommendation headline","bullets":["...max 4"]},"confidence":0.0-1.0}. '
  + 'Use only what is IN the excerpt — never invent figures or names. No prose, no fences.';

/**
 * Build the director hook set for a run. Every hook mutates run.liveDeck from
 * REAL state, emits slide.update frames, and persists via the injected fn.
 * @param {object} run
 * @param {{persist?: Function}} [opts]
 */
export function directorHooks(run, { persist = () => {} } = {}) {
  if (!run.liveDeck) initLiveDeck(run);
  const slide = (no) => run.liveDeck.slides[no - 1];

  const patchSlide = (no, patch) => {
    Object.assign(slide(no), patch);
    emitRunEvent(run, 'slide.update', { slideNo: no, patch });
    persist();
  };

  return {
    /** Slide 1 fills from the REAL GLM interpretation (request.interpreted). */
    onInterpreted(control) {
      patchSlide(1, {
        title: clip(control.intent, 90),
        bullets: [
          `Mode: ${String(control.mode || 'fast').toUpperCase()}`,
          `Primary skill: ${control.primary_skill}`,
          `Deliverables: ${(control.deliverables || []).join(', ') || '—'}`,
        ],
        status: 'filling',
        confidence: typeof control.confidence === 'number' ? control.confidence : null,
      });
    },

    /** Slide 1 finalises. ROOT_CAUSES Problem 1 fix (2026-07-25): slide 4
     *  ("Recommendations & next steps") is NO LONGER pre-filled with the
     *  pipeline plan at planning time — recommendations content only ever
     *  comes from the TERMINAL node's artifact (see onArtifactPreview), so the
     *  card can never suggest analysis completed before it ran. */
    onPipelineSelected() {
      patchSlide(1, { status: 'final' });
    },

    /** Slide 2 appends REAL evidence items (cap 6, FIFO). */
    onEvidence(item) {
      if (!isSubstantiveEvidence(item.claim)) return; // meta/status lines never render
      const s = slide(2);
      const bullets = [...s.bullets, `[${item.tag}] ${clip(item.claim, 120)}`].slice(-6);
      patchSlide(2, { title: 'Evidence gathered live', bullets, status: 'filling' });
    },

    /**
     * THE GLM DIRECTOR CALL: condense a REAL artifact excerpt into slide 3+4
     * copy. On any parse/call failure, derive deterministic patches from the
     * artifact itself — never fabricated content.
     */
    async onArtifactPreview(artifact, { interpreterCall, sessionId } = {}) {
      const excerpt = clip(artifact.content || artifact.preview || '', 3000);
      if (!excerpt) return;
      let s3 = null; let s4 = null; let conf = null;
      if (typeof interpreterCall === 'function' && sessionId) {
        try {
          const raw = await interpreterCall({ sessionId, query: excerpt, systemPrompt: DIRECTOR_SYSTEM_PROMPT });
          const j = extractJson(raw);
          if (j) {
            s3 = j.slide3 || null;
            s4 = j.slide4 || null;
            conf = Number.isFinite(Number(j.confidence)) ? Math.min(1, Math.max(0, Number(j.confidence))) : null;
          }
        } catch (err) {
          console.warn(`[oda-live] GLM director call failed (${err.message}) — deriving from artifact`);
        }
      }
      if (!s3) {
        // Deterministic derivation from the REAL artifact (no invention).
        const lines = String(artifact.content || artifact.preview || '')
          .split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).filter((l) => l.length > 8);
        s3 = { title: clip(artifact.title, 80), bullets: lines.slice(0, 3).map((l) => clip(l, 90)) };
      }
      patchSlide(3, {
        title: clip(s3.title || artifact.title, 80),
        bullets: (s3.bullets || []).slice(0, 4).map((b) => clip(b, 90)),
        status: 'filling',
        ...(conf != null ? { confidence: conf } : {}),
      });
      // ROOT_CAUSES Problem 1 fix (2026-07-25): slide 4 (Recommendations) fills
      // ONLY from the TERMINAL node's artifact — an upstream draft (evidence
      // pack, workbook, model) must never populate recommendations early. A
      // node is terminal when no other pipeline node depends on it.
      const isTerminal = !(run.pipeline || []).some(
        (n) => Array.isArray(n.dependsOn) && n.dependsOn.includes(artifact.nodeId),
      );
      if (isTerminal && s4 && (s4.title || (s4.bullets || []).length)) {
        patchSlide(4, {
          ...(s4.title ? { title: clip(s4.title, 80) } : {}),
          ...(s4.bullets?.length ? { bullets: s4.bullets.slice(0, 4).map((b) => clip(b, 90)) } : {}),
          status: 'filling',
          ...(conf != null ? { confidence: conf } : {}),
        });
      }
    },

    /**
     * A node's verification passed. The run-level narrative slides (2 Evidence,
     * 3 Core findings) must NOT finalise here: this hook fires once PER NODE, so
     * in a multi-node pipeline (e.g. data-scout → model → design) finalising
     * mid-run made the shared cards oscillate Final → Rendering → Final as the
     * next node began streaming. They now finalise ONCE, together, at run
     * completion (onRunCompleted) — a clean monotonic Queued → Rendering → Final.
     * Here we only nudge slide 3's confidence to signal a verified stage without
     * ever regressing its status.
     */
    onVerificationPassed() {
      const s3 = slide(3);
      if (s3.status !== 'final') patchSlide(3, { confidence: Math.max(s3.confidence || 0, 0.9) });
    },

    /** Run completion locks the whole template Final; deck.ready closes it. */
    onRunCompleted({ downloadUrl = null } = {}) {
      const s = slide(4);
      const bullets = downloadUrl ? [...s.bullets.slice(0, 3), 'Download ready'] : s.bullets;
      patchSlide(4, { status: 'final', bullets });
      // Slide 3 (Core findings) finalises WITH the run — deferred from per-node
      // verification so the card never regresses to Rendering mid-pipeline.
      const s3 = slide(3);
      if (s3.status !== 'final') patchSlide(3, { status: 'final', confidence: s3.confidence ?? 1 });
      // Slide 1 is normally final at pipeline selection — guard defensively.
      if (slide(1).status !== 'final') patchSlide(1, { status: 'final' });
      // 2026-07-23: slide 2 ALWAYS completes Queued→Rendering→Final by run end
      // via REAL frames (never skeleton forever, never junk locked as final).
      // ROOT_CAUSES Problem 1 fix (2026-07-25): the empty-card stamp is now
      // HONEST — 'No external evidence required' only when the pipeline truly
      // contained no evidence stage; when an evidence node ran but produced no
      // extractable claims the card says so instead of implying none was needed.
      const s2 = slide(2);
      if (!s2.bullets.length) {
        const hadEvidenceStage = (run.pipeline || []).some(
          (n) => n.skill === 'data-scout' || n.skill === 'benchmark',
        );
        patchSlide(2, { title: 'Evidence & analysis', status: 'filling' });
        patchSlide(2, {
          title: hadEvidenceStage
            ? 'Evidence stage ran — no claims extracted into this card'
            : 'No external evidence required',
          status: 'final',
        });
      } else if (s2.status !== 'final') {
        patchSlide(2, { status: 'final' });
      }
      emitRunEvent(run, 'deck.ready', { slides: run.liveDeck.slides });
      persist();
    },
  };
}
