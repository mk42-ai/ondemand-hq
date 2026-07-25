// autoArtifact.js — MANDATORY post-run artifact packaging (live-render upgrade).
// When a run completes, the primary verified artifact is materialised into a
// downloadable file via the Phase 4 builders and its URL is surfaced in the
// run state, the SSE completion frames, and the API response. Packaging
// failure must NEVER crash run completion — it returns { downloadUrl: null,
// reason } and the caller surfaces the gap honestly.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ODA_DATA_DIR } from '../paths.js';

/** Best output format per artifact type (default 'md'). */
const FORMAT_BY_TYPE = Object.freeze({
  'deck-html': 'html',
  'deck-pptx': 'pptx',
  'one-pager-summary': 'md',
  'storyline-md': 'md',
  'action-titles-md': 'md',
  'workbook-md': 'md',
  'benchmark-report-md': 'md',
  'insight-pack-md': 'md',
  'fast-facts-md': 'md',
  'xlsx-model': 'xlsx',
  'xlsx-data': 'xlsx',
  'media-bilingual-md': 'docx',
  'arabic-docx': 'docx',
  'arabic-pptx': 'pptx',
  markdown: 'md',
  docx: 'docx',
  pdf: 'pdf',
});

/**
 * Package the run's primary verified artifact into a downloadable file.
 * @param {object} run durable ODARun
 * @param {{format?: string|null}} [opts]
 * @returns {Promise<{downloadUrl: string|null, artifactId?: string, format?: string, bytes?: number, qa?: object, reason?: string}>}
 */
