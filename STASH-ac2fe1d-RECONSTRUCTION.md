# Stash ac2fe1d — Preservation Record & Reconstruction (2026-07-21)

## Identity
- Stash commit: `ac2fe1d5a5b44a7b27c7cf9f980e550376d2e472` ("On (no branch): pre-sync local WIP (superseded by remote main)")
- Created: 2026-07-20 17:00:56 UTC on execution-pod clone; parent (base): `9bd6d53aedfa14169999de2ec91fcb0be962174c` (feat(ce-v2): consolidated build)
- Tracked delta vs parent (Phase-1 inspection, verbatim): `.env.example` +6 · `NOTES.md` +131 · `PLUGIN_TESTS.md` +105 → **+242 insertions, 0 deletions**
- Untracked third-parent tree: `BASELINE_AUDIT.md`, 6 baseline screenshots, 2 SSE logs

## Loss event (honest record)
The stash ref existed ONLY in an ephemeral execution-pod working copy. That pod was recycled
between sessions (2026-07-21, between the Phase-2 turn and this operation). Stash refs are never
pushed; no remote ref ever reached `ac2fe1d…`. In the current (fresh) clone:
`git stash apply stash@{0}` → `error: stash@{0} is not a valid reference`, and
`git cat-file -t ac2fe1d…` → object absent. **The stash commit object itself is therefore no
longer reachable from any surviving git store.** This operation did NOT drop it — the loss
predates this run; there was nothing left to drop or to keep.

## What IS preserved (three layers)
1. **Superseding committed content (in this branch's own history):** the stash message itself
   recorded it was "superseded by remote main". Verified against history reachable from this
   branch tip (`023ccec…`):
   - `NOTES.md`: +123 lines vs 9bd6d53 landed in `d453b87f7a419c4935c045feb2a58ed14741c09c`
   - `PLUGIN_TESTS.md`: +57 lines vs 9bd6d53 landed in `d453b87…`
   - Untracked tree: `BASELINE_AUDIT.md` + `baseline/` screenshots landed in `64a7126` (ancestor of this branch)
2. **Byte-exact patch archives (Phase-2, 2026-07-21 ~00:50 UTC):** before the Phase-2
   `git reset --hard`, the FULL stash was exported by immutable hash and uploaded as durable
   session artifacts (platform artifact store, session 6a5ec031ef7d1848e9c3828d, execution
   6a5ec04e193b04e98c3af638):
   - `stash-backup-ac2fe1d-pre-sync-wip.patch` (tracked +242, apply-ready)
   - `stash-backup-ac2fe1d-untracked.patch` (binary-safe third-parent tree)
   - `stash-backup-ac2fe1d-untracked-files.tar.gz` (same tree as file archive)
   - `stash-backup-ac2fe1d-via-stash-show.patch` (classic `git stash show -p` form)
   Retrieve them from the session's artifact/download list for that execution.
3. **This branch (`backup/stash-ac2fe1d-2026-07-21`):** pinned at `023ccec…`, whose tree already
   contains layer-1's superseded-equivalent content, plus this provenance record.

## Residual bytes NOT in any git commit (recoverable only via layer 2)
- `.env.example`: the +6 stash lines (no commit between 9bd6d53 and origin/main touches `.env.example`)
- `NOTES.md`: ~8-line delta between the stash variant (+131) and the committed variant (+123)
- `PLUGIN_TESTS.md`: ~48-line delta between the stash variant (+105) and the committed variant (+57)

## Restore commands
- Superseded-equivalent content: `git checkout backup/stash-ac2fe1d-2026-07-21 -- NOTES.md PLUGIN_TESTS.md`
- Byte-exact stash content: download `stash-backup-ac2fe1d-pre-sync-wip.patch` (Phase-2 artifact) →
  `git checkout 9bd6d53 && git apply stash-backup-ac2fe1d-pre-sync-wip.patch`
