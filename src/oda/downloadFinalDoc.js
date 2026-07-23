// downloadFinalDoc.js — embedded-webview-safe save-to-disk (2026-07-23 v3).
//
// RESEARCHED CONSTRAINTS (Chromium):
//   • Downloads in sandboxed iframes are BLOCKED without the
//     'allow-downloads' sandbox flag (Chrome 83+).
//   • Cross-origin iframe downloads are often blocked by Site Isolation.
//   • Blob-URL anchor clicks are silently suppressed in embedded canvases —
//     therefore NO blob anchors anywhere in this module.
//
// STRATEGY (priority order, per tier research):
//   (a) top-level navigation to the native endpoint — window.open('_blank')
//       when embedded (new top-level browsing context escapes the frame's
//       download sandbox), plain same-origin anchor navigation when we ARE
//       the top-level page. The server replies with
//       'Content-Disposition: attachment; filename="…"' + correct MIME, so
//       the browser's NATIVE save-to-disk fires and the page never unloads.
//   (b) sandbox allow-downloads handling — we cannot grant our own frame the
//       flag from inside, so when window.open is popup-blocked we fall
//       through to (c)/(d), which are the two mechanisms that work under a
//       sandbox WITH allow-downloads / via the unsandboxed parent.
//   (c) hidden-iframe navigation fallback — same-origin iframe pointed at
//       the endpoint; the attachment response triggers the download UI
//       (succeeds when the frame tree allows downloads).
//   (d) postMessage-to-parent delegation — the embedded frame posts
//       {action:'download', url} to window.parent; a parent listener (ours
//       is installed in OdaWorkspace; host canvases can implement the same
//       contract) calls window.open(url, '_blank') from the UNSANDBOXED
//       top-level context.

/** Parse filename from Content-Disposition (RFC 6266: filename* preferred). */
function dispositionFilename(disposition, fallback) {
  const d = disposition || '';
  const ext = /filename\*=(?:UTF-8'')?([^";]+)/i.exec(d);
  const plain = /filename=(?:")?([^";]+)/i.exec(d);
  const raw = (ext || plain)?.[1]?.replace(/"/g, '');
  if (!raw) return fallback;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** Probe endpoint headers without paying a full body transfer. */
async function probeDownload(url) {
  let res = null;
  try {
    res = await fetch(url, { method: 'HEAD' });
    if (res.status === 405 || res.status === 501) res = null; // no HEAD — fall back
  } catch { res = null; }
  if (!res) {
    res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    try { res.body?.cancel(); } catch { /* locked/absent body */ }
  }
  if (!res.ok && res.status !== 206) {
    let msg = `download failed (HTTP ${res.status})`;
    try { const j = await res.clone().json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
    if (res.status === 409) msg = `No downloadable document yet — ${msg.replace(/^no downloadable document:\s*/i, '')}`;
    return { ok: false, error: msg };
  }
  const cr = res.headers.get('content-range');
  const total = cr ? Number(cr.split('/')[1]) : Number(res.headers.get('content-length') || 0);
  return {
    ok: true,
    filename: dispositionFilename(res.headers.get('content-disposition'), null),
    bytes: Number.isFinite(total) ? total : 0,
    type: (res.headers.get('content-type') || '').split(';')[0],
  };
}

/** True when running inside ANY frame (incl. cross-origin, which throws). */
function isEmbedded() {
  try { return window !== window.top; } catch { return true; }
}

/** Tier (c): hidden same-origin iframe navigation at the endpoint. */
function iframeDownload(endpoint) {
  try {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    f.src = endpoint;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 30000);
    return true;
  } catch { return false; }
}

/** Tier (d): delegate to the parent frame (unsandboxed top-level context). */
function postMessageDelegate(endpoint) {
  try {
    const absolute = new URL(endpoint, window.location.origin).href;
    window.parent.postMessage({ action: 'download', url: absolute }, '*');
    return true;
  } catch { return false; }
}

/**
 * Install the parent-side delegation listener (call ONCE at app mount).
 * When THIS app is the parent of an embedded frame that posts
 * {action:'download', url}, open the download in a new top-level context.
 * Same-origin URLs only — never open arbitrary foreign URLs.
 */
export function installDownloadDelegationListener() {
  if (window.__odaDlListener) return;
  window.__odaDlListener = true;
  window.addEventListener('message', (e) => {
    const d = e?.data;
    if (!d || d.action !== 'download' || typeof d.url !== 'string') return;
    try {
      const u = new URL(d.url, window.location.origin);
      if (u.origin !== window.location.origin) return; // same-origin only
      window.open(u.href, '_blank', 'noopener');
    } catch { /* malformed URL — ignore */ }
  });
}

/**
 * Trigger a genuine browser save-to-disk of the run's final document.
 * @param {string} runId
 * @returns {Promise<{ok: boolean, filename?: string, bytes?: number, type?: string, via?: string, error?: string}>}
 */
export default async function downloadFinalDoc(runId) {
  const endpoint = `/api/oda/runs/${runId}/download`;
  try {
    // 0) Verify the endpoint actually serves a file BEFORE claiming anything.
    const meta = await probeDownload(endpoint);
    if (!meta.ok) return meta;
    const filename = meta.filename || `oda-final-${runId.slice(0, 8)}`;
    const embedded = isEmbedded();

    if (!embedded) {
      // (a) top-level page: plain same-origin anchor navigation — the
      // attachment disposition fires the native save; page never unloads.
      const a = document.createElement('a');
      a.href = endpoint;
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { ok: true, filename, bytes: meta.bytes, type: meta.type, via: 'top-level-navigation' };
    }

    // EMBEDDED CONTEXT — escape the frame's download restrictions.
    // (a) new top-level browsing context (works unless popups are blocked
    //     by a sandbox without allow-popups).
    const absolute = new URL(endpoint, window.location.origin).href;
    let via = null;
    let win = null;
    try { win = window.open(absolute, '_blank', 'noopener'); } catch { win = null; }
    if (win) {
      via = 'window-open';
    } else {
      // (b)/(c) popup blocked → hidden-iframe navigation (succeeds when the
      // frame tree has allow-downloads or is unsandboxed).
      if (iframeDownload(endpoint)) via = 'hidden-iframe';
      // (d) ALWAYS also delegate to the parent — under a sandbox without
      // allow-downloads the iframe attempt is silently blocked, and the
      // parent (host canvas) is the only context that can save. Harmless
      // duplicate-protection: hosts open a single new tab per message.
      if (postMessageDelegate(endpoint)) via = via ? `${via}+postMessage` : 'postMessage';
    }
    if (!via) return { ok: false, error: 'all download mechanisms blocked in this embedded context' };
    return { ok: true, filename, bytes: meta.bytes, type: meta.type, via };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
