import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { ReadRequest, ReadResponse } from '../foundry/protocol.js';
import type { WorldReader } from '../foundry/read.js';
import type { ChatRecord } from '../page/chat.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import { ExportSessionChatTool } from './export-session-chat.js';

const START = Date.parse('2026-01-06T23:00:00.000Z');
const PAD = 10 * 60_000;

const rec = (id: string, over: Partial<ChatRecord> = {}): ChatRecord => ({
  id,
  author: 'u',
  timestamp: START,
  time: new Date(START).toISOString(),
  style: 0,
  isRoll: false,
  whisperCount: 0,
  blind: false,
  whisper: false,
  content: id,
  ...over,
});

const RECORDS = [
  rec('a'),
  rec('r', { isRoll: true, rolls: [{ total: 12 }] }),
  rec('w', { whisper: true, whisperCount: 1, whisperTo: ['Gamemaster'] }),
  rec('b', { isRoll: true, blind: true, whisper: true, whisperCount: 1 }),
];

const roots: string[] = [];
function setup(extra: Record<string, string | object> = {}) {
  const root = makeTempRepo({
    'campaign.json': CAMPAIGN_JSON,
    'sessions/2026-01-06/craig-info.json': {
      startTime: new Date(START).toISOString(),
      durationSeconds: 3600,
    },
    ...extra,
  });
  roots.push(root);
  const seen: ReadRequest[] = [];
  const reader: WorldReader = async <T>(req: ReadRequest) => {
    seen.push(req);
    return {
      ok: true,
      host: req.host,
      readAt: '2026-01-07T01:00:00.000Z',
      result: { totalMessages: 99, records: RECORDS },
    } as ReadResponse<T>;
  };
  const tool = new ExportSessionChatTool({
    config: loadConfig({ SCRIBE_CAMPAIGN_REPO: root }),
    reader,
  });
  return { root, tool, seen, file: path.join(root, 'sessions', '2026-01-06', 'chatlog.json') };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

describe('export-session-chat', () => {
  it('writes the recording window’s records to chatlog.json and counts the visibility', async () => {
    const { tool, seen, file } = setup();
    const out = await tool.handleExportSessionChat({ date: '2026-01-06' });
    expect(seen).toEqual([
      {
        op: 'scanSessionChat',
        args: { since: START - PAD, until: START + 3_600_000 + PAD },
        host: 'generic',
        worldId: 'lost-mine',
      },
    ]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(RECORDS);
    expect(out).toMatchObject({
      file,
      host: 'generic',
      messages: 4,
      ofTotal: 99,
      rolls: 2,
      whispered: 2,
      blind: 1,
    });
  });

  it('refuses to clobber an existing chatlog.json unless told to', async () => {
    const { tool, file } = setup({ 'sessions/2026-01-06/chatlog.json': '[]' });
    await expect(tool.handleExportSessionChat({ date: '2026-01-06' })).rejects.toThrow(
      /overwrite: true/
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('[]');
    await tool.handleExportSessionChat({ date: '2026-01-06', overwrite: true, host: 'local' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toHaveLength(4);
  });

  it('needs a session with a recording, or explicit bounds', async () => {
    const { tool } = setup({ 'sessions/2026-02-01/recap.md': '#' });
    await expect(tool.handleExportSessionChat({ date: '2026-02-01' })).rejects.toThrow(
      /craig-info\.json not found/
    );
    await expect(
      tool.handleExportSessionChat({ date: '2026-02-01', since: '0', until: '1' })
    ).resolves.toMatchObject({ messages: 4 });
    await expect(tool.handleExportSessionChat({ date: '2026-03-03' })).rejects.toThrow(
      /no session directory/
    );
  });
});
