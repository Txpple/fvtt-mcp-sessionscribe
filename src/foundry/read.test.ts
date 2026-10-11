import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { WorldProbe } from '../page/probe.js';
import { parseReply, refusal, rulesModuleLabel, SENTINEL, scribeUserMissing } from './protocol.js';
import { childReader } from './read.js';

const PROBE: WorldProbe = {
  worldId: 'lost-mine',
  worldTitle: 'Lost Mine',
  foundryVersion: '14.368',
  system: { id: 'dnd5e', version: '6.0.3' },
  user: { name: 'Scribe Assistant', role: 3, isGM: true },
  activeGM: { name: 'Gamemaster', isSelf: false },
  gmsConnected: [
    { name: 'Gamemaster', role: 4 },
    { name: 'Scribe Assistant', role: 3 },
  ],
  combatActive: false,
  bythebooks: { active: true, version: '3.0.0', id: 'fvtt-mod-bythebooks' },
  messageCount: 12,
};

describe('refusal', () => {
  it('proceeds on the campaign’s world as a non-elected GM', () => {
    expect(refusal(PROBE, 'lost-mine')).toBeNull();
    expect(refusal(PROBE, undefined)).toBeNull();
  });

  it('refuses another world, a non-GM login, and an elected scribe mid-combat', () => {
    expect(refusal(PROBE, 'other-world')).toMatch(/refusing to read another world/);
    expect(refusal({ ...PROBE, user: { name: 'X', role: 1, isGM: false } }, 'lost-mine')).toMatch(
      /needs Assistant GM/
    );
    const elected = { ...PROBE, activeGM: { name: 'Scribe Assistant', isSelf: true } };
    expect(refusal(elected, 'lost-mine')).toBeNull();
    expect(refusal({ ...elected, combatActive: true }, 'lost-mine')).toMatch(/elected GM/);
  });
});

describe('rulesModuleLabel', () => {
  it('names By the Books, or Battle Flow 2.x as what it became, and says inactive or absent', () => {
    expect(rulesModuleLabel({ active: true, version: '3.0.0', id: 'fvtt-mod-bythebooks' })).toBe(
      'By the Books 3.0.0'
    );
    expect(rulesModuleLabel({ active: true, version: '2.17.0', id: 'fvtt-mod-battleflow' })).toBe(
      'Battle Flow 2.17.0 (now By the Books)'
    );
    expect(rulesModuleLabel({ active: false, version: '3.0.0', id: 'fvtt-mod-bythebooks' })).toBe(
      'By the Books 3.0.0, inactive'
    );
    expect(rulesModuleLabel(null)).toBe('By the Books absent');
  });
});

describe('scribeUserMissing', () => {
  const ctx = { user: 'Scribe Assistant', host: 'local' as const };

  it('names the user, the world and the users the join listed, and the fix', () => {
    const msg = scribeUserMissing(
      'User "Scribe Assistant" not on /join. Available: ["","Gamemaster","MCP-Claude","Aria"]',
      { ...ctx, worldId: 'lost-mine' }
    );
    expect(msg).toBe(
      "FOUNDRY_SCRIBE_USER 'Scribe Assistant' not found in world 'lost-mine'; users: " +
        'Gamemaster, MCP-Claude, Aria — set FOUNDRY_SCRIBE_USER to an existing Assistant GM ' +
        '(the bridge’s user will do), or create it as one.'
    );
  });

  it('takes a reworded client error, with or without a list', () => {
    expect(
      scribeUserMissing("user 'Scribe Assistant' not found in world 'x'; users: A, B", ctx)
    ).toMatch(/not found in the world on host 'local'; users: A, B — set FOUNDRY_SCRIBE_USER/);
    expect(
      scribeUserMissing(
        "user 'Scribe Assistant' not found in world 'x'; users: A, B — set FOUNDRY_USER to an existing Gamemaster/Assistant GM user or create 'Scribe Assistant' in the world",
        ctx
      )
    ).toMatch(/; users: A, B — set FOUNDRY_SCRIBE_USER to an existing Assistant GM/);
    expect(scribeUserMissing('The user "Scribe Assistant" does not exist', ctx)).toMatch(
      /^FOUNDRY_SCRIBE_USER 'Scribe Assistant' not found in the world on host 'local' — set FOUNDRY_SCRIBE_USER/
    );
  });

  it('passes every other failure through', () => {
    expect(scribeUserMissing('Foundry /join form never appeared', ctx)).toBeNull();
    expect(scribeUserMissing('User "Gamemaster" not on /join. Available: []', ctx)).toBeNull();
    expect(
      scribeUserMissing('Join did not reach game.ready (error: bad password)', ctx)
    ).toBeNull();
  });
});

describe('parseReply', () => {
  it('takes the last sentinel line and ignores noise', () => {
    const out = `noise\n${SENTINEL}{"ok":false,"host":"local"}\nmore noise\n${SENTINEL}{"ok":true,"host":"local","result":7}\n`;
    expect(parseReply(out)).toEqual({ ok: true, host: 'local', result: 7 });
    expect(parseReply('nothing here')).toBeNull();
    expect(parseReply(`${SENTINEL}{broken`)).toBeNull();
  });
});

describe('childReader', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-reader-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = (name: string, body: string): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return file;
  };

  it('hands the request over stdin and returns the one reply', async () => {
    const echo = script(
      'echo.mjs',
      `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);` +
        `console.log('a stray log line');` +
        `process.stdout.write('${SENTINEL}'+JSON.stringify({ok:true,host:r.host,result:{op:r.op,args:r.args}})+'\\n');});`
    );
    const res = await childReader(echo)({ op: 'scan', args: { since: 5 }, host: 'local' });
    expect(res).toEqual({ ok: true, host: 'local', result: { op: 'scan', args: { since: 5 } } });
  });

  it('reports a child that dies without a reply, with its stderr', async () => {
    const dies = script('dies.mjs', `console.error('boom: no bundle');process.exit(2);`);
    const res = await childReader(dies)({ op: 'probe', host: 'molten' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exited 2 without a reply: boom: no bundle/);
  });

  it('kills a child that hangs past its watchdog', async () => {
    const hangs = script('hangs.mjs', 'setInterval(() => {}, 1000);');
    const res = await childReader(hangs, { killMarginMs: 50 })({
      op: 'probe',
      host: 'local',
      timeoutMs: 100,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/without a reply/);
  });
});
