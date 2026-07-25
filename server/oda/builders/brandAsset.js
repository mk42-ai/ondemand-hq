// brandAsset.js — resolves the ODA logo for embedding in generated deliverables.
// Local dev: public/oda-logo.png. Checks a few known locations and returns null
// if none exist (e.g. a serverless bundle that didn't ship the asset) so the
// builders degrade gracefully and NEVER crash on a missing file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveLogo() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'public', 'oda-logo.png'),   // repo public/
    path.join(__dirname, '..', '..', '..', 'dist', 'oda-logo.png'),     // built dist/
    path.join(__dirname, '..', '..', 'data', 'oda-logo.png'),           // server/data (serverless-bundled copy)
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/** Absolute path to the ODA logo PNG, or null if unavailable. */
export const ODA_LOGO_PATH = resolveLogo();

/**
 * Pre-faded (10% alpha) ODA watermark for document COVERS — the UI-spec
 * "subtle document-cover watermark". Same graceful-degrade contract as the
 * logo: null when the asset is absent so builders never crash.
 * Provenance: derived from the bundled official ODA logo (skills/design/assets
 * logo-oda.png lineage — oda.gov.ae / mediaoffice.abudhabi were unreachable at
 * fetch time, per ARCHITECTURE.md §1), pre-faded once so builders that lack
 * per-image opacity (pdfkit) still render it subtly.
 */
function resolveWatermark() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'public', 'oda-watermark-faded.png'),
    path.join(__dirname, '..', '..', '..', 'dist', 'oda-watermark-faded.png'),
    path.join(__dirname, '..', '..', 'data', 'oda-watermark-faded.png'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/** Absolute path to the pre-faded ODA cover watermark PNG, or null. */
export const ODA_WATERMARK_PATH = resolveWatermark();

/**
 * PUBLIC, absolute URL of the ODA logo, for tools that render off-box (the
 * OnDemand Agent builds documents on its own servers and cannot read our local
 * file path). Resolved from an explicit override, else a public base URL, else
 * the Vercel deployment URL; null when no public origin is known.
 */
// Public, hotlinkable ODA logo hosted on imgbb — used by off-box tools (the
// OnDemand Agent) that can't read our local file. Override with ODA_LOGO_URL.
const DEFAULT_PUBLIC_LOGO_URL = 'https://i.ibb.co/35N5XDZ7/Screenshot-2026-07-24-at-7-07-23-PM.png';

function resolveLogoUrl() {
  if (process.env.ODA_LOGO_URL) return process.env.ODA_LOGO_URL;
  const base = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (base) return `${base.replace(/\/$/, '')}/oda-logo.png`;
  return DEFAULT_PUBLIC_LOGO_URL;
}

/** Public https URL to the ODA logo, or null if no public origin is configured. */
export const ODA_LOGO_URL = resolveLogoUrl();
