// imageSource.js — deliverable imagery for the ODA builders (2026-07-24).
// Sources a relevant image for a pptx/pdf deliverable, PERPLEXITY FIRST
// (plugin-1722260873 — real, sourced photography), falling back to GPT IMAGE 2
// (plugin-1776826082 — generated editorial imagery) only when Perplexity yields
// nothing usable. The chosen URL is downloaded here and handed to the builders
// as an embeddable buffer + data URI, exactly as the ODA logo is embedded — so
// the network never touches the deterministic builders themselves.
//
// Contract: EVERY path is guarded and returns null on failure. Imagery is a
// visual enhancement, never a gate — a plugin outage or a dead URL must never
// break packaging (the builders simply render without the image).
import { createOdSession, syncQuery } from '../ondemand.js';
import { ADOPTED } from '../plugins.js';

const PERPLEXITY = ADOPTED.perplexity.id; // plugin-1722260873 (preferred)
const GPT_IMAGE_2 = ADOPTED.gptImage2.id; // plugin-1776826082 (fallback)

// Direct image-file URLs (png/jpg/jpeg only — the two formats BOTH pdfkit and
// pptxgenjs embed reliably; webp/gif are intentionally excluded).
const IMG_URL_RX = /https?:\/\/[^\s)"'<>\]]+?\.(?:png|jpe?g)(?:\?[^\s)"'<>\]]*)?/gi;
const ANY_URL_RX = /https?:\/\/[^\s)"'<>\]]+/g;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB sanity cap

/** True unless imagery is explicitly disabled for this deployment. */
export const IMAGES_ENABLED = process.env.ODA_DELIVERABLE_IMAGES !== '0';
// Auto-fetched (non-authored) section images per deliverable — bounds added
// latency. Authored ![](url) images are always embedded and don't count here.
// Applies to BOTH decks and documents so PDFs get figures too, not just a hero.
// Bounded by the per-call timeouts + global budget below so latency stays sane.
const MAX_AUTO_SECTION_IMAGES = Number(process.env.ODA_SECTION_IMAGES ?? 2);
// Per-provider and whole-enrichment latency caps (ms) — a slow provider must
// never dominate packaging (observed 200s+ before these were added).
const PERPLEXITY_TIMEOUT_MS = Number(process.env.ODA_IMG_PERPLEXITY_MS ?? 20000);
const GPT_IMAGE_TIMEOUT_MS = Number(process.env.ODA_IMG_GPT_MS ?? 45000);
const ENRICH_BUDGET_MS = Number(process.env.ODA_IMG_BUDGET_MS ?? 75000);

