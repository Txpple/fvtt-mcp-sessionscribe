# Changelog

What changed for a user of the tools and the skill, release by release. Dates are tag dates.

## Unreleased

- **`analyze-combat` reads every By the Books record of something that happened**: 53 flag
  families (was 28). The maneuvers and riders that rode a hit (the hit menu's picks, Commander's
  Strike's die, the sweep, Sneak Attack's dice, a spell's rider), the reactions and offers answered
  (the damage holds, a drop to 1, the death-save offer, the rebukes, a bystander's bend, the
  Initiative swaps and grants, a condition ended, the grapple's damage, a kit's tending, a rest
  grant), the dice changed after the roll, the summons and transformations, metamagic, and the
  chips and coatings spent now count among each actor's moments. A pool spent by hand
  (`poolSpend`) is skipped: By the Books' recorded contract shows it carries no stat stamp.
- **The report says what it skipped.** Its header ends with a `families skipped` line naming every
  By the Books family on the scanned cards that the fold does not read, with how many cards and why
  (a decision whose consequence another family records, sheet upkeep at a rest, a record with no
  stamp, or a family this build does not know).
- By the Books' contract: the scan is tested against its `contracts/card-flags.json` from a clone
  beside this repo (skipped without it); `contracts/consumes.json` names the version and the fields
  the fold touches.

## 1.3.0 — 2026-10-11 — reads By the Books, Battle Flow's new name

- **Battle Flow is now By the Books** (its 3.0.0, package id `fvtt-mod-bythebooks`), and the
  scribe reads both. `analyze-combat` takes each card's stamps from `flags["fvtt-mod-bythebooks"]`
  and falls back to `flags["fvtt-mod-battleflow"]` on that same card, family by family: cards
  written before a world upgraded keep the old scope forever (the module never migrates chat
  messages), so one session's log can hold both and is folded as one. A table still on Battle
  Flow 2.x reads as before.
- The world probe's module field is now `bythebooks: { active, version, id }` (was
  `battleflow: { active, version }`): By the Books if it is active, else Battle Flow if that is,
  and `id` says which was found. `scribe-status { connect: true }` returns it under the new name.
