// mediaIngest.js — OnDemand Media API ingestion of the packaged final document
// (2026-07-23 download fix). Contract consulted LIVE and recorded in
// ONDEMAND_API_CONTRACTS.md (execution 6a618ffb193b04e98c3b00f9):
//
//   POST https://api.on-demand.io/media/v1/public/file
//   headers: { apikey: <key>, Content-Type: application/json }
//   required body: { url, plugins, responseMode }   (ingestion is BY URL —
//   no multipart upload exists in the public spec)
//   response: { message, data: { id, url, sourceUrl, name, sizeBytes, ... } }
//   → data.url is the frontend-safe media URL for the download button.
//
// The packaged file must therefore be publicly reachable BEFORE ingestion —
// the deployed workspace serves it at {PUBLIC_BASE}/api/oda/files/<name>.
// The public base comes from ODA_PUBLIC_BASE_URL (set by the deploy script);
// without it (e.g. local dev on localhost, which the Media API cannot fetch)
// ingestion is honestly skipped with a reason — NEVER faked.
//
// Failure policy mirrors autoArtifact.js: ingestion failure must never crash
// run completion — it returns { mediaUrl: null, reason } and the download
// button falls back to the local /api/oda/runs/:id/download route.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONDEMAND_API_KEY } from '../env.js';

const MEDIA_API_URL = 'https://api.on-demand.io/media/v1/public/file';

// LIVE-VERIFIED QUIRKS (2026-07-23T04:22-04:25Z, probed against the real API):
//   1. Despite the spec marking `plugins` as merely "required" (empty array
//      allowed), the endpoint returns HTTP 500 {"errorCode":"server_error"}
//      whenever plugins is []. With the spec's own example processing plugin
//      id it returns 200 "Media Created". So we always send that default
//      plugin id (overridable via ODA_MEDIA_PLUGIN_ID).
//   2. The endpoint also 500s on .md / .html / .txt source URLs (verified on
//      both our sandbox files AND public w3.org files) while accepting .pdf
//      and .docx. When the packaged final doc is such a format we build a PDF
//      RENDITION of the same artifact and ingest that instead — the media URL
//      then serves the PDF; the local /download route keeps the native format.
const MEDIA_PLUGIN_ID = process.env.ODA_MEDIA_PLUGIN_ID || 'plugin-1713954536';
const MEDIA_OK_EXTS = new Set(['pdf', 'docx', 'pptx', 'xlsx']);

/** Public base URL under which /api/oda/files/* is reachable from the internet. */
export function publicBaseUrl() {
  return (process.env.ODA_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
}

/**
 * Ingest the run's packaged final document into the OnDemand Media API.
 * @param {object} run    durable ODARun (run.finalArtifact must exist)
 * @param {object} [opts] { fetchImpl } for tests
 * @returns {Promise<{mediaUrl: string|null, mediaId?: string, sourceUrl?: string, bytes?: number, reason?: string}>}
 */
export async function ingestFinalDocument(run, { fetchImpl = fetch } = {}) {
  try {
    const rec = run.finalArtifact;
    if (!rec?.downloadUrl) return { mediaUrl: null, reason: 'no packaged final artifact' };

    const base = publicBaseUrl();
    if (!base) return { mediaUrl: null, reason: 'ODA_PUBLIC_BASE_URL not set — file not publicly reachable, ingestion skipped' };

    let fileName = path.basename(rec.downloadUrl);
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'files');
    let filePath = path.join(dir, fileName);
    const ext = fileName.split('.').pop().toLowerCase();
    if (!MEDIA_OK_EXTS.has(ext)) {
      // Quirk 2: build a PDF rendition of the SAME artifact for ingestion.
      const primary = (run.artifacts || []).find((a) => a.artifactId === rec.artifactId);
      if (!primary?.content) return { mediaUrl: null, reason: `format .${ext} rejected by Media API and no artifact content for PDF rendition` };
      const { parseContentSpec, buildArtifact } = await import('./builders/index.js');
      const spec = parseContentSpec(primary.content);
      if (!spec.title) spec.title = primary.title;
      fileName = `${fileName.replace(/\.[^.]+$/, '')}-media.pdf`;
      filePath = path.join(dir, fileName);
      await buildArtifact({ format: 'pdf', spec, outPath: filePath });
    }
    const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : (rec.bytes || undefined);
    const publicUrl = `${base}/api/oda/files/${fileName}`;

    const res = await fetchImpl(MEDIA_API_URL, {
      method: 'POST',
      headers: { apikey: ONDEMAND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: publicUrl,                 // required — ingestion is by URL
        plugins: [MEDIA_PLUGIN_ID],     // required — MUST be non-empty (see quirk above)
        responseMode: 'sync',           // required — enum sync | webhook
        name: fileName,
        externalUserId: run.request?.externalUserId || 'oda-workspace',
        ...(sizeBytes ? { sizeBytes } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { mediaUrl: null, reason: `Media API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}` };

    const data = body.data || {};
    if (!data.url) return { mediaUrl: null, reason: `Media API response missing data.url: ${JSON.stringify(body).slice(0, 300)}` };

    return { mediaUrl: data.url, mediaId: data.id, sourceUrl: data.sourceUrl, bytes: data.sizeBytes || sizeBytes };
  } catch (err) {
    return { mediaUrl: null, reason: err.message };
  }
}
