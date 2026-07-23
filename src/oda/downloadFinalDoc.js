// downloadFinalDoc.js — genuine save-to-disk for the final document
// (2026-07-23 fix v2). v1 fetched the file as a Blob and clicked an
// object-URL anchor: the fetch succeeded (status showed "Downloaded N bytes")
// but in embedded/webview contexts the programmatic blob-URL click is
// silently suppressed, so NO file ever landed on the user's disk.
//
// v2 primary path (approach b): navigate a real temporary <a> straight at the
// /api/oda/runs/:id/download endpoint. The server replies with
// 'Content-Disposition: attachment; filename="<name>"' + the correct MIME
// (docx/pdf/md/html/pptx/xlsx), so the BROWSER'S NATIVE download machinery
// saves the file to disk — no blob URL, no revocation race, works in
// iframes/webviews because it is a plain same-origin navigation the browser
// treats as an attachment fetch.
// The status line is only updated after we verify (via a metadata probe) that
// the endpoint is actually serving the file, so we never claim a save that
// could not have been triggered.

/** Parse filename from a Content-Disposition header (fallback provided). */
function dispositionFilename(disposition, fallback) {
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition || '');
  return m ? decodeURIComponent(m[1].replace(/"/g, '')) : fallback;
}

/** Probe the endpoint headers WITHOUT consuming the body (ranged GET). */
async function probeDownload(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (!res.ok && res.status !== 206) {
    let msg = `download failed (HTTP ${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
    return { ok: false, error: msg };
  }
  // Full size: prefer Content-Range total, else Content-Length of a full 200.
  const cr = res.headers.get('content-range');
  const total = cr ? Number(cr.split('/')[1]) : Number(res.headers.get('content-length') || 0);
  return {
    ok: true,
    filename: dispositionFilename(res.headers.get('content-disposition'), null),
    bytes: Number.isFinite(total) ? total : 0,
    type: (res.headers.get('content-type') || '').split(';')[0],
  };
}

/**
 * Trigger a genuine browser save-to-disk of the run's final document.
 * @param {string} runId
 * @returns {Promise<{ok: boolean, filename?: string, bytes?: number, type?: string, error?: string}>}
 */
export default async function downloadFinalDoc(runId) {
  const endpoint = `/api/oda/runs/${runId}/download`;
  try {
    // 1) Verify the endpoint serves a real file (surfaces 409 "no downloadable
    //    document" etc. BEFORE we claim anything).
    const meta = await probeDownload(endpoint);
    if (!meta.ok) return meta;
    const filename = meta.filename || `oda-final-${runId.slice(0, 8)}`;

    // 2) PRIMARY: real anchor navigation at the endpoint itself. The server's
    //    attachment disposition makes the browser save the file natively.
    const a = document.createElement('a');
    a.href = endpoint;
    a.download = filename; // reinforces attachment semantics (same-origin)
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();

    // 3) FALLBACK for environments where even endpoint-anchor clicks are
    //    swallowed (some webviews): after a short grace period, retry via a
    //    hidden iframe navigation — an attachment response never unloads the
    //    page, it just triggers the download UI.
    setTimeout(() => {
      try {
        const f = document.createElement('iframe');
        f.style.display = 'none';
        f.src = endpoint;
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 30000);
      } catch { /* best-effort */ }
    }, 1500);

    return { ok: true, filename, bytes: meta.bytes, type: meta.type };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
