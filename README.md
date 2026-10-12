# fvtt-mcp-sessionscribe

[![CI](https://github.com/Txpple/fvtt-mcp-sessionscribe/actions/workflows/ci.yml/badge.svg)](https://github.com/Txpple/fvtt-mcp-sessionscribe/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server that turns a night at a **D&D 5e**
[Foundry VTT](https://foundryvtt.com) table into its session record. It reads four inputs: the
[Craig](https://craig.chat) recording from Discord, the Foundry chat log,
[By the Books](https://github.com/Txpple/fvtt-mod-battleflow)' combat stats (Battle Flow before
its 3.0.0 rename; cards from either are read) and the party's sheets. From them it writes a speaker-labelled transcript, a player recap (email and PDF), a
combat report, GM notes and a party snapshot into your campaign repo.

[Claude Code](https://claude.com/claude-code) drives it. The server is registered as
`sessionscribe`, and its `session-scribe` skill runs the pipeline end to end, where
[`fvtt-mcp-dnd5e`](https://github.com/Txpple/fvtt-mcp-dnd5e) is a general bridge to Foundry's API.
It **reads the world and never writes it**; the session-diary page goes in through `fvtt-mcp-dnd5e`.

**At the table, the DM does four things:** `/join` Craig, play, `/stop`, and paste the link to
Claude. There is nothing to mark, export or download. A "mark that" said aloud is found in the
transcript.

## Setup

```bash
git clone https://github.com/Txpple/fvtt-mcp-sessionscribe && cd fvtt-mcp-sessionscribe
npm install && npm run build      # fvtt-mcp-dnd5e must be cloned beside this repo and built first
cp .env.example .env              # FOUNDRY_SCRIBE_USER / FOUNDRY_SCRIBE_PASSWORD, SCRIBE_CAMPAIGN_REPO
claude mcp add -s user sessionscribe -e FOUNDRY_HOST=molten -- node /absolute/path/to/fvtt-mcp-sessionscribe/dist/index.js
```

- **The Foundry connection is `fvtt-mcp-dnd5e`'s `.env`,** not this repo's: fill that in first
  (the server URL and world). This repo's `.env` holds only the scribe's own login, the campaign
  repo and the toolchain paths. `npm run build` stops with a one-line message if
  `fvtt-mcp-dnd5e` is not built yet.
- **No `claude` on PATH?** A desktop-app install of Claude Code may not put the CLI on PATH. Add
  the same server by hand under `mcpServers` in `~/.claude.json` (as in
  [`.mcp.json.example`](.mcp.json.example)), with the full path to `node.exe`:

  ```json
  "sessionscribe": {
    "command": "C:/Program Files/nodejs/node.exe",
    "args": ["/absolute/path/to/fvtt-mcp-sessionscribe/dist/index.js"],
    "env": { "FOUNDRY_HOST": "molten" }
  }
  ```

  Back up `~/.claude.json` before editing it.

Then, once per machine:

- **The skill, in every project.** Run `npm run install-skill`. It links
  `.claude/skills/session-scribe` into `~/.claude/skills/` (a junction on Windows, a symlink
  elsewhere), so a `git pull` here updates it. Rerunning it is safe: a link already pointing here
  is kept, a stale one (a moved clone) is replaced, and a real folder there is never touched.
- **The scribe's Foundry user.** `FOUNDRY_SCRIBE_USER` / `FOUNDRY_SCRIBE_PASSWORD` name an
  Assistant GM user in the world. The `fvtt-mcp-dnd5e` bridge's own Assistant GM user will do
  (copy its `FOUNDRY_USER` / `FOUNDRY_PASSWORD`), so no extra user is needed; a separate Assistant
  GM user works too. Sharing the bridge's user is safe while the DM is connected as Gamemaster:
  Foundry elects the highest-role GM, so the shared user never runs By the Books' GM-only
  automation, and a read is refused if the scribe's user is the elected GM during a combat. If
  `FOUNDRY_SCRIBE_USER` names no user in the world, a read fails at the join, naming it and
  listing the world's users.
- **Check it all:** `npm run doctor` (add `FOUNDRY_HOST=local` for a local Foundry). It prints
  one line per check: ✓ works, ✗ blocks a session (with the fix), ! worth knowing. It exits
  non-zero on any ✗. It covers `fvtt-mcp-dnd5e`'s build and `.env` (`FVTT_MCP_ENV` respected),
  the Foundry server, a real join as `FOUNDRY_SCRIBE_USER` with its role, the campaign repo and
  its world, Edge, the skill link and the transcription toolchain. The join is read-only and
  hangs up before the doctor exits.
- **Transcription toolchain** (optional at first, see below). Run
  `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -PrefetchModel`. It installs
  ffmpeg and uv, builds a Python venv (`~/.session-scribe/venv`) with faster-whisper and the CUDA
  wheels, and runs a smoke test. It is idempotent.
- **Restart Claude Code** and ask for `scribe-status`, which reports anything missing.

**Staging the setup.** Only `transcribe-recording` needs the transcription toolchain (ffmpeg,
uv and the faster-whisper venv from `setup.ps1`); the doctor marks it `!`, not `✗`. Everything
else works without it:

| Needs | Tools |
| --- | --- |
| nothing but the campaign repo | `scribe-status`, `build-transcript` (from the session's `craig-info.json`, `transcript-segments.json` and, optionally, `chatlog.json`) |
| Windows' own `tar.exe` and the network | `fetch-recording` |
| the transcription toolchain | `transcribe-recording` |
| Foundry: `fvtt-mcp-dnd5e` built, its `.env`, the scribe's user | `export-session-chat`, `analyze-combat`, `snapshot-party` |
| Edge, and `fvtt-mcp-dnd5e`'s Playwright Chromium for the page images | `render-pdf` |

So a machine can produce the chat export, the combat report, the party snapshot and the PDFs
before the GPU side is set up, and add transcription later.

`FOUNDRY_HOST` is `molten` (a hosted world) or `local` (a Foundry on this machine). It sets the
default host for reads, and each read tool can override it per call. The host URLs come from `fvtt-mcp-dnd5e`'s `.env`, not this repo's.

**Requirements:**
- Windows and Node.js 22+.
- `fvtt-mcp-dnd5e`, built, beside this repo.
- Microsoft Edge, for the PDFs.
- An NVIDIA GPU for transcription. The CPU works, but slower.
- A dnd5e world. By the Books (or Battle Flow 2.x) is needed only for the combat report.
- The Craig bot in your Discord server.
- A campaign repo: `campaign.json` + `STYLE.md`, as described in
  [`campaign-repo.md`](https://github.com/Txpple/fvtt-mcp-dnd5e/blob/main/.claude/skills/_shared/campaign-repo.md).

## The skill

Paste a Craig link, or say **"process the session"**. The `session-scribe` skill runs the
pipeline in this order:
1. Check, fetch and transcribe.
2. Export the chat log, build the transcript and analyse the combat.
3. Write the recap, the combat log and the GM notes.
4. Render the PDFs and look at every page.
5. Snapshot the party and add the session-diary page.
6. Commit to the campaign repo.

The tools handle correctness and the skill handles judgment: the recap's voice, which beats
matter, and the illustrations, which it makes with
[`fvtt-mcp-imagegen`](https://github.com/Txpple/fvtt-mcp-imagegen)'s `illustration-builder`.

**The illustrations.** When `campaign.json` turns them on, the recap comes back illustrated:
eight or nine plates a session, one for about every story section, the quiet town moments as
much as the big fight. Each one is grounded before it is prompted: who was there and where it
happened are checked against the transcript, the scene's battlemap gives the terrain, and the
party's faces come from the campaign's art shelf (`art/SHELF.md`), one approved portrait per
player character with the phrase that binds it in a prompt, plus a few finished pieces that
carry the house look. That shelf is why the same people walk through every recap, week after
week, and why a book assembled at the end of a campaign reads as one artist's work. Every plate
is looked at before it is kept, and the finals go to the campaign repo with 1600-px copies in
the session's `img/`, captioned in-world in both the web and the print recap. The two Greenrest
records below show the result.

## Tools

| Tool | Does |
| --- | --- |
| `scribe-status` | checks health (Python + CUDA, ffmpeg, Edge, the campaign repo, the login; `connect: true` proves the login), shows what each session has, and follows a job with `date` + `waitSeconds` |
| `fetch-recording` | turns the Craig link (or the DM's own flac zip) into one track per speaker, labelled by Discord id. Runs as a job |
| `transcribe-recording` | runs faster-whisper on each track → `transcript-segments.json`. Runs as a job and resumes after a crash |
| `export-session-chat` | exports the recording window's chat log → `chatlog.json`, with whispers and blind rolls marked |
| `build-transcript` | merges speech and chat by wall clock → `transcript.md` and `transcript-public.md` (whispers withheld) |
| `analyze-combat` | turns By the Books' stat stamps (Battle Flow's too) into per-combat damage, accuracy, healing, spends and moments |
| `snapshot-party` | exports the party's sheets in full (restorable with Import Data), plus the digest facts |
| `render-pdf` | prints the outputs' HTML to PDF with headless Edge, and saves every page as a JPEG to check |

## The record

The record goes into the campaign repo, under `sessions/YYYY-MM-DD/` and `party-snapshots/`.
`campaign.json`'s `sessions.outputs` picks which documents a session gets.

**The spoiler boundary is a file.**
- `transcript-public.md` withholds every whisper and blind roll. The player recap and the
  session-diary page are written from it alone.
- `transcript.md`, where whispers are marked 🤫, feeds only the GM's documents.

The audio, the job logs and the page previews stay in the session's `audio/`, which is
gitignored. The Craig key is never saved.

Two complete records from the campaign the scribe was proven on, sessions 8 and 9 of *The Broken
Heart of Greenrest*, are published as examples in the suite repo:
[docs/examples/session-scribe](https://github.com/Txpple/fvtt-suite-openroll5e/tree/main/docs/examples/session-scribe).

## How it works

- **Joining Foundry.** Each Foundry read runs in its own child process through `fvtt-mcp-dnd5e`'s
  headless-Chromium client, joined as the scribe's user. It refuses to read in three cases:
  another world, a login below Assistant GM, or the scribe being the elected GM while a combat
  runs.
- **Long steps.** Fetching and transcribing are detached jobs that log to the session's
  `audio/.jobs/`, so they never block the server.
- **Timing.** Speech and chat are aligned by wall clock: Craig's `startTime` against Foundry's
  epoch-ms timestamps. There are no markers and no sync step.

## Development

The offline gate is `npm run check && npm run typecheck && npm test && npm run build && npm run knip`.
The tests run on fakes, never on live APIs. `node scripts/call.mjs <tool> '<json>'` runs one tool
through a fresh `dist/index.js`.
`package.json`'s `allowScripts` approves the one install script in the tree, esbuild's
`postinstall` (it checks the platform binary it ships with), so `npm ci` runs quietly and warns
only about a new one.

The live checks run on a sandbox only:
- `FOUNDRY_HOST=local node scripts/verify-reader.mjs` proves that the reader leaves no trace.
- `parity-chat.mjs` and `parity-snapshot.mjs` compare the output with the MCP's exporters.

CI runs the offline gate on Node 22 and 24, with `fvtt-mcp-dnd5e` checked out and built beside
the repo. Releases are tagged and listed in [CHANGELOG.md](CHANGELOG.md).

<!-- openroll5e:family -->
## Part of Open Roll 5e

fvtt-mcp-sessionscribe is one of the three MCP servers in Open Roll 5e, a suite of Foundry VTT modules and Claude
Code tooling built for one D&D 5e table and shared. The other servers:

- [fvtt-mcp-dnd5e](https://github.com/Txpple/fvtt-mcp-dnd5e): builds D&D 5e content in a live Foundry world from Claude Code: a stat block becomes a complete NPC, a map image a walled and lit scene, an adventure its journals, tables and handouts.
- [fvtt-mcp-imagegen](https://github.com/Txpple/fvtt-mcp-imagegen): makes the art with Google's Gemini image models: icons, tokens, props, portraits and illustrations, token redresses and restyles, battlemap and overland-map repaints, and the illustrated session records, all grounded in what the world already shows.

The modules, each of which installs and works on its own and none of which needs another:

- [Open Roll 5e: Autoexplore](https://github.com/Txpple/fvtt-mod-autoexplore): lets a scene start fully explored, so the whole map shows through the fog of war while tokens still need line of sight.
- [Open Roll 5e: By the Books](https://github.com/Txpple/fvtt-mod-bythebooks): the 2024 rules played from the sheet: a hit rolls and applies its own damage, saves resolve themselves, reactions hold, concentration is tracked, and rests, senses, sizes and lights follow the book. Every rule that rides a use or an effect in the 2024 core books, Heroes of Faerûn, Arcana Unleashed and Ravenloft: The Horrors Within, each step with a receipt and a revert; offered, never enforced.
- [Open Roll 5e: Combat Plus](https://github.com/Txpple/fvtt-mod-combatplus): automates the chores of running a fight: combat music, an initiative gate, an out-of-turn movement block, defeated marking at 0 HP and turn alerts.
- [Open Roll 5e: Errata](https://github.com/Txpple/fvtt-mod-errata5e): corrects, in memory, bugs in the premium D&D 2024 books, the dnd5e system and Foundry itself, each fix held until the vendor ships its own.
- [Open Roll 5e: FX Studio](https://github.com/Txpple/fvtt-mod-fxstudio): visual and sound effects for dnd5e, played from what actually happened at the table, with about a thousand stock FX and a window for authoring your own.
- [Open Roll 5e: Loot Shelf](https://github.com/Txpple/fvtt-mod-lootshelf): loot chests and merchant shelves that players can take from, buy from and sell to without owning them, with a receipt for every trade.
- [Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver): for hosted worlds: clears the startup pause so players can play before the GM arrives, and gives any user a landing scene of their own.
- [Open Roll 5e: Party Stash](https://github.com/Txpple/fvtt-mod-partystash): makes a dnd5e Group actor's inventory a working party stash: drags move instead of copying, coin moves through a dialog, and every transfer posts a receipt.
- [Open Roll 5e: Area Sounds](https://github.com/Txpple/fvtt-mod-areasounds): background sound for scenes: random one-shots with silence between them, seamless crossfaded loops, day and night gating, and quiet during combat.

Issues are welcome on every repo in the family; pull requests are not accepted, since each is one
author's design for one table, shared because it might suit yours. How they fit together is mapped in [fvtt-suite-openroll5e](https://github.com/Txpple/fvtt-suite-openroll5e).
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
