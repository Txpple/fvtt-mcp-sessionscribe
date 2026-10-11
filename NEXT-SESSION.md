# Next session: the handoff

First written 2026-09-23 at the end of the session that built this repo (M1–M11). Updated the
same evening, once the live gates, the MCP retirement and the doc pointers had landed, and on
2026-09-24 after the session-8 end-to-end replay. Read
`CLAUDE.md` first (architecture, invariants, live-check rules). This file is the work that is
left, in order, with its gates. Update it as you go, and delete a step's block when it lands.

## Where things stand

- **Built, on `main`, pushed** (`Txpple/fvtt-mcp-sessionscribe`, public since 2026-09-24):
  - All eight tools.
  - The `session-scribe` skill, junctioned to `~/.claude/skills/session-scribe`.
  - The server, registered at user scope as `sessionscribe` (`FOUNDRY_HOST=molten`) in
    `~/.claude.json`; it was `scribe` until 2026-10-10.
- **The offline gate** is green: 128 tests (2026-09-30).
- **Proven for real:**
  - `build-transcript`: parity with the Python `align` on all 9 real sessions; the only
    differences are 77 whisper fixes.
  - `fetch-recording`: the zip path on the real 2026-09-22 zip.
  - `transcribe-recording`: on CUDA through the job path, resume included.
  - `render-pdf`: 2026-09-22's four PDFs match the committed page counts and sizes; the page
    images, on the replay's combat log and story notes (2026-09-24).
- **Proven live on the sandbox (2026-09-23 evening; Foundry 14.368, dnd5e 6.0.5, Battle Flow
  2.0.5; the scribe was the only GM connected, so it was the elected GM):**
  - `verify-reader`: 4/4. No user is left connected, and nothing is modified during the join or
    in 30 s of idle.
  - Parity with the MCP:
    - `analyze-combat`: 10/10 windows (176 stamped, 126 d20s).
    - `export-session-chat`: 10/10 (531 records, 10 whispered).
    - `snapshot-party`: 4/4 PCs byte-identical.
    - Chat and snapshot were re-run against MCP 4.0.0 and are still identical.
  - **Coverage caveat:** the world's chat starts at 2026-09-22. Every earlier window therefore
    holds the whole log, and the combat and chat parity really compared two inputs.
- **Retired:** `fvtt-mcp-dnd5e` 4.0.0 (33a8a70 design, 4fb1a9f release, tag `v4.0.0`, pushed).
  - `get-combat-stats`, the `session-scribe` skill and `session_scribe.py` are gone from the MCP.
  - `export-chat-log` stays there.
  - The scripts `parity-combat.mjs` and `parity-transcript.mjs` went with their references.
    `parity-chat.mjs` and `parity-snapshot.mjs` stay, as regression checks against the MCP's
    exporters.
- **Doc pointers landed:**
  - Battle Flow 863a1f4 (`ARCHITECTURE.md` §4, `DESIGN.md`).
  - The campaign repo 39ed5ca: `sessions/README.md`, `STYLE.md` and three notes. The desktop machine's
    auto-sync committed those edits as "notes sync" before I could; the content is ours.
