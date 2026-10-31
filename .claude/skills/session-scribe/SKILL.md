---
name: session-scribe
description: >-
  Turn a Craig (Discord) session recording and the Foundry chat log into the session record in the
  campaign repo: speaker-labeled transcript, player recap, combat report, GM notes, party snapshot,
  with the scribe's tools (fvtt-mcp-sessionscribe). Use when the user pastes a Craig download link
  (craig.chat/rec/... or craig.horse), or wants to "process the session", "process last night's
  recording", "transcribe the session", "write the session recap", "make the session log",
  "analyze the combat", or "run session scribe".
---

# Session scribe

Craig records the table (one audio track per speaker); Foundry's chat log records the mechanics
(every roll, whisper, and card, each with an epoch-ms timestamp). Craig's recording metadata
carries its own `startTime`, so the two timelines align by pure wall-clock arithmetic. No sync
ritual, no markers, no Discord integration. The user pastes one link; everything else is yours.

**The user's contract:** `/join` Craig at session start → play → `/stop` → paste Claude the link.
That is ALL. Do not ask them to mark, note, export, or download anything. If they said "mark that"
aloud during play, it is IN the transcript: grep for it.

## The tools

The scribe MCP server (`fvtt-mcp-sessionscribe`, registered as `sessionscribe`, so its tools are
`mcp__sessionscribe__*`) does the correctness; this skill does the judgment. The scribe **reads**
the world and **writes the record**; it never writes to Foundry.

