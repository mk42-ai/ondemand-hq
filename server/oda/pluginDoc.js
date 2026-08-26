// pluginDoc.js — hosted final-document generation via the OnDemand Agent plugin
// (plugin-1775547203, ADOPTED.onDemandAgent). The plugin authors the deliverable
// (pdf / pptx / docx) on OnDemand's side and returns a HOSTED, permanent download
// URL. That sidesteps the ephemeral serverless /tmp file the local builders write
// — the file lives on OnDemand's host, not in per-instance lambda storage — and
// yields a higher-fidelity document than the deterministic local builders.
//
// Contract: every failure path returns null so the caller (packageRunArtifact)
// falls back to the local builders. A plugin outage must NEVER break packaging.
//
// Wire note: this uses the server API-KEY surface (createOdSession + syncQuery in
// ../ondemand.js — `apikey` header, plugin ids auto-translated to agentIds), NOT
// the browser client JWT surface (/chat/v1/client/sessions). Same plugin id,
// different auth channel.
import { ADOPTED } from '../plugins.js';
import { createOdSession, syncQuery } from '../ondemand.js';

const AGENT = ADOPTED.onDemandAgent.id; // plugin-1775547203
const URL_RX = /https?:\/\/[^\s)"'<>\]]+/g;

const FORMAT_LABEL = { pdf: 'PDF', pptx: 'PowerPoint presentation (.pptx)', docx: 'Word document (.docx)', xlsx: 'Excel workbook (.xlsx)' };

/** Formats the OnDemand Agent ("files/XLSX") builds for us. */
export const PLUGIN_DOC_FORMATS = Object.freeze(new Set(['pdf', 'pptx', 'docx', 'xlsx']));

/** HEAD (then ranged-GET) validate that a returned hosted URL really resolves. */
async function validateUrl(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (r.ok) return { ok: true, size: Number(r.headers.get('content-length')) || null, contentType: r.headers.get('content-type') };
    // some blob hosts reject HEAD — a 1-byte ranged GET still proves existence.
    r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return { ok: r.ok || r.status === 206, size: null, contentType: r.headers.get('content-type') };
  } catch {
    return { ok: false };
  }
}

/**
 * Generate a hosted document via the OnDemand Agent plugin, applying the ODA
 * house style and embedding the ODA logo + sourced images passed in.
 * @param {{externalUserId: string, format: 'pdf'|'pptx'|'docx', title?: string,
 *   subtitle?: string, date?: string, content: string, brandBrief?: string,
 *   logoUrl?: string|null, images?: Array<{url: string, alt?: string}>}} p
 * @returns {Promise<{hostedUrl: string, size: number|null, contentType: string|null}|null>}
 *          null on any failure (unsupported format, empty content, plugin error,
 *          no URL in the answer, or the URL failing validation).
 */
export async function generateHostedDoc({ externalUserId, format, title, subtitle, date, content, brandBrief = '', logoUrl = null, images = [], endpointId = null, reasoningEffort = null }) {
  if (!PLUGIN_DOC_FORMATS.has(format)) return null;
  const body = String(content || '').slice(0, 12000);
  if (!body.trim()) return null;

  const label = FORMAT_LABEL[format] || format;
  let instruction;
  if (format === 'xlsx') {
    // Spreadsheet: no logo/hero images — one sheet per "## " section, headers
    // bold, real numbers, a source column, sensible column widths, no merged cells.
    instruction =
`Create an ${label} from the tabular content below using the file-generation tool.
Build ONE worksheet per "## " section (sheet name = the heading). Put each markdown table into its sheet with a BOLD header row, real numeric cells (not text), a source column where present, ISO dates, sensible column widths and NO merged cells. Add a short "README" sheet first with the title and what the workbook contains.

After creating the file, return ONLY the direct download URL of the generated .${format} file. No commentary, no explanation — the URL alone.

TITLE: ${title || 'ODA data'}

CONTENT (markdown tables):
${body}`;
  } else {
    const brandBlock = brandBrief ? `\nBRAND — apply strictly:\n${brandBrief}\n` : '';
    const logoBlock = logoUrl
      ? `\nLOGO — download this image and place it in the top-right corner of EVERY slide/page (small, ~1.8in wide, preserve aspect): ${logoUrl}\n`
      : '';
    const imageBlock = (Array.isArray(images) && images.length)
      ? `\nIMAGES — download and embed these on relevant slides/pages (the FIRST on the cover as a hero image), preserving aspect ratio, never stretched or distorted:\n${images.slice(0, 8).map((im, i) => `${i + 1}. ${im.url}${im.alt ? ` — ${im.alt}` : ''}`).join('\n')}\n`
      : '';
    instruction =
`Create a polished, on-brand ${label} from the content below using the file-generation tool.
${brandBlock}${logoBlock}${imageBlock}
Structure: a cover (title, subtitle, date, logo, hero image), then ONE slide/page per "## " heading with its bullets and tables. Apply the ODA colours and fonts throughout.

After creating the file, return ONLY the direct download URL of the generated .${format} file. No commentary, no explanation — the URL alone.

TITLE: ${title || 'ODA deliverable'}${subtitle ? `\nSUBTITLE: ${subtitle}` : ''}${date ? `\nDATE: ${date}` : ''}

CONTENT (markdown):
${body}`;
  }

  try {
    const odSessionId = await createOdSession(externalUserId, [AGENT]);
    // The chosen model (endpointId) drives this final doc-creation call; Claude
    // endpoints accept plugins. Falls back to the session default when unset.
    const answer = await syncQuery({ odSessionId, query: instruction, pluginIds: [AGENT], endpointId, reasoningEffort });
    const urls = answer.match(URL_RX) || [];
    // Prefer a URL that clearly names our target extension, then any known doc
    // extension, then whatever URL came back.
    const cand = urls.find((u) => new RegExp(`\\.${format}(\\?|$)`, 'i').test(u))
      || urls.find((u) => /\.(pdf|pptx|docx|xlsx)(\?|$)/i.test(u))
      || urls[0];
    if (!cand) return null;
    const v = await validateUrl(cand);
    if (!v.ok) return null;
    return { hostedUrl: cand, size: v.size, contentType: v.contentType };
  } catch (err) {
    console.warn(`[oda-plugindoc] OnDemand Agent ${format} generation failed: ${err.message}`);
    return null;
  }
}
