// e2e-plan-mode.mjs — Live end-to-end harness for the Plan Mode gate chain.
//
// Run against a RUNNING server:  node tests/e2e-plan-mode.mjs [baseUrl]
// Default baseUrl: http://localhost:8080
//
// Exercises the REAL Plan Mode chain over HTTP: run creation → SSE stream →
// clarification gate(s) → gate resolution (GateCard click simulation) →
// engine resume proof (skill.started / executing) → mid-run message (RC-5) →
// run snapshot → optional cancel.
//
// Zero dependencies (global fetch + ReadableStream SSE reading — no EventSource).
// Prints a machine-parseable JSON report to stdout AND saves it to
// /tmp/e2e-plan-mode-report.json. Exit 0 iff all REQUIRED steps (1-5, 7) pass.

import fs from 'node:fs';

const baseUrl = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
const REPORT_PATH = '/tmp/e2e-plan-mode-report.json';
const SSE_WINDOW_MS = 240_000; // per-stream read window
const GLOBAL_TIMEOUT_MS = 12 * 60_000; // 12 minutes hard cap
const MAX_GATES = 3;

const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  steps: [],
  summary: { total: 0, passed: 0, failed: 0 },
  gateChain: { questionsRaised: 0, questionsAnswered: 0, finalPromptSynthesised: false },
};

const REQUIRED_STEPS = new Set([
  'health',
  'create-run',
  'sse-first-gate',
  'resolve-gate-1',
  'gate-chain-to-execution',
  'run-snapshot',
]);

function record(name, pass, httpStatus, detail) {
  const step = { name, pass: !!pass, httpStatus: httpStatus ?? null, ts: new Date().toISOString(), detail: detail ?? null };
  report.steps.push(step);
  console.error(`[e2e] ${pass ? 'PASS' : 'FAIL'} ${name} (http=${httpStatus ?? '-'}) ${typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')}`.slice(0, 400));
  return step;
}

function finalize(forced) {
  report.summary.total = report.steps.length;
  report.summary.passed = report.steps.filter((s) => s.pass).length;
  report.summary.failed = report.summary.total - report.summary.passed;
  if (forced) report.forcedTimeout = true;

  const requiredResults = [...REQUIRED_STEPS].map((name) => {
    const step = report.steps.find((s) => s.name === name);
    return step ? step.pass : false;
  });
  const ok = requiredResults.every(Boolean) && !forced;

  try {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`[e2e] could not write ${REPORT_PATH}: ${err.message}`);
  }
  console.log('E2E-PLAN-MODE-REPORT-JSON:');
  console.log(JSON.stringify(report));
  process.exit(ok ? 0 : 1);
}

// Global hard-stop guard — force-exit 1 with the partial report.
const guard = setTimeout(() => {
  record('global-timeout', false, null, `harness exceeded ${GLOBAL_TIMEOUT_MS / 60000} minutes — force exit`);
  finalize(true);
}, GLOBAL_TIMEOUT_MS);
guard.unref();

async function jsonFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    const text = await res.text().catch(() => '');
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: null, body: null, error: err.message };
  }
}

/**
 * Read an SSE stream via fetch + ReadableStream reader (no EventSource in node).
 * Tolerates 'event:' lines, ':' keepalive comments, multi-line frames, and the
 * run store's seq replay. Calls onEvent(parsedData) for each JSON 'data:' payload.
 * Resolves when onEvent returns truthy ('stop'), on window timeout, or stream end.
 */
