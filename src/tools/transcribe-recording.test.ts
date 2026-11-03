import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCampaign } from '../campaign.js';
import { loadConfig } from '../config.js';
import type { JobView, StartJob } from '../jobs.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import {
  TRANSCRIBE_WORKER,
  TranscribeRecordingTool,
  vocabularyPrompt,
} from './transcribe-recording.js';

const roots: string[] = [];
function setup(files: Record<string, string | object>) {
  const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON, 'venv/python.exe': '', ...files });
  roots.push(root);
  const launched: StartJob[] = [];
  const tool = new TranscribeRecordingTool({
    config: loadConfig({
      SCRIBE_CAMPAIGN_REPO: root,
      SCRIBE_PYTHON: path.join(root, 'venv', 'python.exe'),
    }),
    launch: job => {
      launched.push(job);
      return { kind: job.kind, state: 'starting', pid: 1, startedAt: 't', log: 'l' } as JobView;
    },
  });
  return { root, tool, launched };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

const TRACKS = {
  'sessions/2026-01-06/audio/tracks/1-a.flac': 'x',
  'sessions/2026-01-06/audio/tracks/2-b.flac': 'x',
};

describe('transcribe-recording', () => {
  it('launches the venv Python on the worker, unbuffered, with the model and the session', async () => {
    const { root, tool, launched } = setup(TRACKS);
    const out = await tool.handleTranscribeRecording({ date: '2026-01-06', model: 'large-v3' });
    const dir = path.join(root, 'sessions', '2026-01-06');
    expect(launched[0]?.command).toBe(path.join(root, 'venv', 'python.exe'));
    expect(launched[0]?.args).toEqual([
      '-u',
      TRANSCRIBE_WORKER,
      'transcribe',
      '--session-dir',
      dir,
      '--model',
      'large-v3',
      '--device',
      'auto',
      '--language',
      'en',
      '--hotwords',
      'The Lost Mine of Phandelver. Aldric Stone, Brenna Quickfoot.',
    ]);
    expect(launched[0]?.kind).toBe('transcribe');
    expect(out).toMatchObject({ tracks: 2, sessionDir: dir });
  });

  it('passes fresh through, and refuses no tracks, an existing result, and a missing venv', async () => {
    const { tool, launched } = setup(TRACKS);
    await tool.handleTranscribeRecording({ date: '2026-01-06', fresh: true, language: '' });
    const args = launched[0]?.args ?? [];
    expect(args.slice(args.indexOf('--language'), args.indexOf('--language') + 2)).toEqual([
      '--language',
      '',
    ]);
    expect(args.at(-1)).toBe('--fresh');

    const noTracks = setup({ 'sessions/2026-01-06/recap.md': '#' });
    await expect(noTracks.tool.handleTranscribeRecording({ date: '2026-01-06' })).rejects.toThrow(
      /fetch-recording first/
    );

    const done = setup({ ...TRACKS, 'sessions/2026-01-06/transcript-segments.json': '{}' });
    await expect(done.tool.handleTranscribeRecording({ date: '2026-01-06' })).rejects.toThrow(
      /overwrite: true/
    );

    const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON, ...TRACKS });
    roots.push(root);
    const noVenv = new TranscribeRecordingTool({
      config: loadConfig({
        SCRIBE_CAMPAIGN_REPO: root,
        SCRIBE_PYTHON: path.join(root, 'nope.exe'),
      }),
    });
    await expect(noVenv.handleTranscribeRecording({ date: '2026-01-06' })).rejects.toThrow(
      /setup\.ps1/
    );
  });

  it('builds the vocabulary prompt: title, party, speakers, vocabulary, sound-alikes, each name once, no DM', () => {
    const root = makeTempRepo({
      'campaign.json': {
        ...CAMPAIGN_JSON,
        sessions: {
          ...CAMPAIGN_JSON.sessions,
          speakers: { '1': 'Aldric Stone', '2': 'DM', '3': 'Nundro Rockseeker' },
          vocabulary: ['Phandalin', ' aldric stone ', 'Wave Echo Cave', 'Phandelver', 'Nundro'],
          soundsLike: { Aldric: ['Ald Rick'], Gundren: ['Gun Dren'], Brenna: ['Brenda'] },
        },
      },
    });
    roots.push(root);
    expect(vocabularyPrompt(loadCampaign(root))).toBe(
      'The Lost Mine of Phandelver. Aldric Stone, Brenna Quickfoot, Nundro Rockseeker, ' +
        'Phandalin, Wave Echo Cave, Gundren.'
    );
  });
});
