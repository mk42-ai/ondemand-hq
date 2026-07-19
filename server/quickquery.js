// quickquery.js — ⚡ Quick Query micro-answers on GLM-4.7 Cerebras (Phase C Part 4).
//
// RULE 0 verification (2026-07-19 03:14 UTC, logged in NOTES.md + PLUGIN_TESTS.md):
//   • GET /config/v1/public/endpoints → byoi-6e314690-4eaf-4def-a33c-380809acf1f5
//     ("glm-4.7", api.cerebras.ai, status active, streaming_supported true,
//     reasoning_efforts null — do NOT send reasoningEffort). predefined-glm-4.7 is
//     INACTIVE (OpenRouter) — never use it.
//   • submitquery spec re-fetch: 0 `maxTokens` hits — there is NO documented token
//     cap (PRIOR_KNOWLEDGE.md dead-end #3: undocumented maxTokens → EMPTY answers).
//     The ~150-token budget is therefore enforced by PROMPT CONTRACT (1–3 sentences,
//     hard stop) + server-side truncation guard, never via undocumented params.
//   • 3 live 200 proofs: 1.330s / 5.331s / 1.525s sync fulfillmentOnly calls.
// Config: env-overridable, never hardcoded at call sites.
import { ONDEMAND_API_KEY, ONDEMAND_BASE_URL } from './env.js';

export const QQ_ENDPOINT_ID = process.env.QQ_ENDPOINT_ID || 'byoi-6e314690-4eaf-4def-a33c-380809acf1f5';
const QQ_SYSTEM = 'You are ODA Quick Query. The user passes a mini-artifact JSON from the UAE Correlation Engine (an edge, evidence record, narrative sentence, or stat) plus a short question. Answer in 1-3 crisp sentences (≈150 tokens hard budget), grounded ONLY in the passed JSON — never invent facts beyond it; if the JSON lacks the answer, say what IS in it. ODA = UAE Office of Development Affairs; frame relevance for ODA leadership. Reply in the user\'s language (English or Arabic).';

const H = { apikey: ONDEMAND_API_KEY, 'Content-Type': 'application/json' };

export function registerQuickQueryRoutes(app) {
  // Streaming Quick Query: relays upstream SSE answer deltas + emits a final
  // metrics frame with the server-measured ms latency (displayed in the UI).
  app.post('/api/quickquery', async (req, res) => {
    const { artifact, question, lang = 'en' } = req.body || {};
    if (!artifact || !question) return res.status(400).json({ error: 'artifact and question required' });
    const t0 = Date.now();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (type, data) => { try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
    try {
      // Fresh throwaway session per micro-query (sub-second target; session create ~130ms).
      const sRes = await fetch(`${ONDEMAND_BASE_URL}/chat/v1/sessions`, {
        method: 'POST', headers: H, body: JSON.stringify({ externalUserId: 'oda-quickquery' }),
      });
      const sid = (await sRes.json())?.data?.id;
      if (!sid) throw new Error(`session create failed HTTP ${sRes.status}`);
      const body = {
        query: `MINI-ARTIFACT JSON:\n${JSON.stringify(artifact).slice(0, 4000)}\n\nQUESTION (${lang}): ${question}`,
        endpointId: QQ_ENDPOINT_ID,
        responseMode: 'stream',
        fulfillmentOnly: true,      // skip RAG planning — fastest path (RULE 0 proof 1.3s)
        modelConfigs: { fulfillmentPrompt: QQ_SYSTEM, temperature: 0.2, stopSequences: ['\n\n\n'] },
      };
      const up = await fetch(`${ONDEMAND_BASE_URL}/chat/v1/sessions/${sid}/query`, {
        method: 'POST', headers: H, body: JSON.stringify(body),
      });
      if (!up.ok || !up.body) throw new Error(`upstream HTTP ${up.status}`);
      const reader = up.body.getReader(); const dec = new TextDecoder();
      let buf = '', full = '', tokens = 0;
      const CAP = 900; // ~150-token guard: hard character cap server-side (no documented maxTokens)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload); } catch { continue; }
          if (j.eventType === 'fulfillment' && typeof j.answer === 'string') {
            if (full.length < CAP) {
              const chunk = j.answer.slice(0, CAP - full.length);
              full += chunk; tokens++;
              send('delta', { text: chunk });
            }
          }
        }
      }
      const ms = Date.now() - t0;
      send('done', { ms, endpointId: QQ_ENDPOINT_ID, chars: full.length, truncated: full.length >= CAP });
    } catch (e) {
      send('error', { message: e.message, ms: Date.now() - t0 });
    }
    res.write('data: [DONE]\n\n'); res.end();
  });
}
