import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import { BuildTranscriptTool } from './build-transcript.js';

const START = '2026-01-06T23:00:00.000Z';
const S = 'sessions/2026-01-06';
const INPUTS = {
  [`${S}/craig-info.json`]: { startTime: START, durationSeconds: 60, craigNotes: ['mark at 12s'] },
  [`${S}/transcript-segments.json`]: {
    model: 'm',
    device: 'cpu/int8',
    tracks: [{ speaker: 'Aldric Stone', segments: [{ start: 1, end: 2, text: 'Hello.' }] }],
  },
  [`${S}/chatlog.json`]: [
    {
      timestamp: Date.parse(START) + 5_000,
      alias: 'Gamemaster',
      content: 'secret',
      whisperCount: 1,
    },
    { timestamp: Date.parse(START) + 6_000, alias: 'Aldric Stone', content: 'hi' },
  ],
};

const roots: string[] = [];
function tool(files: Record<string, string | object>, campaign: object = CAMPAIGN_JSON) {
  const root = makeTempRepo({ 'campaign.json': campaign, ...files });
  roots.push(root);
  const dir = path.join(root, S);
  return {
    t: new BuildTranscriptTool({ config: loadConfig({ SCRIBE_CAMPAIGN_REPO: root }) }),
    dir,
  };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

describe('build-transcript', () => {
  it('writes the full and the public transcript and reports what it merged', async () => {
    const { t, dir } = tool(INPUTS);
    const out = await t.handleBuildTranscript({ date: '2026-01-06' });
    expect(out).toEqual({
      files: [path.join(dir, 'transcript.md'), path.join(dir, 'transcript-public.md')],
      speechParagraphs: 1,
      chatEvents: 2,
      outsideWindow: 0,
      whispered: 1,
      skewSeconds: 0,
      craigNotes: ['mark at 12s'],
    });
    expect(fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8')).toContain('🤫');
    const pub = fs.readFileSync(path.join(dir, 'transcript-public.md'), 'utf8');
    expect(pub).not.toContain('secret');
    expect(pub).toContain('Aldric Stone: hi');
  });

  it("defaults the skew to campaign.json's sessions.skewSeconds", async () => {
    const { t, dir } = tool(INPUTS, {
      ...CAMPAIGN_JSON,
      sessions: { ...CAMPAIGN_JSON.sessions, skewSeconds: -1.5 },
    });
    expect((await t.handleBuildTranscript({ date: '2026-01-06' })).skewSeconds).toBe(-1.5);
    expect(fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8')).toContain(
      'skew -1.5s applied'
    );
    expect(
      (await t.handleBuildTranscript({ date: '2026-01-06', skewSeconds: 0 })).skewSeconds
    ).toBe(0);
  });

  it("respells the speech by campaign.json's sessions.soundsLike and reports it", async () => {
    const { t, dir } = tool(
      {
        ...INPUTS,
        [`${S}/transcript-segments.json`]: {
          tracks: [{ speaker: 'DM', segments: [{ start: 1, end: 2, text: "Ald Rick's turn." }] }],
        },
      },
      {
        ...CAMPAIGN_JSON,
        sessions: { ...CAMPAIGN_JSON.sessions, soundsLike: { Aldric: ['Ald Rick'] } },
      }
    );
    expect(await t.handleBuildTranscript({ date: '2026-01-06' })).toMatchObject({
      respelled: { Aldric: 1 },
    });
    expect(fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8')).toContain("Aldric's turn.");
    // whisper's own words stay in the segments file
    expect(fs.readFileSync(path.join(dir, 'transcript-segments.json'), 'utf8')).toContain(
      'Ald Rick'
    );
  });

  it('builds speech-only without a chat log, and names the missing step otherwise', async () => {
    const { [`${S}/chatlog.json`]: _chat, ...noChat } = INPUTS;
    const { t } = tool(noChat);
    expect(await t.handleBuildTranscript({ date: '2026-01-06' })).toMatchObject({
      chatEvents: 0,
      note: 'no chatlog.json: speech only',
    });
    const { [`${S}/transcript-segments.json`]: _segs, ...noSegs } = INPUTS;
    await expect(tool(noSegs).t.handleBuildTranscript({ date: '2026-01-06' })).rejects.toThrow(
      /transcript-segments\.json: not found \(run transcribe-recording\)/
    );
  });
});
