import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandPath, loadConfig } from '../config.js';
import type { WorldReader } from '../foundry/read.js';
import type { Exec } from '../health.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import { type StatusDeps, StatusTool } from './status.js';

describe('scribe-status record', () => {
  it('summarises the record, details one session, and reports a broken repo without failing', async () => {
    const root = makeTempRepo({
      'campaign.json': CAMPAIGN_JSON,
      'sessions/2026-01-06/recap.md': '#',
    });
    try {
      const env = { SCRIBE_CAMPAIGN_REPO: root };
      const tool = new StatusTool(deps({ env }));
      const all = await tool.handleStatus({});
      expect(all.record?.campaign).toBe('The Lost Mine of Phandelver');
      expect(all.record?.sessions.map(s => s.dir)).toEqual(['2026-01-06']);
      const one = await tool.handleStatus({ date: '2026-01-06' });
      expect(one.session?.outputs.recap?.present).toEqual(['recap.md']);
      const miss = await tool.handleStatus({ date: '2026-02-02' });
      expect(miss.recordError).toMatch(/no session directory/);
    } finally {
      removeTempRepo(root);
    }
    const broken = await new StatusTool(deps()).handleStatus({});
    expect(broken.recordError).toMatch(/campaign\.json: not found/);
  });
});

const ENV = {
  FOUNDRY_SCRIBE_USER: 'Scribe Assistant',
  FOUNDRY_SCRIBE_PASSWORD: 'hunter2',
  SCRIBE_CAMPAIGN_REPO: 'C:\\camp',
  SCRIBE_PYTHON: 'C:\\py\\python.exe',
  SCRIBE_EDGE: 'C:\\edge\\msedge.exe',
  SystemRoot: 'C:\\Windows',
};

const noReader: WorldReader = async req => ({
  ok: false,
  host: req.host,
  error: 'not in this test',
});

function deps(
  over: { env?: NodeJS.ProcessEnv; missing?: string[]; exec?: Exec; reader?: WorldReader } = {}
): StatusDeps {
  const missing = new Set(over.missing ?? []);
  return {
    config: loadConfig(over.env ?? ENV),
    exec:
      over.exec ??
      (async file => ({ code: 0, stdout: `${path.basename(file)} 1.0\n`, stderr: '' })),
    exists: p => !missing.has(p),
    reader: over.reader ?? noReader,
  };
}

describe('scribe-status', () => {
  it('is ready when every probe passes, and never prints the password', async () => {
    const out = await new StatusTool(deps()).handleStatus({});
    expect(out.ready).toBe(true);
    expect(out.defaultHost).toBe('generic');
    expect(out.checks.identity.detail).toBe('"Scribe Assistant" (password set)');
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(out.checks.python.detail).toContain('C:\\py\\python.exe');
  });

  it('names the fix for a missing venv, campaign repo, login and browser', async () => {
    const out = await new StatusTool(
      deps({
        env: { SCRIBE_PYTHON: 'C:\\py\\python.exe', SCRIBE_EDGE: 'C:\\edge\\msedge.exe' },
        missing: ['C:\\py\\python.exe', 'C:\\edge\\msedge.exe'],
      })
    ).handleStatus({});
    expect(out.ready).toBe(false);
    expect(out.checks.python.detail).toMatch(/setup\.ps1/);
    expect(out.checks.campaignRepo.detail).toMatch(/SCRIBE_CAMPAIGN_REPO/);
    expect(out.checks.identity.detail).toMatch(/FOUNDRY_SCRIBE_USER/);
    expect(out.checks.edge.detail).toMatch(/SCRIBE_EDGE/);
  });

  it('flags a campaign repo without campaign.json and a set user without a password', async () => {
    const out = await new StatusTool(
      deps({
        env: { ...ENV, FOUNDRY_SCRIBE_PASSWORD: '' },
        missing: [path.join('C:\\camp', 'campaign.json')],
      })
    ).handleStatus({});
    expect(out.checks.campaignRepo).toEqual({ ok: false, detail: 'C:\\camp has no campaign.json' });
    expect(out.checks.identity.detail).toMatch(/FOUNDRY_SCRIBE_PASSWORD is not set/);
  });

  it('reports a command that fails to run', async () => {
    const exec: Exec = async file =>
      file === 'ffmpeg'
        ? { code: null, stdout: '', stderr: 'spawn ffmpeg ENOENT' }
        : { code: 0, stdout: 'ok\n', stderr: '' };
    const out = await new StatusTool(deps({ exec })).handleStatus({});
    expect(out.checks.ffmpeg).toEqual({
      ok: false,
      detail: 'ffmpeg not on PATH: run scripts/setup.ps1',
    });
    expect(out.ready).toBe(false);
  });
});

describe('config', () => {
  it('expands %VAR% paths and defaults an unset or unknown host to generic', () => {
    expect(expandPath('%USERPROFILE%\\x', { USERPROFILE: 'C:\\Users\\u' })).toBe('C:\\Users\\u\\x');
    expect(expandPath('%NOPE%\\x', {})).toBe('%NOPE%\\x');
    expect(loadConfig({ FOUNDRY_HOST: 'LOCAL' }).defaultHost).toBe('local');
    expect(loadConfig({ FOUNDRY_HOST: 'molten' }).defaultHost).toBe('molten');
    expect(loadConfig({ FOUNDRY_HOST: 'generic' }).defaultHost).toBe('generic');
    expect(loadConfig({ FOUNDRY_HOST: 'forge' }).defaultHost).toBe('generic');
    expect(loadConfig({}).defaultHost).toBe('generic');
    expect(loadConfig({ SystemRoot: 'D:\\Win' }).tar).toBe(
      path.join('D:\\Win', 'System32', 'tar.exe')
    );
  });
});

describe('scribe-status connect', () => {
  it('joins through the reader with the campaign worldId and reports the world', async () => {
    const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON });
    try {
      const seen: unknown[] = [];
      const reader: WorldReader = async req => {
        seen.push(req);
        return { ok: true, host: req.host, readAt: '2026-01-01T00:00:00.000Z' };
      };
      const tool = new StatusTool(deps({ env: { ...ENV, SCRIBE_CAMPAIGN_REPO: root }, reader }));
      const off = await tool.handleStatus({});
      expect(off.world).toBeUndefined();
      expect(seen).toEqual([]);
      const on = await tool.handleStatus({ connect: true, host: 'local' });
      expect(seen).toEqual([{ op: 'probe', host: 'local', worldId: 'lost-mine' }]);
      expect(on.world).toEqual({ ok: true, host: 'local', readAt: '2026-01-01T00:00:00.000Z' });
    } finally {
      removeTempRepo(root);
    }
  });

  it('still proves the login when there is no campaign to check against', async () => {
    const seen: unknown[] = [];
    const reader: WorldReader = async req => {
      seen.push(req);
      return { ok: false, host: req.host, error: 'world not running' };
    };
    const out = await new StatusTool(deps({ reader })).handleStatus({ connect: true });
    expect(seen).toEqual([{ op: 'probe', host: 'generic' }]);
    expect(out.world).toEqual({ ok: false, host: 'generic', error: 'world not running' });
  });
});