async function readSse(url, onEvent, windowMs = SSE_WINDOW_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), windowMs);
  timer.unref();
  let stopped = false;
  let error = null;
  try {
    const res = await fetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      return { status: res.status, stopped: false, error: `SSE HTTP ${res.status}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = [];
        for (const rawLine of frame.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (!line || line.startsWith(':')) continue; // keepalive/comment
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
          // 'event:', 'id:', 'retry:' lines tolerated and ignored — payload carries type.
        }
        if (!dataLines.length) continue;
        let parsed;
        try {
          parsed = JSON.parse(dataLines.join('\n'));
        } catch {
          continue; // non-JSON data frame — ignore
        }
        try {
          if (onEvent(parsed)) {
            stopped = true;
            controller.abort();
            break;
          }
        } catch (err) {
          error = `onEvent threw: ${err.message}`;
          controller.abort();
          break;
        }
      }
      if (stopped || error) break;
    }
    return { status: res.status, stopped, error };
  } catch (err) {
    if (err && err.name === 'AbortError') return { status: 200, stopped, error };
    return { status: null, stopped, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function eventSeq(evt) {
  const n = Number(evt && (evt.seq ?? evt.id));
  return Number.isFinite(n) ? n : null;
}

function pickChoice(options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const nonSkip = options.find((o) => !/skip/i.test(String(o)));
  return nonSkip ?? null;
}

async function resolveGate(runId, gate, stepName) {
  const options = Array.isArray(gate.options) ? gate.options : [];
  const choice = pickChoice(options);
  const payload = {
    approved: true,
    choice,
    edits: options.length === 0 ? { text: 'Board-level audience, 6 pages, partnership emphasis' } : null,
  };
  const res = await jsonFetch(`${baseUrl}/api/oda/runs/${runId}/gates/${gate.gateId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const pass = res.status === 200;
  if (pass) report.gateChain.questionsAnswered += 1;
  record(stepName, pass, res.status, {
    gateId: gate.gateId,
    choice,
    edits: payload.edits,
    error: res.error ?? null,
    body: pass ? undefined : res.body,
  });
  return pass;
}

async function main() {
  // -------------------------------------------------------------------------
  // Step 1 — health
  // -------------------------------------------------------------------------
  {
    const res = await jsonFetch(`${baseUrl}/api/health`);
    record('health', res.status === 200, res.status, res.error ?? 'GET /api/health');
    if (res.status !== 200) return finalize(false); // nothing else can work
  }

  // -------------------------------------------------------------------------
  // Step 2 — create run
  // -------------------------------------------------------------------------
  let runId = null;
  {
    const res = await jsonFetch(`${baseUrl}/api/oda/runs`, {
      method: 'POST',
      body: JSON.stringify({
        text: 'Build a 6-page briefing deck on UAE development partnerships for the Chairman',
        externalUserId: 'e2e-plan-mode',
        depth: 'full',
        output: 'deck',
      }),
    });
    runId = res.body && (res.body.runId || (res.body.run && res.body.run.runId) || res.body.id);
    const pass = res.status === 201 && !!runId;
    record('create-run', pass, res.status, { runId: runId ?? null, error: res.error ?? null, body: pass ? undefined : res.body });
    if (!pass) return finalize(false);
  }

  // -------------------------------------------------------------------------
  // Step 3 — SSE: wait for request.interpreted + first question.required
  // -------------------------------------------------------------------------
  let lastSeq = 0;
  let interpretedFrame = null;
  let firstGate = null;
  {
    const sse = await readSse(`${baseUrl}/api/oda/runs/${runId}/events?since=0`, (evt) => {
      const seq = eventSeq(evt);
      if (seq !== null && seq > lastSeq) lastSeq = seq;
      if (!interpretedFrame && evt.type === 'request.interpreted') {
        const control = (evt.data && (evt.data.control || evt.data)) || {};
        interpretedFrame = {
          clarifyingQuestions: Array.isArray(control.clarifying_questions) ? control.clarifying_questions.length : null,
        };
      }
      if (evt.type === 'question.required') {
        const d = evt.data || {};
        firstGate = {
          gateId: d.gateId || d.gate_id || (d.gate && d.gate.gateId) || null,
          gateType: d.gateType || d.gate_type || null,
          prompt: d.prompt || null,
          options: Array.isArray(d.options) ? d.options : [],
        };
        report.gateChain.questionsRaised += 1;
        return true; // stop reading — we reopen with ?since= later
      }
      return false;
    });
    const pass = !!firstGate && !!firstGate.gateId;
    record('sse-first-gate', pass, sse.status, {
      interpreted: interpretedFrame,
      firstGate,
      lastSeq,
      sseError: sse.error ?? null,
    });
    if (!pass) return finalize(false);
  }

  // -------------------------------------------------------------------------
  // Step 4 — resolve first gate (simulate GateCard click)
  // -------------------------------------------------------------------------
  {
    const pass = await resolveGate(runId, firstGate, 'resolve-gate-1');
    if (!pass) return finalize(false);
  }

  // -------------------------------------------------------------------------
  // Step 5 — reopen SSE from last seq: answer further gates (max 3 total),
  // expect final_prompt_ready and/or skill.started / executing.
  // -------------------------------------------------------------------------
  {
    let outcome = null; // 'skill.started' | 'executing' | null
    let gatesAnswered = 1; // gate 1 already answered
    let sawFinalPromptReady = false;
    let keepGoing = true;
    let loops = 0;

    while (keepGoing && loops < MAX_GATES + 2) {
      loops += 1;
      let nextGate = null;
      const sse = await readSse(`${baseUrl}/api/oda/runs/${runId}/events?since=${lastSeq}`, (evt) => {
        const seq = eventSeq(evt);
        if (seq !== null && seq > lastSeq) lastSeq = seq;
        if (evt.type === 'question.required') {
          const d = evt.data || {};
          nextGate = {
            gateId: d.gateId || d.gate_id || (d.gate && d.gate.gateId) || null,
            gateType: d.gateType || d.gate_type || null,
            prompt: d.prompt || null,
            options: Array.isArray(d.options) ? d.options : [],
          };
          report.gateChain.questionsRaised += 1;
          return true;
        }
        if (evt.type === 'skill.progress') {
          const notice = evt.data && (evt.data.notice || evt.data.message);
          if (notice === 'final_prompt_ready' || (typeof notice === 'string' && notice.includes('final_prompt_ready'))) {
            sawFinalPromptReady = true;
            report.gateChain.finalPromptSynthesised = true;
          }
          return false;
        }
        if (evt.type === 'skill.started') {
          outcome = 'skill.started';
          return true;
        }
        if (evt.type === 'run.status' || evt.type === 'status.changed' || evt.type === 'run.transition') {
          const status = evt.data && (evt.data.status || evt.data.to);
          if (status === 'executing') {
            outcome = 'executing';
            return true;
          }
          return false;
        }
        return false;
      });

      if (outcome) {
        keepGoing = false;
      } else if (nextGate && nextGate.gateId && gatesAnswered < MAX_GATES) {
        const ok = await resolveGate(runId, nextGate, `resolve-gate-${gatesAnswered + 1}`);
        gatesAnswered += 1;
        if (!ok) keepGoing = false;
      } else {
        // No gate, no outcome within window — give up this step.
        record('gate-chain-to-execution', false, sse.status, {
          detail: 'SSE window elapsed without skill.started/executing or another gate',
          gatesAnswered,
          sawFinalPromptReady,
          sseError: sse.error ?? null,
        });
        keepGoing = false;
        outcome = 'timeout';
      }
    }

    if (outcome === 'skill.started' || outcome === 'executing') {
      record('gate-chain-to-execution', true, 200, {
        outcome,
        gatesAnswered,
        finalPromptReady: sawFinalPromptReady,
      });
    } else if (outcome !== 'timeout') {
      record('gate-chain-to-execution', false, null, {
        outcome: outcome ?? 'none',
        gatesAnswered,
        finalPromptReady: sawFinalPromptReady,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 6 — mid-run message (RC-5) — non-required
  // -------------------------------------------------------------------------
  {
    const res = await jsonFetch(`${baseUrl}/api/oda/runs/${runId}/message`, {
      method: 'POST',
      body: JSON.stringify({ text: 'One more note: use East Africa examples' }),
    });
    record('mid-run-message', res.status === 200, res.status, {
      note: 'RC-5 route; acceptable if it records a note after gates closed',
      error: res.error ?? null,
      body: res.status === 200 ? undefined : res.body,
    });
  }

  // -------------------------------------------------------------------------
  // Step 7 — run snapshot
  // -------------------------------------------------------------------------
  {
    const res = await jsonFetch(`${baseUrl}/api/oda/runs/${runId}`);
    const run = res.body && (res.body.run || res.body);
    const pass = res.status === 200 && !!run;
    let detail = { error: res.error ?? null };
    if (run) {
      const gates = Array.isArray(run.gates) ? run.gates : [];
      detail = {
        status: run.status ?? null,
        gateStatuses: gates.map((g) => ({ gateId: g.gateId, status: g.status })),
        openGates: gates.filter((g) => g.status === 'open').length,
        clarificationsLength: Array.isArray(run.clarifications) ? run.clarifications.length : null,
        hasFinalPromptKey: run.finalPrompt !== undefined,
      };
    }
    record('run-snapshot', pass, res.status, detail);
  }

  // -------------------------------------------------------------------------
  // Step 8 — cancel to avoid burning tokens (optional, non-required)
  // -------------------------------------------------------------------------
  {
    const res = await jsonFetch(`${baseUrl}/api/oda/runs/${runId}/cancel`, { method: 'POST', body: '{}' });
    record('cancel-run', res.status === 200, res.status, { optional: true, error: res.error ?? null });
  }

  finalize(false);
}

main().catch((err) => {
  record('unhandled-error', false, null, err && err.stack ? err.stack.slice(0, 600) : String(err));
  finalize(false);
});
