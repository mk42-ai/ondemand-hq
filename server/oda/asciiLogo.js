// asciiLogo.js — terminal branding for the ODA Productivity Suite.
//
// Purely cosmetic, side-effect-free (bar the console.log calls it exists to
// make): a block-letter 'ODA' wordmark plus a couple of thin banner/footer
// helpers so every run is visually bookended in the server logs. No
// dependency on runStore/orchestrator — callers pass in whatever fields they
// have; nothing here reaches back into ODA state.
//
// Plain ES module, JSDoc typed, British-English comments, no new deps.

/**
 * Block-letter 'ODA' wordmark rendered in box-drawing characters, followed by
 * the department strapline and a thin rule. Every row is ≤ 68 characters so
 * it never wraps in a standard 80-column terminal.
 * @type {string}
 */
export const ODA_ASCII = `
   ██████╗   ██████╗    █████╗
  ██╔═══██╗  ██╔══██╗  ██╔══██╗
  ██║   ██║  ██║  ██║  ███████║
  ██║   ██║  ██║  ██║  ██╔══██║
  ╚██████╔╝  ██████╔╝  ██║  ██║
   ╚═════╝   ╚═════╝   ╚═╝  ╚═╝
  OFFICE OF DEVELOPMENT AFFAIRS · ABU DHABI
  ─────────────────────────────────────────`;

/**
 * Print the ODA logo plus the run's identifying details. Called at the START
 * of every run so the wordmark is the first thing an operator sees when
 * tailing terminal logs.
 * @param {{ runId: string, brain?: string, intent?: string }} p
 */
export function printRunBanner({ runId, brain, intent }) {
  console.log(ODA_ASCII);
  console.log(`  run  ${runId}`);
  console.log(`  brain ${brain || 'sonnet-5'} · interpreter glm-4.7`);
  if (intent) console.log(`  task ${intent.slice(0, 60)}`);
  console.log('');
}

/**
 * Print a compact 3-line footer marking the end of a run. Called once the run
 * has settled into a terminal (or otherwise final-for-now) status.
 * @param {{ runId: string, status: string, downloadUrl?: string|null }} p
 */
export function printRunFooter({ runId, status, downloadUrl }) {
  const ok = status === 'completed';
  console.log(`  ── ODA run ${ok ? 'complete' : 'failed'} ──`);
  console.log(`  run ${runId} → ${status}`);
  console.log(downloadUrl ? `  artifact ${downloadUrl}` : '  artifact (none)');
}