- **Proven on prod (2026-09-23 21:19, after the owner's restart):**
  - `scribe-status { connect: true }` joined as Scribe Assistant (role 3), the only GM and so the
    elected GM, with no combat running. It reported 485 messages and Battle Flow **2.0.4**.
  - Prod's user count was 0 before and 0 after.
  - `get-combat-stats` is gone from both `foundry-*` registrations.
- **Proven end to end (2026-09-24):** session 8 was replayed from its Craig link through every
  step into a scratch clone of the campaign repo. The outputs are on the owner's Desktop (`Greenrest
  Session 8 (replay)`, with `REVIEW.md`). Details are below.
- **Owner rulings in force (2026-09-23):**
  - The scribe logs in as the bridge's own Assistant GM user (owner ruling 2026-10-10, replacing
    the separate Scribe Assistant user of 2026-09-23): `FOUNDRY_SCRIBE_USER` /
    `FOUNDRY_SCRIBE_PASSWORD` in `.env` carry the bridge's login. See CLAUDE.md for why it is safe.
  - **`export-chat-log` stays in the MCP** as the general exporter.

**Before any sandbox run:**
- Check `FOUNDRY_HOST=local node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status`.
- Check for `node … tools/*.mjs` / `verify-*` processes:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- Other sessions run suites there: By the Books (Battle Flow until 3.0.0; Tester Assistant), and on
  2026-09-23 also `fvtt-mod-partystash`. The By the Books session announces a hold by cross-session message; wait
  for its all-clear.

## Landed: Battle Flow's newer stamp families (2026-09-23 evening)

The scan reads the contract table's 2026-09-01 and 2026-09-05 families: `reminder`,
`chipSpend`, `damageShield` and the maneuver / cast / emanation moments. On the 2026-09-22
window, stamped messages went 166 → 193, every existing number was unchanged, and the report
gained 32 reminders, 4 chips and 4 ward strikes. The owner saw the before and after.

**Contract drift, ruled and fixed (owner, 2026-09-23):** Battle Flow 91d2c16 made the table
match the code.
- `clockRiders` and `emanationCard` are rows now, and the scan reads them. Riders are counted by
  name; auras are named once, because the card is reposted each time the aura stands.
- `castApply.choice` is out: unstamped by ruling, since its effect is stamped in `effectReceipt`.
- The `reminder` row covers saves and concentration checks as well as attacks.
- On 2026-09-22: stamped 193 → 199, Jetten's Dreadful Strike ×3, Invictus's Aura of Protection.

## Landed: the session-8 replay (2026-09-24)

The owner asked for a full e2e test before session 9. Session 8 went through the skill end to end:
- from its Craig link, on prod, as Scribe Assistant;
- into a shallow clone of the campaign repo in the session scratchpad, with the remote removed;
- the tools driven through a fresh `dist/index.js` with `SCRIBE_CAMPAIGN_REPO` pointed at the
  clone (see CLAUDE.md, Live checks).

What it proved:
- **Craig link:** cook, 226 MB download and extract took 4 min 40 s. The speakers were mapped by
  Discord id, and the tracks were byte-identical to the DM's zip.
- **Transcription:** large-v3, 16 min on the 5090.
- **Parity with the original record:** chat 485/485; combat numbers identical in every fight;
  snapshot identical apart from dnd5e 6.0.3 → 6.0.5 and an aura-effect edit on prod since the wrap.
- **PDF page counts:** 13 / 7 / 4 / 4, against 13 / 8 / 5 / 4.
- **Illustrations:** 9 new illustrations, ≈ $2.27 on Flash.
- Two fixes landed with it:
  - the cook progress line (`[object Object]`, since Craig's state is an object);
  - progress inside a transcription track.
- Documented: the first-join Dice So Nice write.

## Landed: the five pre-session-9 items (2026-09-24, owner's go-ahead on all)

1. **`render-pdf` writes page images.** Each PDF's pdf.js preview is opened by headless
   Chromium (`fvtt-mcp-dnd5e`'s Playwright, resolved through that package) and every canvas is
   saved as `audio/previews/<output>-NN.jpg`; the tool lists them and refuses a count that
   differs from the PDF's pages. Skill step 6 reads the images. Measured on the replay: 7 + 5
   pages printed and rasterised in 3.7 s.
2. **"traits denied" is arithmetic now.** Battle Flow labels `traits[]` from dnd5e's per-part
   `active.multiplier`, which already has the save's halving folded in, so on a halved save
   "saved, no resistance" is labelled resistant and "saved and resistant" (× 0.25) gets no label
   (session 8: Gren 32 → 8 unlabelled, Morgash 32 → 16 "resistant", both fireballs on the
   dragon "resistant"). The meter is now roll × the entry's save multiplier − the part, label
   ignored. On the real scan the dragon fight reads Gren 15, Morgash 8, Invictus 38, Jetten 16:
   the by-hand count exactly. **Battle Flow's label is fixed at the source too** (54450ec,
   2026-09-24, owner's go-ahead): `traitOutcome` divides the caller's multiplier out.
   Released as Battle Flow **v2.0.7** (c76ab36, GitHub release with both assets) and
   hot-deployed to prod, byte-identical, with nobody but the bridge connected; the version
   string vends 2.0.6 until the Foundry process next restarts, as always. Rows stamped before
   keep their old labels; the scribe's meter never reads them.
3. **Templates: `.keep` groups in combat-log and gm-notes**, heading + first block, as in
   recap-print. Measured on the real combat log: a plain-block keep is still split when the
   heading fits at the page foot and its block does not (2 of 11 pixel offsets); with
   `display: flow-root` it held at every offset. All three templates' keeps are flow-root now.
4. **`snapshot-party` digests carry `features`** (feat and spell items with limited uses:
   name, remaining, max, recovery period) **and `effects`** (what `appliedEffects` holds:
   name, source, temporary, remaining duration). Skill step 7 lists them.
5. **`scripts/call.mjs <tool> '<json>'`** drives one tool through a fresh `dist/index.js`;
   the environment (`SCRIBE_CAMPAIGN_REPO`, `FOUNDRY_HOST`) reaches it.

**Needs the owner's restart of the `scribe` server:** items 1, 2 and 4 changed `dist/`.

## Landed: fighting styles in the combat stats (2026-09-26, d523366)

The scan reads Battle Flow's `fightingStyle` record and tallies it per attacker: rolls changed
and the damage each style added (Great Weapon Fighting's raised dice, Dueling's and Thrown's +2,
Two-Weapon's modifier). An entry that added nothing is skipped. The report line reads
"fighting styles: Great Weapon Fighting x2 (+5 dmg)". The damage itself was already in `dealt`
through the receipt; `gain` says how much of it the style was.

**Changed `dist/`** (rebuilt with the commit). Session 9's combat log was produced after it.

## Landed: session 9, the finale (2026-09-29)

Processed end to end in the campaign repo's own session, not here: `fvtt-campaign-greenrest`
f70347a ("session: 2026-09-29 — The Heart Knot (the finale)"). The four documents as HTML and
PDF, nine illustrations, transcript, chat log, combat stats, the end-of-campaign party snapshot,
and the Session Diary page in the world.

## What is left

- Nothing. The campaign has concluded (owner, 2026-09-30: "we are done"). The server stays as it
  is for the next campaign; the record layout and the campaign-repo contract are unchanged.

## Things learned the hard way

- **Whisper isn't deterministic run to run.** The same audio, model, library and machine gave
  1676 vs 1185 DM segments with equivalent words (temperature fallback). Compare content, not
  segment counts.
- **The Browser pane stalls pdf.js when it is hidden.** render-pdf writes page images instead.
- **Chromium's print splits a plain-block `.keep`** when the heading fits at the page foot and
  its block does not; `display: flow-root` on the keep is what holds. And when measuring
  breaks, an inserted empty `<section>` moves the layout by its padding: nudge with a margin.
- **Every Flash render needs the flaw pass.** In the replay it caught a second sword, a second maul
  head, five dirt wedges for four, and a whole heart drawn for a quarter.

- **Shell quoting eats Windows backslashes.**
  - Bash heredocs → `node -e` → JS strings turned `C:\Program Files` into `C:Program Files` and
    `\t` into a tab (a registration in `~/.claude.json`, a sed on setup.ps1).
  - Use the Edit tool for any text with Windows paths, or forward slashes.
  - Back up `~/.claude.json` before touching it and diff it after.
- **msedge.exe returns before the PDF exists** (see `src/pdf.ts`).
- **A `Set` crosses the page JSON boundary as `{}`,** silently. dnd5e keeps masteries and item
  properties in Sets.
- **knip resolves the `file:../fvtt-mcp-dnd5e` junction to a real path** and calls the dependency
  unused. It is in `ignoreDependencies`, as in Battle Flow.
- **Biome rewrites some string escapes** (it turned `'\u00a0'` into a literal NBSP). Build
  invisible characters with `String.fromCharCode`.
- **Vitest re-runs a test file that another test file imports.** Shared fakes live in
  `src/testing/`.
- **The running `sessionscribe` server reads `.env` once, at start.** A password filled in
  afterwards needs a restart; the scripts, as fresh processes, see it at once.
- **The MCP's scripts need `FOUNDRY_HOST`,** even ones that never touch a world
  (`verify-toolsets`). Unset means `generic`, whose placeholder URL makes the server refuse to
  start.
- **The campaign repo auto-syncs** (the "notes sync" commits from the session hooks). Uncommitted edits there
  get swept into a generic commit, so commit promptly with a real message.