export async function packageRunArtifact(run, { format = null } = {}) {
  try {
    const verified = (run.artifacts || []).filter((a) => a.status === 'verified');
    if (!verified.length) return { downloadUrl: null, reason: 'no verified artifact' };
    // Primary: newest verified non-synthesis artifact; fall back to synthesis.
    const primary = [...verified].reverse().find((a) => a.logicalId !== 'run-synthesis')
      || verified[verified.length - 1];
    // ROOT_CAUSES Problem 8 fix (2026-07-25): upstream verified artifacts
    // (evidence pack, workbook, model) are MERGED into the final document input
    // as appendix sections instead of being dropped — newest version per
    // logicalId, primary and run-synthesis excluded, each capped so the plugin
    // prompt stays within budget.
    const newestByLogical = new Map();
    for (const a of verified) {
      const prev = newestByLogical.get(a.logicalId);
      if (!prev || (a.version || 0) > (prev.version || 0)) newestByLogical.set(a.logicalId, a);
    }
    const upstream = [...newestByLogical.values()]
      .filter((a) => a.logicalId !== primary.logicalId && a.logicalId !== 'run-synthesis');

    // DELIVERABLE FORMAT POLICY (2026-07-24, product rule): the final download is
    // ONLY ever a DECK → .pptx, a SPREADSHEET → .xlsx, or ANY other document → .pdf.
    // DOCX and HTML are never shipped as the final deliverable anymore.
    const nativeFormat = FORMAT_BY_TYPE[primary.type] || 'md';
    const XLSX_NATIVE = new Set(['xlsx-model', 'xlsx-data']);
    const isDeck = ['deck-html', 'deck-pptx', 'arabic-pptx'].includes(primary.type);
    // The user's explicit Output selection (sidebar dropdown) FORCES the final
    // deliverable format: Document → .pdf, Deck → .pptx, Data/Model → .xlsx.
    // 'auto' (or unset) defers to the artifact-type default below; an explicit
    // `format` arg still overrides everything. Read the structured field first,
    // then fall back to the "Output: X" hint the composer appends to the request
    // text — so the format holds even if the structured field is unavailable.
    const OUTPUT_FORMAT = Object.freeze({ deck: 'pptx', document: 'pdf', data: 'xlsx', model: 'xlsx' });
    const structuredOutput = String(run.request?.output || '').toLowerCase();
    const requestedOutput = ['deck', 'document', 'data', 'model'].includes(structuredOutput)
      ? structuredOutput
      : (String(run.request?.text || '').match(/output:\s*(deck|document|data|model)/i)?.[1] || 'auto').toLowerCase();
    let outputFormat = format
      || OUTPUT_FORMAT[requestedOutput]
      || (XLSX_NATIVE.has(primary.type) ? nativeFormat
        : isDeck ? 'pptx'
        : 'pdf');

    // ---- Parse the deliverable into the shared spec (HTML is flattened to
    // markdown so raw <tags> never leak) — feeds BOTH the plugin and the local
    // builders below. ----
    const { parseContentSpec, buildArtifact } = await import('./builders/index.js');
    const { looksLikeHtml, htmlToMarkdown } = await import('./builders/htmlToMd.js');
    const rawContent = primary.content || primary.preview || '';
    let contentMd = looksLikeHtml(rawContent) ? htmlToMarkdown(rawContent) : rawContent;
    // Problem 8: append upstream artifacts as appendix sections (≤2500 chars
    // each, max 4) so evidence/workbook/model content survives into the final
    // document instead of influencing it only indirectly during authoring.
    if (upstream.length) {
      const appendix = upstream.slice(0, 4).map((a) => {
        const raw = a.content || a.preview || '';
        const md = looksLikeHtml(raw) ? htmlToMarkdown(raw) : raw;
        return `\n\n## Appendix — ${a.title || a.logicalId} (${a.type})\n${String(md).slice(0, 2500)}`;
      }).join('');
      if (appendix.trim()) contentMd += appendix;
    }
    const spec = parseContentSpec(contentMd);
    if (!spec.title) spec.title = primary.title;

    // ---- IMAGERY (Perplexity → GPT Image 2): sourced ONCE, then used by whichever
    // builder runs — the plugin gets the URLs, the local builders get the bytes.
    // Guarded: a lookup/outage never blocks packaging. ----
    if (outputFormat === 'pptx' || outputFormat === 'pdf') {
      try {
        const { attachDeliverableImages } = await import('./imageSource.js');
        await attachDeliverableImages(spec, {
          externalUserId: `oda-img-${run.runId.slice(0, 8)}`,
          format: outputFormat,
          subjectHint: run.intent || run.request?.text || '',
        });
      } catch (imgErr) {
        console.warn(`[oda-artifact] imagery enrichment skipped: ${imgErr.message}`);
      }
    }
    const images = [];
    if (spec.heroImage?.url) images.push({ url: spec.heroImage.url, alt: spec.heroImage.alt });
    for (const s of spec.sections || []) if (s.image?.url) images.push({ url: s.image.url, alt: s.image.alt });

    // ---- PLUGIN-FIRST for configured formats (default: pptx). The OnDemand Agent
    // (plugin-1775547203) builds a HOSTED, on-brand file on OnDemand's servers —
    // we pass the ODA house style, the public logo URL and the sourced image URLs
    // and ask it to return the file URL only, which we keep as the download URL.
    // ANY failure falls through to the deterministic local builder below. ----
    const USE_PLUGIN_DOCS = process.env.ODA_PLUGIN_DOCS !== '0'; // default ON
    // On the /oda workspace BOTH the deck (pptx) and the document (pdf) are built
    // by the OnDemand Agent ("terminal tool"). The suite home page is a separate
    // path (server/artifacts.js) and stays local. Override with ODA_PLUGIN_FORMATS.
    const PLUGIN_FORMATS = new Set(
      (process.env.ODA_PLUGIN_FORMATS || 'pptx,pdf,xlsx').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const { generateHostedDoc, PLUGIN_DOC_FORMATS } = await import('./pluginDoc.js');
    if (USE_PLUGIN_DOCS && PLUGIN_FORMATS.has(outputFormat) && PLUGIN_DOC_FORMATS.has(outputFormat)) {
      const { brandBrief } = await import('./builders/theme.js');
      const { ODA_LOGO_URL } = await import('./builders/brandAsset.js');
      // The user's CHOSEN model drives this final doc-creation call (Claude
      // endpoints accept plugins). Everything upstream ran on the fast model.
      const { BRAINS, DEFAULT_BRAIN } = await import('./brains.js');
      const chosenBrain = (run.brain && BRAINS[run.brain]) ? run.brain : DEFAULT_BRAIN;
      const hosted = await generateHostedDoc({
        externalUserId: `oda-doc-${run.runId.slice(0, 8)}`,
        format: outputFormat,
        title: spec.title,
        subtitle: spec.subtitle,
        date: spec.date,
        content: contentMd,
        brandBrief: brandBrief(),
        logoUrl: ODA_LOGO_URL,
        images,
        endpointId: BRAINS[chosenBrain].endpointId,
        reasoningEffort: BRAINS[chosenBrain].reasoningEffort, // null (e.g. Fable) → omitted downstream
        // Problem 8: full run context rides into the plugin prompt — the hosted
        // document is grounded in the original request, clarifications, the GLM
        // optimised brief, verified evidence and recorded assumptions.
        runContext: {
          originalRequest: run.request?.text || null,
          clarifications: run.clarifications || [],
          finalPrompt: run.finalPrompt || null,
          evidence: run.evidence || [],
          assumptions: run.assumptions || [],
        },
      });
      if (hosted?.hostedUrl) {
        // downloadUrl stays SAME-ORIGIN (the canonical route proxy-streams the
        // hosted bytes with attachment headers) so the webview downloader and
        // every client consumer keep working; hostedUrl records the real source.
        const downloadUrl = `/api/oda/runs/${run.runId}/download`;
        primary.url = downloadUrl;
        run.finalArtifact = {
          artifactId: primary.artifactId,
          downloadUrl,
          hosted: true,
          hostedUrl: hosted.hostedUrl,
          format: outputFormat,
          bytes: hosted.size || null,
          source: `OnDemand Agent (plugin-1775547203) · ${chosenBrain}`,
          model: chosenBrain,
          images: images.length,
          packagedAt: new Date().toISOString(),
        };
        return { downloadUrl, hostedUrl: hosted.hostedUrl, artifactId: primary.artifactId, format: outputFormat, bytes: hosted.size || null, source: run.finalArtifact.source };
      }
      console.warn(`[oda-artifact] OnDemand Agent produced no hosted ${outputFormat} for run ${run.runId} — falling back to local builder`);
    }

    const dir = path.join(ODA_DATA_DIR, 'files'); // serverless-safe (writable /tmp on Vercel)
    fs.mkdirSync(dir, { recursive: true });
    const base = `${run.runId.slice(0, 8)}-final-${primary.logicalId}`.replace(/[^a-zA-Z0-9_-]/g, '');
    let outPath = path.join(dir, `${base}.${outputFormat}`);

    let result;
    try {
      result = await buildArtifact({ format: outputFormat, spec, outPath });
    } catch (fmtErr) {
      if (outputFormat === nativeFormat) throw fmtErr;
      console.warn(`[oda-artifact] ${outputFormat} build failed (${fmtErr.message}) — falling back to native ${nativeFormat}`);
      outputFormat = nativeFormat;
      outPath = path.join(dir, `${base}.${outputFormat}`);
      result = await buildArtifact({ format: outputFormat, spec, outPath });
    }

    const downloadUrl = `/api/oda/files/${path.basename(outPath)}`;
    primary.url = downloadUrl;
    run.finalArtifact = {
      artifactId: primary.artifactId,
      downloadUrl,
      format: outputFormat,
      bytes: result.bytes,
      qa: result.qa,
      packagedAt: new Date().toISOString(),
    };
    return { downloadUrl, artifactId: primary.artifactId, format: outputFormat, bytes: result.bytes, qa: result.qa };
  } catch (err) {
    console.warn(`[oda-artifact] packaging failed for run ${run?.runId}: ${err.message}`);
    return { downloadUrl: null, reason: err.message };
  }
}

/** The packaged final-artifact record, if any. */
export function getFinalArtifact(run) {
  return run.finalArtifact || null;
}
