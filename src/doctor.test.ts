import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { type DoctorDeps, formatLine, type Line, runDoctor } from './doctor.js';
import type { ReadResponse } from './foundry/protocol.js';
import type { WorldProbe } from './page/probe.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from './testing/campaign-fixture.js';

const PROBE: WorldProbe = {
  worldId: 'lost-mine',
  worldTitle: 'Lost Mine',
  foundryVersion: '14.369',
  system: { id: 'dnd5e', version: '6.0.6' },
  user: { name: 'Scribe Assistant', role: 3, isGM: true },
  activeGM: { name: 'Gamemaster', isSelf: false },
  gmsConnected: [{ name: 'Gamemaster', role: 4 }],
  combatActive: false,
  bythebooks: { active: true, version: '3.0.0', id: 'fvtt-mod-bythebooks' },
  messageCount: 12,
};

const ENV_FILE = 'C:\\dnd5e\\.env';

async function run(
  campaignRoot: string,
  over: Partial<DoctorDeps> & { env?: NodeJS.ProcessEnv; missing?: string[] } = {}
): Promise<{ failed: boolean; lines: Line[]; text: string }> {
  const missing = new Set(over.missing ?? []);
  const env = over.env ?? {
    FOUNDRY_SCRIBE_USER: 'Scribe Assistant',
    FOUNDRY_SCRIBE_PASSWORD: 'hunter2',
    SCRIBE_CAMPAIGN_REPO: campaignRoot,
    SCRIBE_PYTHON: 'C:\\py\\python.exe',
    SCRIBE_EDGE: 'C:\\edge\\msedge.exe',
  };
  const deps: DoctorDeps = {
    config: loadConfig(env),
    exec: async file => ({ code: 0, stdout: `${path.basename(file)} 1.0\n`, stderr: '' }),
    exists: p => !missing.has(p) && (p.startsWith('C:\\') || p.startsWith(campaignRoot)),
    host: 'local',
    envFile: { path: ENV_FILE, fromOverride: false },
    resolveHost: () => ({ serverUrl: 'http://localhost:30000/', worldId: 'lost-mine' }),
    getStatus: async () => ({
      status: 200,
      json: { active: true, version: '14.369', world: 'lost-mine', system: 'dnd5e', users: 1 },
    }),
    reader: async req => ({ ok: true, host: req.host, probe: PROBE }) as ReadResponse<never>,
    skillLink: () => 'here',
    ...over,
  };
  const lines: Line[] = [];
  const failed = await runDoctor(deps, l => lines.push(l));
  return { failed, lines, text: lines.map(formatLine).join('\n') };
}

describe('doctor', () => {
  it('passes a set-up machine, one ✓ line per check, and joins without a worldId', async () => {
    const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON });
    try {
      let asked: unknown;
      const r = await run(root, {
        reader: async req => {
          asked = req;
          return { ok: true, host: req.host, probe: PROBE } as ReadResponse<never>;
        },
      });
      expect(r.failed).toBe(false);
      expect(r.lines.every(l => l.mark === 'ok')).toBe(true);
      expect(r.text).toContain('✓ FOUNDRY_HOST=local → http://localhost:30000 (world lost-mine)');
      expect(r.text).toContain('"Scribe Assistant" is on /join and joined lost-mine');
      expect(r.text).toContain('dnd5e 6.0.6, By the Books 3.0.0); hung up');
      expect(r.text).toContain('role 3 (Assistant GM)');
      expect(r.text).toContain('names the joined world lost-mine');
      expect(asked).toEqual({ op: 'probe', host: 'local', timeoutMs: 90_000 });
    } finally {
      removeTempRepo(root);
    }
  });

  it('a scribe user not in the world is one ✗ line with the users and the fix', async () => {
    const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON });
    try {
      const error =
        "FOUNDRY_SCRIBE_USER 'Nobody' not found in the world on host 'local'; users: Gamemaster, " +
        'Scribe Assistant — set FOUNDRY_SCRIBE_USER to an existing Assistant GM (the bridge’s user will do), or create it as one.';
      const r = await run(root, { reader: async req => ({ ok: false, host: req.host, error }) });
      expect(r.failed).toBe(true);
      expect(r.text).toContain(`✗ ${error}`);
      expect(r.text).not.toContain('role');
    } finally {
      removeTempRepo(root);
    }
  });

  it('refusals the probe carries become their own lines', async () => {
    const root = makeTempRepo({ 'campaign.json': { ...CAMPAIGN_JSON, worldId: 'other' } });
    try {
      const probe: WorldProbe = {
        ...PROBE,
        user: { name: 'Scribe Assistant', role: 2, isGM: false },
      };
      const r = await run(root, {
        reader: async req => ({ ok: false, host: req.host, probe, error: 'refused' }),
      });
      expect(r.failed).toBe(true);
      expect(r.text).toContain('✓ "Scribe Assistant" is on /join');
      expect(r.text).toMatch(/✗ "Scribe Assistant" has role 2: the scribe needs Assistant GM/);
      expect(r.text).toMatch(/✗ campaign\.json's worldId is other but host local runs lost-mine/);
    } finally {
      removeTempRepo(root);
    }
  });

  it('an unreachable host skips the join and says how to start the sandbox', async () => {
    const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON });
    try {
      let joined = false;
      const r = await run(root, {
        getStatus: async () => {
          throw new Error('fetch failed');
        },
        reader: async req => {
          joined = true;
          return { ok: false, host: req.host, error: 'x' };
        },
      });
      expect(r.failed).toBe(true);
      expect(joined).toBe(false);
      expect(r.text).toContain('✗ http://localhost:30000 unreachable (fetch failed): start it');
      const idle = await run(root, {
        getStatus: async () => ({ status: 200, json: { active: false, version: '14.369' } }),
      });
      expect(idle.text).toContain('no world is running');
    } finally {
      removeTempRepo(root);
    }
  });

  it('the transcription toolchain and the skill link are ! only; config slips are ✗', async () => {
    const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON });
    try {
      const r = await run(root, {
        missing: ['C:\\py\\python.exe'],
        exec: async file =>
          file === 'ffmpeg'
            ? { code: null, stdout: '', stderr: 'ENOENT' }
            : { code: 0, stdout: '1.0', stderr: '' },
        skillLink: () => 'dangling',
      });
      expect(r.failed).toBe(false);
      expect(r.text).toMatch(/^! Python venv \(transcription only/m);
      expect(r.text).toMatch(/^! ffmpeg \(transcription only/m);
      expect(r.text).toMatch(
        /^! .*session-scribe is a link to a missing folder: run npm run install-skill/m
      );

      const bad = await run(root, {
        envFile: { path: 'D:\\nope\\.env', fromOverride: true },
        resolveHost: () => {
          throw new Error('FOUNDRY_URL is not set');
        },
        env: { SCRIBE_EDGE: 'C:\\edge\\msedge.exe' },
        missing: ['C:\\edge\\msedge.exe'],
      });
      expect(bad.failed).toBe(true);
      expect(bad.text).toContain('✗ FVTT_MCP_ENV points at D:\\nope\\.env, which does not exist');
      expect(bad.text).toContain('✗ FOUNDRY_HOST=local: FOUNDRY_URL is not set');
      expect(bad.text).toContain('✗ scribe login: FOUNDRY_SCRIBE_USER is not set');
      expect(bad.text).toContain('✗ SCRIBE_CAMPAIGN_REPO: SCRIBE_CAMPAIGN_REPO is not set');
      expect(bad.text).toMatch(/✗ PDF browser \(render-pdf\): .*missing/);
    } finally {
      removeTempRepo(root);
    }
  });
});
