// downloadFinalDoc.js — robust click-to-download for the final document
// (2026-07-23 fix). The previous UI used a bare <a download> anchor: no click
// handler, no error surfacing — when the route answered 409 JSON (stale run on
// a recycled pod) or the browser blocked the attachment navigation, the click
// appeared dead. This helper fetches the file explicitly, surfaces any server
// error, and triggers a real browser download from a Blob object URL.

/** Parse filename from a Content-Disposition header (fallback provided). */
function dispositionFilename(disposition, fallback) {
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition || '');
  return m ? decodeURIComponent(m[1].replace(/"/g, '')) : fallback;
}

/**
 * Download the run's final document via the robust re-packaging route.
 * @param {string} runId
 * @returns {Promise<{ok: boolean, filename?: string, bytes?: number, type?: string, error?: string}>}
 */
export default async function downloadFinalDoc(runId) {
  try {
    const res = await fetch(`/api/oda/runs/${runId}/download`);
    if (!res.ok) {
      let msg = `download failed (HTTP ${res.status})`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
      return { ok: false, error: msg };
    }
    const blob = await res.blob();
    const filename = dispositionFilename(res.headers.get('content-disposition'), `oda-final-${runId.slice(0, 8)}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, filename, bytes: blob.size, type: blob.type };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