| Tool | Does |
| --- | --- |
| `scribe-status` | Health (Python + CUDA, ffmpeg, tar, Edge, the campaign repo, the scribe's login); `connect: true` proves the login and names the world, the GMs connected and By the Books (or Battle Flow 2.x); per session, which outputs, pipeline files and snapshot exist; `date` + `waitSeconds` follows a session's jobs. |
| `fetch-recording` | The Craig link (or the DM's own flac zip, `zipPath`) → `audio/tracks/` + `craig-info.json` (never the key). A job. |
| `transcribe-recording` | Per-speaker faster-whisper → `transcript-segments.json`. A job; resumes after a crash. |
| `export-session-chat` | The recording window's chat log → `chatlog.json`, whispers and blind rolls marked. |
| `build-transcript` | → `transcript.md` (everything, 🤫 for whispers) and `transcript-public.md` (whispers withheld). |
| `analyze-combat` | By the Books' stat stamps (Battle Flow's on older cards) → the per-combat report (GM-facing numbers). |
| `snapshot-party` | The party's sheets → `<snapshots.dir>/<date>/<PC>.json` + the digest facts. |
| `render-pdf` | The outputs' HTML → PDFs (recap.pdf from recap-print.html), page counts, every page as a JPEG to look at. |

Writes to the world stay with `fvtt-mcp-dnd5e`: the session-diary page (`manage-journals`) and the
Bestiary (its `bestiary-builder` skill). Illustrations are imagegen's `illustration-builder`
skill. When a sibling skill is not loaded, read its SKILL.md by path: the sibling repos sit
beside this one (`<repos>/fvtt-mcp-dnd5e/.claude/skills/bestiary-builder/`,
`<repos>/fvtt-mcp-imagegen/.claude/skills/illustration-builder/`).

## The campaign repo (read this first)

Every campaign fact comes from the campaign repo (the scribe's `.env` names it as
`SCRIBE_CAMPAIGN_REPO`; the convention is `<repos>/fvtt-mcp-dnd5e/.claude/skills/_shared/campaign-repo.md`).
**Pull it** before you start, and read:

- `campaign.json`: `name`, `worldId` (the scribe refuses to read another world), `party` (the
  snapshot roster; nothing else is a PC, `excludedActors` never), `journals.sessionDiary`,
  `sessions.dir` / `outputs` / `pdf` / `skewSeconds` / `illustrations` / `speakers` (Discord id →
  transcript label), `snapshots.dir`.
- `STYLE.md`: the house style, in full, before writing a word. What it does not cover falls to
  the defaults under "Judgment notes" below.

A campaign with no `campaign.json` gets one before the first run (ask for the roster and the
journal name; the defaults are in the convention file).

## Machine prerequisites (once per machine, Windows)

`scribe-status` says what is missing. The transcription toolchain is
`powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -PrefetchModel` in the scribe repo
(idempotent: ffmpeg + uv via winget, the `~\.session-scribe\venv` with faster-whisper + CUDA
wheels, a GPU smoke test). `SMOKE TEST OK (CPU ONLY)` still works, just slower; on a new GPU
generation it usually means ctranslate2 needs a bump
(`uv pip install --python ~\.session-scribe\venv\Scripts\python.exe -U ctranslate2`).

**Windows Application Control blocking the uv-managed Python** (`ImportError: DLL load failed
while importing _ctypes: An Application Control policy has blocked this file`): install signed
Python from python.org (`winget install Python.Python.3.13`), delete `~\.session-scribe\venv`,
re-run setup.ps1 (it prefers the newest signed 3.12+). Never touch the policy itself. Delete any
`~\.session-scribe\venv-blocked-*` backups once the rebuilt venv passes.

The scribe joins Foundry as the Assistant GM user in `FOUNDRY_SCRIBE_USER` (the MCP bridge's
own user, or a separate one). The world must be running: wake it with fvtt-mcp-dnd5e's `start-session` skill.

## The pipeline (per session)

Let `date` be the session's real date (`YYYY-MM-DD`).

0. **Check** — `scribe-status { connect: true }`: every check ok, the right world.
1. **Fetch** — `fetch-recording { date, link }`, then `scribe-status { date, waitSeconds: 120 }`
   until the fetch job is `done`. Speakers come out labelled from `campaign.json`'s
   `sessions.speakers`; if it has none, pass `speakers` (Discord id or username → character
   name, the DM's track as "DM") so the transcript labels are the characters. Craig links expire
   after 7 days: on a 404/410, tell the user at once; `/recordings` in Discord re-fetches a lost
   link. If the Craig API misbehaves, ask the DM for the flac zip from the Craig page and run
   `fetch-recording { date, zipPath }` instead.
2. **Transcribe** — `transcribe-recording { date }` (`model: "large-v3"` when the user wants
   maximum accuracy; `large-v3-turbo` is the default). Minutes on a big GPU; follow it with
   `scribe-status { date, waitSeconds: 300 }` and do steps 3, 5 and 7 meanwhile (they need only
   Foundry).
3. **Chat log** — `export-session-chat { date }`.
4. **Transcript** — `build-transcript { date }`. **First run on a new Craig + Foundry pairing:**
   verify the skew: find a moment the DM says a roll aloud ("make a dex save") and compare its
   speech time with the roll's; past ~5 s, set `sessions.skewSeconds` in `campaign.json` and
   rebuild.
5. **Combat** — `analyze-combat { date }` (a world without By the Books says so in the first line:
   skip the combat log then). `includeLedger: true` when you need to trace a number. Each actor's
   moments also carry:
   - the gate's reminders, on attacks and on saves: the net it named, rolls made against it,
     attack hits and saves made when reminded;
   - the chips each swing used up;
   - the clock riders that rode a hit (Dreadful Strike, Divine Strike …) and damage-shield
     strikes. Their damage is already in `dealt`, so don't add it twice;
   - the auras each actor stood, named once.

   These feed "what the buffs and features actually bought".
6. **Write the artifacts** (your judgment — read BOTH transcripts fully first). The set is
   `sessions.outputs`; each is a `.md` and, where a template exists, an `.html` (templates are in
   this skill's `templates/`):
   - **The transcript is the only source of what happened.** The session plan (`plans/`) is a
     script the table may leave at any beat: never take a beat, a place, an action or a line from
     it. Check every "who did what, where" against the transcript before writing it, and where the
     plan and the tape differ the tape wins without comment (the owner's rule, 2026-10-28, after a
     recap had guards opening a door the DM had narrated one man opening, and a body on a roof the
     DM had never put there). The same holds for the canon fold and for every illustration.
   - `recap.md` — the canonical session record from `transcript.md`: what happened, in order,
     with names. GM voice, complete, spoiler-tolerant; exact numbers welcome.
   - `recap.html` — from `templates/recap.html`, filling every placeholder. **Written from
     `transcript-public.md` only.** That file withholds every whisper and blind roll, so the
     spoiler boundary is structural: nothing that appears only in `transcript.md`'s 🤫 lines, the
     GM notes or GM whispers may appear here. The user pastes it into an email: it must render in
     Gmail / Outlook (keep the inline-style table structure intact).
   - `recap-print.html` — from `templates/recap-print.html`: the SAME text in a block layout with
     page-break rules and page numbers. Keep the template's `.keep` groups: each heading with its
     first block (and a picture that follows it), endmatter as one `.entry` per item.
   - **No appendix of found documents** (the DM, 2026-10-30): letters, notes, notices, ledgers,
     boards and scroll labels live on the **clue board** in Foundry, not in the session record. (An
     *Appendix 1 – Lore* ran from 2026-10-27 and was retired.) A search of a place is still written
     as a summary of the key finds, the party's key speculations and their tentative ideas of what
     is going on, never a room-by-room back-and-forth; quote a document in the body only where the
     moment turns on it.
   - **Illustrations** — when `sessions.illustrations` is true. Pick the night's most memorable
     beats across the WHOLE session (roleplay and town moments as well as the big fight — roughly
     one per story section) and make each one with the **illustration-builder** skill: canon from
     the transcript (who was there, where it happened — check the location before prompting), the
     battlemap / scene for terrain, the campaign's `art/SHELF.md` anchors for the party, the
     world's tokens and portraits for NPCs and monsters, handout art for buildings. Run its full
     loop — canon check, then the flaw pass at zoom — on every image. Finals go to the campaign's
     art staging folder; 1600-px JPEG copies to `<session>/img/NN-slug.jpg`, numbered in reading
     order, woven into both recap.html and recap-print.html with in-world captions. Nothing goes
     into Foundry until the owner approves it.
   - `combat-stats.md` + `combat-log.html` — the combat report from step 5; template
     `templates/combat-log.html`. GM-facing: exact numerals wanted. Keep its `.keep` groups (a
     heading with its first block), as in recap-print.html.
   - `gm-notes.md` + `.html`, or the split pair `gm-notes-story` (plot: what changed in the world,
     what is now canon, promises and their status, open threads, loot with story weight, quotes)
     and `gm-notes-mechanics` (bookkeeping checklist to apply to the live world — levels, items,
     coin, renames; automation that cost time; rulings to keep consistent; table observations).
     Both from `templates/gm-notes.html`, with its `.keep` groups.
   - PDFs, when `sessions.pdf` — `render-pdf { date }`. **Then look at every page:** it writes
     each page as `audio/previews/<output>-NN.jpg` and lists them; read every image, in order.
     Fix the HTML and render again on a heading alone at a page foot, a picture pushed off its
     section, a split table or entry, or a near-empty page.
7. **Snapshot the party** — `snapshot-party { date }` writes the full JSON exports (the durable
   record: every charge, effect and attunement; restores via the sheet's **Import Data**). Then
   write `<snapshots.dir>/<date>.md` yourself from the returned digests: per PC, class / subclass
   + LEVEL, HP max, AC, the six ability scores, feats / ASIs, weapon masteries, spell slots,
   attuned + equipped magic items, consumables **with their remaining charges / counts**, the
   feature pools with their remaining uses (`features`: Lay on Hands, Second Wind, superiority
   dice, Channel Divinity…) and the effects standing on the sheet at the wrap (`effects`) — in
   the format of the newest earlier snapshot, diffable against it.
8. **The session-diary page** — when `journals.sessionDiary` is set: append ONE player-visible
   text page to that journal with fvtt-mcp-dnd5e's `manage-journals` (`update` with `newPageName`
   + `playerVisible: true`), named `Session N — <title>`. Never a journal per session.
   **The page is recap.html itself, not a summary of it** (DM, 2026-10-30): every section,
   illustration, song, Quotable Quotes and Deeds of the Day (no appendix), converted to
   journal HTML by `python scripts/recap-to-journal.py <session>/recap.html
   worlds/<world>/assets/journal/session-diary/<date>/ <title-image> <out.html>`. **The title
   picture goes on top:** the session's most thematic illustration (the one that names the
   session's title, or its turning point), moved out of the body to the head of the page with its
   caption, then the date line. Upload `<session>/img/` to that asset folder first
   (`upload-asset-tree`), send the converted HTML as the page's `content`, then read it back and
   check the figure and image counts survived.
8½. **The Bestiary** — when `journals.bestiary` is set: list every creature the party fought this
   session (the combat log's enemy side; a variant counts as its MM family), drop those that
   already have a page (`manage-journals get` on the Bestiary), and run fvtt-mcp-dnd5e's
   **bestiary-builder** skill for each new one: the actor's own portrait, at most two MM
   paragraphs, and a two-or-three-sentence `notable` callout of this session's encounter from the
   recap. A creature met again only gets its callout refreshed when the session changed what the
   players know about it. Name the new pages in the wrap report.
9. **Commit** — in the campaign repo: `git add <sessions.dir>/<date> <snapshots.dir>` (and the
   staged illustration finals, when there are any) → commit (`session: <date> — <short title>`) →
   push. `audio/` is gitignored (the tracks, the job logs, the PDF previews); tell the user the
   audio stays local and can be deleted once they are happy with the transcript.

## Judgment notes (the defaults — `STYLE.md` overrides)

- **Recap voice:** in-world chronicle, not minutes. Third person about the party, never addressed
  to them ("you" only inside quoted dialogue). Lead with the arc, keep table-talk out, name PCs
  and NPCs. The TL;DR paragraph is one breath; section headings are story beats.
- **Dice as narrative in the player recap.** Weave the checks, crits, failed saves and big hits
  into the prose at full detail, but the words carry the magnitude, not the numbers. **Name the
  mechanics** — the spell, feature, feat or mastery by its game name, italic Title Case when
  invoked — rather than narrating around them.
- **Never surface the DM's narration prompts** ("how would you like to kill him?"): the output of
  that exchange is the fiction; the ask is table process.
- **Register:** narrative, not purple — plain direct sentences, one flourish per paragraph.
  Combat is punchy: short sentences, hard verbs, one beat per sentence. Who killed what is
  factual, not style-flexible.
- **No meta, no player names, no technical-issues talk in the player recap** — UI / audio /
  browser troubles belong in the mechanics notes. **Nothing from outside the fiction, either**: the
  recap never names the Player's Guide, the plan, a rulebook, Foundry, a sheet or a handout file.
  What a player cites from such a source is written as what the character knows or has heard, never
  "he remembered the Guide's warning" (sent back 2026-10-28).
- **Quote found-item text verbatim when it matters** (a plot-loaded item's description), then note
  who read it aloud, before any paraphrase.
- **The combat report opens on the one headline fact, in numbers**, and has a "what the buffs and
  features actually bought" section (damage added / prevented, misses converted, saves flipped —
  the duds named as plainly as the winners). When the party gets wrecked, work the probability
  back off the sheets before calling it a balance problem. Charts: single-series bars, one hue,
  direct-labeled; render the page and look at it before shipping. A buff that measured zero
  because of a *suspected* automation fault is not a dud — that goes to the mechanics notes.
- **The PDFs are what get read away from the desk.** Nothing splits across a page, pages are
  numbered, and every page is looked at before the files go out (step 6). The templates' `.keep`
  groups are what Chrome honours; a heading's own `break-after: avoid` is not.
- **Monsters the party fought go in the Bestiary** — after the recap, hand off to the
  `bestiary-builder` skill for anything newly killed.
- **Attribution is per-speaker-track and trustworthy** — quote players verbatim when it's good
  ("quotes of the night" in the story notes). Whispers (🤫, `transcript.md` only) are GM-only by
  definition: usable in recap.md and the GM notes, NEVER in recap.html or the diary page.
- **Bookkeeping handoff:** loot awarded and levels gained belong in the mechanics notes as a
  checklist; offer to apply them to the live world (fvtt-mcp-dnd5e's physical-item-builder /
  `level-up-pc`) as a follow-up.
- **Craig facts:** recordings expire in 7 days; `craig-info.json.craigNotes` carries any `/note`
  markers (build-transcript reports them); the API is mapped in the scribe's `src/craig.ts`
  header. Craig is open source (CraigChat/craig) if the API shape ever drifts; until the scribe
  is fixed, `zipPath` is the fallback.
