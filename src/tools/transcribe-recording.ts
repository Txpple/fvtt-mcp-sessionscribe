// transcribe-recording: start the job that turns a session's audio tracks into
// transcript-segments.json, per speaker, with faster-whisper (worker/transcribe.py, the
// scribe's only Python). Minutes on a big GPU, far longer on CPU: it runs detached and returns at
// once; scribe-status { date, waitSeconds } follows it. A killed or crashed run resumes from the
// tracks it had finished unless `fresh`. The campaign's names reach whisper as hotwords
// (vocabularyPrompt), so they come out spelled as campaign.json spells them.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { type Campaign, loadCampaign, resolveSessionDir } from '../campaign.js';
import { literal } from '../transcript/sounds-like.js';
import { type Config, repoRoot } from '../config.js';
import { type StartJob, startJob } from '../jobs.js';
import { audioTracks } from '../record.js';
import { toInputSchema } from '../utils/schema.js';

export const TRANSCRIBE_WORKER = path.join(repoRoot, 'worker', 'transcribe.py');

const TranscribeRecordingSchema = z.object({
  date: z.string().describe('The session (YYYY-MM-DD or its directory name).'),
  model: z
    .string()
    .default('large-v3')
    .describe('faster-whisper model: large-v3 (default), or large-v3-turbo (faster, fewer names).'),
  device: z.enum(['auto', 'cuda', 'cpu']).default('auto').describe('auto: CUDA, else CPU int8.'),
  language: z.string().default('en').describe('Spoken language; "" to autodetect per track.'),
  fresh: z.boolean().default(false).describe('Ignore tracks finished by an earlier run.'),
  overwrite: z.boolean().default(false).describe('Replace an existing transcript-segments.json.'),
});

/**
 * The campaign's names as one capitalised, punctuated sentence: the title, the party, the speaker
 * labels, `sessions.vocabulary`, then the names in `sessions.soundsLike`. The worker hands it to
 * every 30 s window as faster-whisper's `hotwords`, which steers both the spelling of the names
 * and the transcript's style (capitals and punctuation). Whisper keeps only the prompt's first
 * 223 tokens, so the order is the priority, and a name the sentence already holds as a whole word
 * ("Aldric" in "Aldric Stone") is not spent again.
 */
export function vocabularyPrompt(campaign: Campaign): string {
  let prompt = `${campaign.name}.`;
  const has = (name: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${literal(name)}(?![\\p{L}\\p{N}])`, 'iu').test(prompt);
  let first = true;
  for (const raw of [
    ...campaign.party,
    ...Object.values(campaign.sessions.speakers ?? {}),
    ...(campaign.sessions.vocabulary ?? []),
    ...Object.keys(campaign.sessions.soundsLike ?? {}),
  ]) {
    const name = raw.trim();
    if (!name || name === 'DM' || has(name)) continue;
    prompt += `${first ? ' ' : ', '}${name}`;
    first = false;
  }
  return first ? prompt : `${prompt}.`;
}

export interface TranscribeRecordingDeps {
  config: Config;
  launch?: (job: StartJob) => ReturnType<typeof startJob>;
}

export class TranscribeRecordingTool {
  constructor(private readonly deps: TranscribeRecordingDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'transcribe-recording',
        description:
          "Start transcribing a session's audio tracks, one per speaker, with faster-whisper " +
          "(VAD on, campaign.json's names as hotwords) → transcript-segments.json. A detached " +
          'job (minutes on a GPU): returns at once; follow it with scribe-status { date, ' +
          'waitSeconds }. Resumes from finished tracks after a crash.',
        inputSchema: toInputSchema(TranscribeRecordingSchema),
      },
    ];
  }

  async handleTranscribeRecording(args: unknown) {
    const p = TranscribeRecordingSchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const sessionDir = resolveSessionDir(campaign, p.date);
    const tracks = audioTracks(path.join(sessionDir, 'audio', 'tracks'));
    if (!tracks.length) {
      throw new Error(`${sessionDir} has no audio tracks: run fetch-recording first`);
    }
    const target = path.join(sessionDir, 'transcript-segments.json');
    if (fs.existsSync(target) && !p.overwrite) {
      throw new Error(`${target} exists; pass overwrite: true to transcribe again`);
    }
    if (!fs.existsSync(this.deps.config.python)) {
      throw new Error(
        `${this.deps.config.python} missing: run scripts/setup.ps1 (builds the venv)`
      );
    }
    const args_ = [
      '-u', // unbuffered: the job log shows each track as it finishes
      TRANSCRIBE_WORKER,
      'transcribe',
      '--session-dir',
      sessionDir,
      '--model',
      p.model,
      '--device',
      p.device,
      '--language',
      p.language,
      '--hotwords',
      vocabularyPrompt(campaign),
      ...(p.fresh ? ['--fresh'] : []),
    ];
    const job = (this.deps.launch ?? startJob)({
      sessionDir,
      kind: 'transcribe',
      command: this.deps.config.python,
      args: args_,
      spec: { model: p.model, device: p.device, language: p.language, fresh: p.fresh },
    });
    return {
      job,
      sessionDir,
      tracks: tracks.length,
      next: `scribe-status { date: "${path.basename(sessionDir)}", waitSeconds: 300 } until done, then build-transcript`,
    };
  }
}