- Doctor, `verify-reader` and status lines name the module as `By the Books 3.0.0`, or
  `Battle Flow 2.17.0 (now By the Books)` on a table that has not upgraded; `, inactive` when it
  is installed but off. `analyze-combat`'s warning reads `By the Books is not installed in this
  world: no stamps to fold`. Tool descriptions, the skill, the combat-log template and the docs
  say By the Books.
- `.mcp.json.example` shows `FVTT_MCP_ENV`: a hosted world whose connection lives in its own fvtt-mcp-dnd5e env file needs it in the scribe's registration too, or molten reads fall back to `../fvtt-mcp-dnd5e/.env`.

## 1.2.1 — 2026-10-10 — the scribe may join as the bridge's Assistant GM user

- **The scribe may join as the `fvtt-mcp-dnd5e` bridge's own Assistant GM user**, and on the
  house worlds does (owner ruling, 2026-10-10, to stop user bloat): set `FOUNDRY_SCRIBE_USER` /
  `FOUNDRY_SCRIBE_PASSWORD` to the bridge's `FOUNDRY_USER` / `FOUNDRY_PASSWORD`. A separate
  Assistant GM user still works; both keys stay required. The "never the bridge's user" rule is
  gone from the docs and from the not-in-the-world message, whose fix now reads `set
  FOUNDRY_SCRIBE_USER to an existing Assistant GM (the bridge's user will do), or create it as
  one`. Why it is safe: Battle Flow's single-applier check (`game.users.activeGM?.isSelf`) is
  per user, so two clients on one user would both apply only while that user is the elected GM;
  Foundry elects the highest-role active GM, so with the DM connected as Gamemaster the
  Assistant GM is never elected, and the reader already refuses a read when its user is the
  elected GM while a combat runs. Verified on the sandbox: the scribe joined as the bridge's
  user while the bridge was connected, hung up, and the bridge stayed connected.
  `.env.example` now shows `Assistant DM` (the bridge's user) instead of `Scribe Assistant`.

## 1.2.0 — 2026-10-10 — npm run doctor and npm run install-skill

- **`npm run doctor`** checks the whole setup in one pass, one line per check (✓ works, ✗ blocks
  a session and says the fix, ! worth knowing), and exits non-zero on any ✗:
  `fvtt-mcp-dnd5e` built; its `.env` found (`FVTT_MCP_ENV` respected); `FOUNDRY_HOST`'s server
  up with a world running; a real, read-only join as `FOUNDRY_SCRIBE_USER` (through the same
  reader child every tool uses) with its role; `campaign.json` valid and naming the joined world;
  Edge; the skill link; and, as `!` only, the Python venv and ffmpeg. (#2)
- **`npm run install-skill`** links the `session-scribe` skill into `~/.claude/skills/` (a
  junction on Windows, a symlink elsewhere). Rerunning it is safe: a link already pointing here
  is kept, a stale one left by a moved clone is replaced, and a real folder there is never
  touched. It replaces the README's hand-typed `New-Item -ItemType Junction`. (#2)
- README: which tools need the transcription toolchain (only `transcribe-recording`) and which
  need Foundry, Edge or nothing, so a machine can be set up in stages. (#2)
- `npm ci` no longer warns about install scripts: `package.json`'s `allowScripts` approves
  esbuild's `postinstall`, which only checks the platform binary esbuild ships with. It is
  approved by name, not pinned to a version, since two copies are in the tree (this repo's
  build and vitest's vite) and they move with every dependency bump. (#2)

## 1.1.0 — 2026-10-10 — the server key is sessionscribe; setup fails fast

- **The server key is `sessionscribe`** (was `scribe`), the repo's name part, as
  `fvtt-mcp-imagegen` registers as `imagegen`. Tools now appear as `mcp__sessionscribe__*`; the
  tool names themselves (`scribe-status`, `fetch-recording`, ...) and the env names
  (`SCRIBE_CAMPAIGN_REPO`, `FOUNDRY_SCRIBE_USER`, ...) are unchanged. **Rename your
  registration:** `claude mcp remove -s user scribe`, then
  `claude mcp add -s user sessionscribe ...` (or rename the `scribe` key under `mcpServers` in
  `~/.claude.json`), and restart Claude Code. Anything that names `mcp__scribe__*` tools (a
  permission allowlist, a campaign repo's notes) needs the same edit. Log lines read
  `[sessionscribe]`.
- The description says what it is: an MCP server (it was "an app" since the `fvtt-app-*` days).
- **A `FOUNDRY_SCRIBE_USER` that is not in the world fails at the join** with the world's users
  and the fix (`FOUNDRY_SCRIBE_USER 'X' not found in world 'Y'; users: A, B, C — create it as an Assistant GM,
  or set FOUNDRY_SCRIBE_USER to an existing one (never the bridge's user)`), instead of the
  client's generic join error.
- **`npm run build` checks `fvtt-mcp-dnd5e` is built first** (its `dist/` is the Foundry client)
  and says so in one line, instead of a wall of tsc errors.
- At start the server logs whether `SCRIBE_CAMPAIGN_REPO/campaign.json` exists (a warning, never
  an exit).
- Setup docs: `.env.example` says up top that the Foundry connection is
  `../fvtt-mcp-dnd5e/.env` and lists the keys read from it; `.mcp.json.example` uses the full
  `node.exe` path and names `FOUNDRY_HOST=local` beside `molten`; the README gives the
  `~/.claude.json` entry for installs without `claude` on PATH.

## 1.0.0 — 2026-09-30 — the scribe, proven on a full campaign

The first release. Everything below landed between 2026-09-23 and 2026-09-26 and was proven
on the Greenrest campaign's last two sessions: session 8 replayed end to end from its Craig
link into a scratch clone (2026-09-24), and session 9, the finale, processed for real
(2026-09-29).

**The app** (broken out of `fvtt-mcp-dnd5e` by the owner's ruling of 2026-09-23, reversing
that repo's 3.0 decisions #16 and #17; the MCP retired its copies in its 4.0.0):
- Eight tools, driven by Claude Code through the `scribe` MCP server:
  - `scribe-status`: health, the record's completeness against `campaign.json`, and following a
    detached job.
  - `fetch-recording`: the Craig recording from its link (cook, download, extract) or from the
    DM's own zip, speakers mapped by Discord id. A detached job; the Craig key is never
    persisted.
  - `transcribe-recording`: faster-whisper on CUDA, the one Python step, resumable.
  - `build-transcript`: the retired `session_scribe.py align` ported line for line, with the
    whisper fix and `transcript-public.md` (the spoiler-free transcript the recap is written
    from). Parity on the 9 real sessions.
  - `export-session-chat`: the night's chat log into `chatlog.json`, visibility spelled out.
    Parity with the MCP's `export-chat-log`.
  - `analyze-combat`: the MCP's `get-combat-stats` ported verbatim and scoped to the session's
    window, then extended: Battle Flow's 2026-09 stamp families (reminders, chips, wards,
    maneuvers, clock riders, emanations), an arithmetic "traits denied" meter, and the fighting
    styles tallied per attacker. Parity with the MCP on 10/10 windows before it evolved.
  - `snapshot-party`: the party's sheets at the wrap, byte-compatible with `manage-actors
    export`, with digests of limited-use features and active effects.
  - `render-pdf`: the session's PDFs printed with headless Edge from their print sources, page
    counts checked, and every page rasterised to `audio/previews/` for review.
- **The Foundry reader** joins as the scribe's own **Scribe Assistant** user, injects its own
  page bundle, and never writes the world. It refuses another world, a login below Assistant
  GM, or being the elected GM while a combat runs. Every read runs in a one-shot child with a
  watchdog. `scripts/verify-reader.mjs` proves it leaves no trace.
- **Long steps are detached jobs** with their own logs under `<session>/audio/.jobs/`.
- **The `session-scribe` skill**, rewritten to these tools, with the recap, combat-log and
  GM-notes templates. Print keeps use `display: flow-root`, the only keep Chromium honours.
- **The record** is written to the campaign repo (`sessions/YYYY-MM-DD/`, `party-snapshots/`),
  per `fvtt-mcp-dnd5e`'s campaign-repo contract. No campaign fact lives in this repo.

**Verified** (2026-09-30): biome · `tsc --noEmit` · vitest 21 files, 128 tests · build · knip.
Live on the sandbox (2026-09-23): reader 4/4, parity 10/10 combat windows, 10/10 chat windows,
4/4 party snapshots byte-identical.
