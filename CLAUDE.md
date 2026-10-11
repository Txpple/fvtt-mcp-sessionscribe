# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# fvtt-mcp-sessionscribe

The home of **session summaries and analytics** for Foundry VTT (dnd5e) tables: an MCP server
(registered at user scope as `sessionscribe`), driven by Claude Code through the
`session-scribe` skill. It reads what happened at a session and writes the session record into
the campaign repo:
- **Inputs:** the Craig voice recording, the Foundry chat log, By the Books' combat stats
  (Battle Flow's before its 3.0.0 rename), the party's sheets.
- **Record:** transcripts, recaps, combat logs, GM notes, party snapshots.

It **reads the world and never writes it**. The session-diary page and the bestiary are authored
through `fvtt-mcp-dnd5e`.

**State (2026-10-11).** At **1.3.0** (2026-10-11, committed, not yet tagged or pushed): it reads
By the Books, Battle Flow's new name from its 3.0.0 (package id `fvtt-mod-bythebooks`,
Txpple/fvtt-mod-battleflow#6). The scan reads each card's stamps from the new flag scope and
falls back to `fvtt-mod-battleflow` on that same card, since pre-upgrade cards keep the old scope
forever; the probe reports `bythebooks { active, version, id }`, preferring the new id and
falling back to a table still on 2.x. Released as **1.0.0** on 2026-09-30; renamed from
`fvtt-app-sessionscribe` and moved under the suite folder on 2026-10-08 (`../fvtt-mcp-dnd5e`
still resolves; the campaign repos are `../../fvtt-campaign-*`). The server key is
`sessionscribe` since 2026-10-10 (was `scribe`; tools are `mcp__sessionscribe__*`); **1.1.0**
added the setup checks, **1.2.0** `npm run doctor` and `npm run install-skill`, **1.2.1** the
bridge's Assistant GM user as the scribe's login. The campaign it was built for concluded with
session 9 (2026-09-29). Pending: the 1.3.0 tag and push; a live read of a 3.0.0 card on the
sandbox once By the Books is installed there.
[NEXT-SESSION.md](NEXT-SESSION.md) is the handoff's history and the hard-won lessons;
[CHANGELOG.md](CHANGELOG.md) is the release record.
Broken out of `fvtt-mcp-dnd5e` by owner ruling (reversing that repo's 3.0 decisions #16 and
#17). All eight tools and the skill have landed.
- **Proven:**
  - build-transcript: parity on the 9 real sessions.
  - fetch-recording: the real 2026-09-22 zip, and the **Craig link** (2026-09-24, session 8
    replayed end to end on prod into a scratch clone).
  - transcribe-recording: on CUDA, resume included.
  - render-pdf: 2026-09-22's four PDFs, and their page images (2026-09-24).
- **Proven live on the sandbox, as Scribe Assistant** (a separate user then; the scribe joins as
  the bridge's user since 2026-10-10):
  - the reader's gate `scripts/verify-reader.mjs`;
  - parity with the MCP for analyze-combat, export-session-chat and snapshot-party.
- **Retired:** the MCP's copies went in `fvtt-mcp-dnd5e` 4.0.0 (`get-combat-stats`, the
  `session-scribe` skill and `session_scribe.py`). By the Books and the campaign repo point here.
  `export-chat-log` stays in the MCP for good as the general chat exporter.

## Commands

```bash
npm install                 # once; fvtt-mcp-dnd5e must be built first (its dist/ is the client)
npm run build               # scripts/prebuild.mjs (is fvtt-mcp-dnd5e built?), tsc → dist/, esbuild.page.mjs → dist/page.bundle.js
npm test                    # vitest, offline (src/**/*.test.ts)
npx vitest run src/transcript/align.test.ts   # one file; add -t "<name>" for one test
npm run check && npm run typecheck && npm test && npm run build && npm run knip   # the gate
FOUNDRY_HOST=local npm run doctor   # the setup, one ✓/✗/! line each (src/doctor.ts); joins once, read-only: a world-driver
npm run install-skill               # (re)links the skill into ~/.claude/skills; never clobbers a real folder
node scripts/call.mjs <tool> '<json>'   # one tool through a fresh dist/index.js; SCRIBE_CAMPAIGN_REPO / FOUNDRY_HOST in the env reach it
FOUNDRY_HOST=local node scripts/verify-reader.mjs   # sandbox only: the reader leaves no trace
FOUNDRY_HOST=local node scripts/parity-chat.mjs     # sandbox only: vs the MCP's export-chat-log (also parity-snapshot)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -PrefetchModel   # transcription venv
```

- **Every commit:** run the gate first. `npm run check:fix` applies biome's formatting.
- **The server runs from `dist/`,** so rebuild after a change. A new or renamed tool needs a
  Claude Code restart, which only the owner can do.

## Architecture

**The server**
- `src/index.ts` (stdio) runs `src/server.ts`, which is transport-agnostic; the tests drive it
  with an in-memory client. At start it logs (stderr, `[sessionscribe]`) whether
  `SCRIBE_CAMPAIGN_REPO/campaign.json` exists; a missing one is a warning, not an exit.
- `src/registry.ts` is the one name → handler map. The advertised list is derived from it, and a
  mismatch fails fast.
- Each tool is a class in `src/tools/` with a hoisted zod schema; `src/utils/schema.ts` generates
  the JSON Schema. Keep the family's prose budget: a description ≤ 400 chars, a leaf
  `.describe()` ≤ 120.

**Config and the record**
- `src/config.ts` reads this repo's `.env` once. Foundry host URLs and the admin key are not
  here; they come from `fvtt-mcp-dnd5e`'s `.env` through its client.
- `src/campaign.ts` enforces `campaign.json`. `resolveSessionDir` is the one way a `date` becomes
  a session directory.
- `src/record.ts` measures a session against today's `sessions.outputs`.

**Foundry reads never run in the server**
- `src/foundry/read.ts` spawns `src/workers/foundry-read.ts` per read: request on stdin, one
  sentinel-prefixed reply line on stdout, killed after its watchdog.
- The worker uses `src/foundry/session.ts`, shared with the parity scripts:
  - It joins as `FOUNDRY_SCRIBE_USER` / `FOUNDRY_SCRIBE_PASSWORD` (both required), with the
    admin key stripped. On the house worlds that is the bridge's own Assistant GM user
    (`Assistant DM`), by owner ruling 2026-10-10, to stop user bloat; a separate Assistant GM
    user also works. Why sharing is safe: By the Books' single-applier check is
    `game.users.activeGM?.isSelf`, per user, so two clients on one user would both apply, but
    only while that user is the elected GM. Foundry elects the highest-role active GM, so with
    the DM (Gamemaster) connected the Assistant GM user is never elected, and
    `protocol.refusal()` refuses a read when the joined user is the elected GM while a combat
    runs, which covers the bridge too. Verified on the sandbox 2026-10-10: the scribe joined as
    the bridge's user while the bridge was connected, hung up, and the bridge stayed connected.
  - The join is `fvtt-mcp-dnd5e`'s client; when it fails on a user not in the world,
    `protocol.scribeUserMissing()` rewrites the error to name `FOUNDRY_SCRIBE_USER`, list the
    world's users and say the fix.
  - It injects `dist/page.bundle.js` as `window.__scribe`.
  - It probes the world, and `protocol.refusal()` refuses another world, a login below Assistant
    GM, or the scribe's user being the elected GM while a combat runs.
- The page ops (`src/page/*.ts`) are browser-only and answer JSON strings.
  - Watch for `Set`s: the JSON boundary flattens them to `{}`.

**Long steps are detached jobs**
- `src/jobs.ts`: the stdio of every job goes to `<session>/audio/.jobs/<kind>.log`, never the
  MCP's stdout.
- The worker keeps its own status file. Secrets travel in the worker's env only.
- The workers:
  - `src/workers/fetch-recording.ts` runs `src/fetch.ts` and `src/craig.ts`.
  - `worker/transcribe.py` is faster-whisper, the only Python.
- `scribe-status { date, waitSeconds }` follows a job.

**The ports**
- `src/analytics/combat.ts` and `src/page/combat-stats.ts` were ported verbatim from the MCP's
  `get-combat-stats`, adding only `until`. Since the MCP's 4.0.0 they are the only copy, so they
  are free to evolve. The scan's key list is the read contract in By the Books'
  `ARCHITECTURE.md` §4. Its flags sit under `fvtt-mod-bythebooks` on cards written since 3.0.0
  and under `fvtt-mod-battleflow` on every earlier card (never migrated), so `stampScope` picks
  the scope per message, the new one first.
- `src/transcript/align.ts` is the retired `session_scribe.py align`, line for line, plus the
  whisper fix and `transcript-public.md`.
- `src/pdf.ts` prints with headless Edge, then rasterises every page as a JPEG: a pdf.js preview
  page opened by headless Chromium (`fvtt-mcp-dnd5e`'s Playwright, resolved through that
  package), under `audio/previews/<output>-NN.jpg`. The Browser pane is not used for the look.
- The trait meter ("traits denied") is arithmetic: the message's roll × the entry's save
  multiplier − the post-trait part. By the Books' `traits[]` label is not consulted (it misreads
  dnd5e's combined multiplier on a halved save).

**The skill:** `.claude/skills/session-scribe/`, with its templates. `npm run install-skill`
junctions it to `~/.claude/skills/session-scribe`, so it loads in any project.

**Test fixtures are synthetic** (`src/testing/`). No campaign fact belongs in this repo.

## Invariants

- **The DM does four things:** `/join` Craig, play, `/stop`, paste the link. Never ask them to
  mark, export or download anything; a spoken "mark that" is found by grepping the transcript.
- **Campaign facts live in the campaign repo, never here.** That covers names, the party,
  players, plot, house style and machine paths.
  - The contract is `../fvtt-mcp-dnd5e/.claude/skills/_shared/campaign-repo.md`.
  - The record layout is `sessions/YYYY-MM-DD/` and `party-snapshots/`; `session-audit` and
    `bestiary-builder` read it, so don't change it.
- **The spoiler boundary is a file.**
  - `transcript-public.md` withholds every whisper and blind roll.
  - `recap.html` and the session-diary page are written from it.
  - `transcript.md` (🤫 marked) may feed only `recap.md` and the GM notes.
- **`recap.html` is pasted into email**, so keep its inline-style table layout. `recap.pdf`
  prints from `recap-print.html`, never `recap.html`.
- **The Craig key is never persisted:** `craig-info.json` is sanitized. `audio/` is gitignored:
  the tracks, the job files, the PDF previews.
- **Timelines align by wall clock:** Craig's `startTime` vs the epoch-ms chat timestamps, plus
  `sessions.skewSeconds` (≈ 0 measured).

## Live checks

- **Sandbox only** (`FOUNDRY_HOST=local`), never prod.
- **One world-driver at a time.** Before a run:
  - check `node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs status`;
  - check that no By the Books suite (`tools/*.mjs`) is running.
  - Other sessions run those suites as Tester Assistant. The scribe must never borrow that
    identity (the bridge's user is fine; Tester Assistant is not).
- **Replays of real sessions** go to a scratch copy of the campaign repo (point
  `SCRIBE_CAMPAIGN_REPO` at it), never the real one.
  - The running `sessionscribe` server can't be re-pointed without a restart. Instead, drive a
    fresh `dist/index.js` over stdio with that env: `scripts/call.mjs <tool> '<json>'`; `dotenv`
    does not override a set variable.
  - A replay reads prod exactly as a real session does, and writes nothing to the world.
- **A user's first join to a world runs modules' first-run writes.** Dice So Nice whispers a
  welcome and sets a user flag. Scribe Assistant's first prod join did this (2026-09-24 01:19Z).
  It happens once per user per world, so `verify-reader` can't see it after the first time.

## Family conventions (shared across Open Roll 5e)

- Node ≥ 22, ESM, biome, `tsc`, vitest, knip. Tests run on fakes: injected HTTP, exec and world
  reader; never live APIs.
- **Tools do, skills decide.** Correctness goes in tested code; judgment (recap voice, which beats
  are memorable, curation) stays in the skill.
- Commit directly to `main` and push. MIT license, author Txpple. The remote is
  `Txpple/fvtt-mcp-sessionscribe`, **public** since 2026-09-24 (the owner's call), like the
  rest of Open Roll 5e. Issues from outside are accepted; pull requests are not.

## Machine gotchas (Windows)

- **msedge.exe is a launcher:** it exits in about 50 ms and a child process writes the PDF
  seconds later. `src/pdf.ts` waits for the file to settle. A PDF of about 1 KB means the page
  did not load.
- **Chromium's print honours a `.keep` wrapper only as its own formatting context**
  (`display: flow-root`): a plain-block keep is split when the heading fits at the page foot and
  its first block does not. `break-after: avoid` on a heading is ignored outright.
- **Windows Application Control can block the uv-managed Python's DLLs** (an `_ctypes`
  ImportError). The fix is a venv on a signed python.org install. Never touch the policy itself.
- **ctranslate2 needs the pip-installed NVIDIA `bin` directories on `PATH`;**
  `add_dll_directory` alone is not enough. The worker handles it.
- **Python on Windows writes text files as CRLF,** and the port writes LF. Compare line by line
  with `\r?\n`.
- **Craig recordings expire after 7 days** (the page says 14; the API is right). The DM's own
  zip is `fetch-recording { zipPath }`, with speakers mapped by Discord id: track order differs
  per recording.
