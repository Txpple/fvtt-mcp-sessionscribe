import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { ReadRequest, ReadResponse } from '../foundry/protocol.js';
import type { WorldReader } from '../foundry/read.js';
import type { WorldProbe } from '../page/probe.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import { describeWindow, parseInstant, recordingWindow, resolveWindow } from '../window.js';
import { AnalyzeCombatTool } from './analyze-combat.js';

const START = Date.parse('2026-01-06T23:00:00.000Z');
const PAD = 10 * 60_000;

// One stamped damage receipt in combat C1, round 2: Aldric deals 7 to a goblin.
const SCAN = {
  world: 'lost-mine',
  scannedAt: START + 3_600_000,
  totalMessages: 40,
  stamped: [
    {
      id: 'm1',
      ts: START + 60_000,
      flags: {
        receipt: {
          targets: [
            {
              uuid: 'Scene.S.Token.T1.Actor.G',
              name: 'Goblin',
              taken: 7,
              combat: 'C1:2:0',
              sourceUuid: 'Actor.aldric',
              reverted: false,
            },
          ],
        },
      },
      rolls: [],
    },
  ],
  d20s: [],
  names: { 'Actor.aldric': 'Aldric Stone' },
  combats: { C1: 'Cave Fight' },
  rosters: {},
};

const PROBE = {
  bythebooks: { active: true, version: '3.0.0', id: 'fvtt-mod-bythebooks' },
} as WorldProbe;

const roots: string[] = [];
function setup(files: Record<string, string | object> = {}) {
  const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON, ...files });
  roots.push(root);
  const seen: ReadRequest[] = [];
  let reply: ReadResponse = {
    ok: true,
    host: 'local',
    readAt: '2026-01-07T02:00:00.000Z',
    probe: PROBE,
    result: SCAN,
  };
  const reader: WorldReader = async <T>(req: ReadRequest) => {
    seen.push(req);
    return reply as ReadResponse<T>;
  };
  const tool = new AnalyzeCombatTool({
    config: loadConfig({ SCRIBE_CAMPAIGN_REPO: root, FOUNDRY_HOST: 'local' }),
    reader,
  });
  return { tool, seen, setReply: (r: ReadResponse) => (reply = r) };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

const CRAIG = {
  'sessions/2026-01-06/craig-info.json': {
    startTime: new Date(START).toISOString(),
    durationSeconds: 3 * 3600,
  },
};

describe('analyze-combat', () => {
  it('scopes to the session’s padded recording window and reads the campaign’s world', async () => {
    const { tool, seen } = setup(CRAIG);
    const out = await tool.handleAnalyzeCombat({ date: '2026-01-06' });
    expect(seen).toEqual([
      {
        op: 'scanCombatStats',
        args: { since: START - PAD, until: START + 3 * 3_600_000 + PAD },
        host: 'local',
        worldId: 'lost-mine',
      },
    ]);
    expect(out.split('\n')[0]).toBe(
      '_local · 2026-01-06T22:50:00.000Z → 2026-01-07T02:10:00.000Z (since from the recording, ' +
        'until from the recording) · read 2026-01-07T02:00:00.000Z_'
    );
    expect(out).toContain('**COMBAT STATS** — world "lost-mine", 1 stamped messages (of 40 total)');
    expect(out).toContain('## COMBAT Cave Fight — 2 rounds');
    expect(out).toContain('- **Aldric Stone**: dealt 7 (3.5/rd) in 1 hit');
  });

  it('lets explicit bounds override the session window, and the host per call', async () => {
    const { tool, seen } = setup(CRAIG);
    await tool.handleAnalyzeCombat({
      date: '2026-01-06',
      since: '2026-01-06T23:30:00Z',
      host: 'molten',
    });
    expect(seen[0]?.args).toEqual({
      since: Date.parse('2026-01-06T23:30:00Z'),
      until: START + 3 * 3_600_000 + PAD,
    });
    expect(seen[0]?.host).toBe('molten');
  });

  it('reads the whole log with no date and no bounds, and appends the ledger on request', async () => {
    const { tool, seen } = setup();
    const out = await tool.handleAnalyzeCombat({ includeLedger: true });
    expect(seen[0]?.args).toEqual({ since: 0 });
    expect(out).toContain('the start → the end (from the start, to the end)');
    expect(out).toContain('```json');
  });

  it('refuses an unknown combat, a failed read, and a session with no recording', async () => {
    const { tool, setReply } = setup({ 'sessions/2026-02-01/recap.md': '#' });
    await expect(tool.handleAnalyzeCombat({ combat: 'nope' })).rejects.toThrow(/Known: C1/);
    await expect(tool.handleAnalyzeCombat({ date: '2026-02-01' })).rejects.toThrow(
      /craig-info\.json not found/
    );
    setReply({ ok: false, host: 'local', error: 'connected to world "other"' });
    await expect(tool.handleAnalyzeCombat({})).rejects.toThrow(/connected to world "other"/);
  });

  it('says so when the world has no By the Books to stamp anything', async () => {
    const { tool, setReply } = setup();
    setReply({
      ok: true,
      host: 'local',
      probe: { bythebooks: null } as WorldProbe,
      result: { ...SCAN, stamped: [] },
    });
    const out = await tool.handleAnalyzeCombat({});
    expect(out.split('\n')[0]).toContain(
      'By the Books is not installed in this world: no stamps to fold'
    );
  });
});

describe('the session window', () => {
  it('parses ISO and epoch ms, refusing anything else', () => {
    expect(parseInstant('since', '1767740400000')).toBe(1767740400000);
    expect(parseInstant('since', '2026-01-06T23:00:00Z')).toBe(START);
    expect(() => parseInstant('since', 'yesterday')).toThrow(/not an ISO date/);
  });

  it('pads the recording and refuses an inverted or missing window', () => {
    const root = makeTempRepo(CRAIG);
    roots.push(root);
    const dir = `${root}/sessions/2026-01-06`;
    expect(recordingWindow(dir)).toEqual({
      since: START - PAD,
      until: START + 3 * 3_600_000 + PAD,
    });
    expect(() => resolveWindow({ since: '2026-01-02', until: '2026-01-01' })).toThrow(/before/);
    expect(() => recordingWindow(`${root}/nope`)).toThrow(/pass since\/until/);
    expect(describeWindow({ since: 0, source: 'x' })).toBe('the start → the end (x)');
  });
});