/** Resolve to `fallback` if `p` doesn't settle within `ms`. */
function withTimeout(p, ms, fallback = null) {
  return Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Ranged GET to confirm a URL really resolves to a png/jpeg image. */
async function isLiveImage(url) {
  try {
    const r = await fetch(url, {
      method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    return (r.ok || r.status === 206) && /image\/(png|jpe?g)/.test(ct);
  } catch {
    return false;
  }
}

/** First live png/jpeg URL found in a plugin answer (typed matches first). */
async function firstLiveImageUrl(answer) {
  const seen = new Set();
  const typed = answer.match(IMG_URL_RX) || [];
  const any = answer.match(ANY_URL_RX) || [];
  for (const u of [...typed, ...any]) {
    if (seen.has(u)) continue;
    seen.add(u);
    if (await isLiveImage(u)) return u;
  }
  return null;
}

/**
 * Find ONE image URL for a subject: Perplexity first, GPT Image 2 fallback.
 * Each call owns its OnDemand session so lookups are safe to run in parallel.
 * @returns {Promise<{url: string, source: 'perplexity'|'gptImage2'}|null>}
 */
export async function findImage({ externalUserId, subject, orientation = 'landscape' }) {
  if (!IMAGES_ENABLED) return null;
  const subj = String(subject || '').trim().slice(0, 200);
  if (!subj) return null;
  let session;
  try {
    session = await createOdSession(externalUserId, [PERPLEXITY, GPT_IMAGE_2]);
  } catch (err) {
    console.warn(`[oda-image] session unavailable (${err.message}) — skipping image`);
    return null;
  }
  // 1) PREFERRED: Perplexity — real, sourced photography. Ask for image LINKS
  // ONLY (several candidates so firstLiveImageUrl can pick one that resolves).
  const pplx = await withTimeout(syncQuery({
    odSessionId: session, pluginIds: [PERPLEXITY],
    query: `Give me direct image links only for ${orientation} photographs illustrating: ${subj}. Return up to 5 direct, publicly accessible image FILE URLs that each end in .jpg, .jpeg or .png (real image files, NOT web pages or search results). Output the raw URLs ONLY — one per line, nothing else: no titles, no descriptions, no markdown, no numbering, no commentary.`,
  }), PERPLEXITY_TIMEOUT_MS, '');
  const pu = await firstLiveImageUrl(pplx || '');
  if (pu) return { url: pu, source: 'perplexity' };
  // 2) FALLBACK: GPT Image 2 — generated editorial imagery, on brand.
  const gen = await withTimeout(syncQuery({
    odSessionId: session, pluginIds: [GPT_IMAGE_2],
    query: `Generate ONE ${orientation}, photorealistic, editorial image for an Office of Development Affairs (Abu Dhabi) briefing that illustrates: ${subj}. No text, no logos, no watermarks; restrained, institutional tone. Return ONLY the generated image URL.`,
  }), GPT_IMAGE_TIMEOUT_MS, '');
  const gu = await firstLiveImageUrl(gen || '');
  if (gu) return { url: gu, source: 'gptImage2' };
  return null;
}

/**
 * Download an image URL into an embeddable form for the builders.
 * @returns {Promise<{buffer: Buffer, ext: 'png'|'jpeg', dataUri: string, url: string}|null>}
 */
export async function downloadImage(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!/image\/(png|jpe?g)/.test(ct)) return null;
    const buffer = Buffer.from(await r.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;
    const ext = ct.includes('png') ? 'png' : 'jpeg';
    return { buffer, ext, dataUri: `data:image/${ext};base64,${buffer.toString('base64')}`, url };
  } catch {
    return null;
  }
}

/**
 * Resolve an authored URL or a subject lookup into image data. Always returns
 * the URL + alt + source (so off-box tools like the OnDemand Agent can embed it);
 * buffer/dataUri are added only when the byte-download succeeds (for the local
 * builders). Returns null only when no image could be found at all.
 */
async function resolveImage({ externalUserId, url = null, subject = null, orientation = 'landscape', alt = '' }) {
  let chosen = url ? { url, source: 'authored' } : null;
  if (!chosen && subject) chosen = await findImage({ externalUserId, subject, orientation });
  if (!chosen) return null;
  const meta = { url: chosen.url, alt: String(alt || subject || '').slice(0, 200), source: chosen.source };
  const dl = await downloadImage(chosen.url);
  return dl ? { ...dl, ...meta } : meta;
}

/**
 * Enrich a parsed content spec with embeddable imagery IN PLACE, then return it.
 * Sets spec.heroImage (cover) and section.image on visual sections. Author-
 * provided ![](url) images are always embedded; a bounded number of extra
 * images are auto-sourced for text-forward sections to fill visual space.
 * Fully guarded — any failure leaves the spec unchanged and never throws.
 *
 * @param {object} spec parsed content spec (from parseContentSpec)
 * @param {{externalUserId: string, format: string, subjectHint?: string}} opts
 * @returns {Promise<object>} the same spec
 */
export async function attachDeliverableImages(spec, { externalUserId, format, subjectHint = '' }) {
  if (!IMAGES_ENABLED || !spec) return spec;
  try {
    const baseSubject = [spec.title, subjectHint].filter(Boolean).join(' — ').slice(0, 200);
    const used = new Set();
    const tasks = [];

    // Cover/hero: first authored image, else a fetched one for the whole subject.
    const heroRef = (spec.imageRefs || [])[0] || null;
    tasks.push((async () => {
      const hero = await resolveImage({
        externalUserId, url: heroRef?.url || null, subject: baseSubject,
        alt: heroRef?.alt || spec.title, orientation: 'landscape',
      });
      if (hero) { spec.heroImage = hero; used.add(hero.url); }
    })());

    // Section images: authored refs always; auto-fetch a bounded number for
    // sections that aren't a pure table (the plugin lays out figures itself, so
    // big-number sections are eligible too — this gives documents figures, not
    // just a hero).
    let autoBudget = MAX_AUTO_SECTION_IMAGES;
    for (const sec of spec.sections || []) {
      const hasAuthorRef = !!sec.imageRef;
      const wantAuto = !hasAuthorRef && autoBudget > 0 && !sec.table;
      if (!hasAuthorRef && !wantAuto) continue;
      if (wantAuto) autoBudget -= 1;
      tasks.push((async () => {
        const img = await resolveImage({
          externalUserId,
          url: hasAuthorRef ? sec.imageRef.url : null,
          subject: hasAuthorRef ? sec.imageRef.alt : `${sec.heading} — ${baseSubject}`,
          alt: sec.imageRef?.alt || sec.heading, orientation: 'landscape',
        });
        // Never repeat the hero image on a content slide/page.
        if (img && !used.has(img.url)) { sec.image = img; used.add(img.url); }
      })());
    }

    // Whole-enrichment budget: attach whatever resolved in time; abandon the
    // rest so a slow provider can't stall packaging (tasks mutate spec directly).
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => setTimeout(resolve, ENRICH_BUDGET_MS)),
    ]);
  } catch (err) {
    console.warn(`[oda-image] enrichment skipped (${err.message}) — building without imagery`);
  }
  return spec;
}
