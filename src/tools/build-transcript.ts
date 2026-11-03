// build-transcript: craig-info.json + transcript-segments.json + chatlog.json → transcript.md
// (the full timeline, whispers marked 🤫) and transcript-public.md (whispers withheld). Pure file
// work; no Foundry, no Python. Was session_scribe.py `align`; the speech is respelled by the
// campaign's sound-alike guide first (src/transcript/sounds-like.ts).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign, resolveSessionDir } from '../campaign.js';
import type { Config } from '../config.js';
import {
  buildTranscripts,
  type ChatLogRecord,
  type CraigInfo,
  DEFAULT_ALIGN,
  type Segments,
} from '../transcript/align.js';
import { respell } from '../transcript/sounds-like.js';
import { toInputSchema } from '../utils/schema.js';

const BuildTranscriptSchema = z.object({
  date: z.string().describe('The session (YYYY-MM-DD or its directory name).'),
  skewSeconds: z
    .number()
    .optional()
    .describe("Added to chat timestamps; default campaign.json's sessions.skewSeconds."),
  maxParagraphSeconds: z
    .number()
    .positive()
    .default(DEFAULT_ALIGN.maxParagraphSeconds)
    .describe("Split a speaker's paragraph once it spans this long (default 75)."),
  noWindow: z
    .boolean()
    .default(false)
    .describe('Keep chat events outside the recording window (±2 min).'),
});

function readJson<T>(file: string, what: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    const why = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : (e as Error).message;
    throw new Error(`${file}: ${why} (${what})`);
  }
}

export class BuildTranscriptTool {
  constructor(private readonly deps: { config: Config }) {}

  getToolDefinitions() {
    return [
      {
        name: 'build-transcript',
        description:
          "Merge a session's per-speaker speech with its Foundry chat log by wall clock: " +
          'transcript.md (speech, 🎲 rolls, 💬 chat, 🤫 whispers and blind rolls) and ' +
          'transcript-public.md (whispers withheld; write the player recap from it). Names are ' +
          "respelled by campaign.json's sessions.soundsLike. Needs craig-info.json and " +
          'transcript-segments.json; chatlog.json optional.',
        inputSchema: toInputSchema(BuildTranscriptSchema),
      },
    ];
  }

  async handleBuildTranscript(args: unknown) {
    const p = BuildTranscriptSchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const dir = resolveSessionDir(campaign, p.date);
    const meta = readJson<CraigInfo>(path.join(dir, 'craig-info.json'), 'run fetch-recording');
    const { segs, respelled } = respell(
      readJson<Segments>(path.join(dir, 'transcript-segments.json'), 'run transcribe-recording'),
      campaign.sessions.soundsLike
    );
    const chatFile = path.join(dir, 'chatlog.json');
    const chat = fs.existsSync(chatFile)
      ? readJson<ChatLogRecord[]>(chatFile, 'run export-session-chat')
      : [];
    const skewSeconds = p.skewSeconds ?? campaign.sessions.skewSeconds;
    const out = buildTranscripts(meta, segs, chat, {
      skewSeconds,
      maxParagraphSeconds: p.maxParagraphSeconds,
      noWindow: p.noWindow,
    });
    const full = path.join(dir, 'transcript.md');
    const pub = path.join(dir, 'transcript-public.md');
    fs.writeFileSync(full, out.full);
    fs.writeFileSync(pub, out.public);
    return {
      files: [full, pub],
      ...out.stats,
      skewSeconds,
      ...(Object.keys(respelled).length ? { respelled } : {}),
      ...(fs.existsSync(chatFile) ? {} : { note: 'no chatlog.json: speech only' }),
      ...(meta.craigNotes ? { craigNotes: meta.craigNotes } : {}),
    };
  }
}
