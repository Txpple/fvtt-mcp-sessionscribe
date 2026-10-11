// `npm run doctor`: the whole setup checked in one pass, one actionable line per check, in the
// order a new machine has to fix them. scripts/doctor.mjs checks the two builds (this one cannot
// load without them) and runs this with the real machine; the tests run it on fakes.
//
//   ✓  works        ✗  blocks a session (the doctor exits non-zero)        !  worth knowing
//
// The Foundry checks reuse the real read path: one `probe` through the reader child, exactly what
// every tool does first (the scribe's user, admin key stripped, page bundle injected), hung up
// before it exits. The probe is asked without campaign.json's worldId so the join, the role and
// the world are three separate lines instead of one refusal. Nothing is written to the world.

import { loadCampaign } from './campaign.js';
import type { HostName } from './config.js';
import { rulesModuleLabel } from './foundry/protocol.js';
import type { WorldReader } from './foundry/read.js';
import {
  type HealthDeps,
  type Probe,
  probeCampaignRepo,
  probeEdge,
  probeFfmpeg,
  probeIdentity,
  probePython,
} from './health.js';

export type Mark = 'ok' | 'fail' | 'warn';
export interface Line {
  mark: Mark;
  text: string;
}

const GLYPH: Record<Mark, string> = { ok: '✓', fail: '✗', warn: '!' };
export const formatLine = (l: Line): string => `${GLYPH[l.mark]} ${l.text}`;

/** What /api/status answered: its HTTP status and, when it was JSON, the body. */
export interface StatusReply {
  status: number;
  json?: unknown;
}

export interface DoctorDeps extends HealthDeps {
  host: HostName;
  /** fvtt-mcp-dnd5e's .env as its client resolves it (FVTT_MCP_ENV, else that repo's .env). */
  envFile: { path: string; fromOverride: boolean };
  /** The host's URL and expected world from that .env; throws the client's refusal (a placeholder). */
  resolveHost: () => { serverUrl: string; worldId?: string };
  /** GET a URL; throws on a network failure or timeout. */
  getStatus: (url: string) => Promise<StatusReply>;
  reader: WorldReader;
  /** Where ~/.claude/skills/session-scribe resolves: 'here' (this repo's skill), a path, or null. */
  skillLink: () => 'here' | 'missing' | 'dangling' | 'real-dir' | { elsewhere: string };
  /** The join's own budget; the doctor should not wait four minutes on a hung world. */
  joinTimeoutMs?: number;
}

const ok = (text: string): Line => ({ mark: 'ok', text });
const fail = (text: string): Line => ({ mark: 'fail', text });
const warn = (text: string): Line => ({ mark: 'warn', text });
const fromProbe = (p: Probe, label: string, missing: Mark = 'fail'): Line => ({
  mark: p.ok ? 'ok' : missing,
  text: `${label}: ${p.detail}`,
});

interface FoundryStatus {
  active?: boolean;
  version?: string;
  world?: string;
  system?: string;
  users?: number;
}

/** Run every check, handing each line to `emit` as it lands. Answers whether any line is ✗. */
export async function runDoctor(deps: DoctorDeps, emit: (l: Line) => void): Promise<boolean> {
  let failed = false;
  const out = (l: Line): void => {
    if (l.mark === 'fail') failed = true;
    emit(l);
  };
  const { host } = deps;

  // fvtt-mcp-dnd5e's .env: the Foundry connection lives there, not here
  const env = deps.envFile;
  if (deps.exists(env.path)) {
    out(ok(`fvtt-mcp-dnd5e .env: ${env.path}${env.fromOverride ? ' (FVTT_MCP_ENV)' : ''}`));
  } else {
    out(
      fail(
        env.fromOverride
          ? `FVTT_MCP_ENV points at ${env.path}, which does not exist: fix the path or unset it`
          : `${env.path} missing: copy fvtt-mcp-dnd5e's .env.example to .env there and fill in FOUNDRY_URL`
      )
    );
  }

  // FOUNDRY_HOST → a URL, and the URL answers
  let serverUrl: string | undefined;
  try {
    const h = deps.resolveHost();
    serverUrl = h.serverUrl.replace(/\/+$/, '');
    out(ok(`FOUNDRY_HOST=${host} → ${serverUrl}${h.worldId ? ` (world ${h.worldId})` : ''}`));
  } catch (e) {
    out(fail(`FOUNDRY_HOST=${host}: ${e instanceof Error ? e.message : String(e)}`));
  }
  let reachable = false;
  if (serverUrl) {
    reachable = await checkReachable(deps, serverUrl, out);
  }

  // the scribe's login, then one real join through the reader child
  const identity = probeIdentity(deps);
  if (!identity.ok) out(fromProbe(identity, 'scribe login'));
  let joinedWorld: string | undefined;
  if (identity.ok && reachable) {
    joinedWorld = await checkJoin(deps, out);
  }

  // the campaign repo, and that it names the world the scribe just joined
  const repo = probeCampaignRepo(deps);
  if (!repo.ok) {
    out(fromProbe(repo, 'SCRIBE_CAMPAIGN_REPO'));
  } else {
    try {
      const c = loadCampaign(deps.config.campaignRepo);
      if (!joinedWorld) {
        out(ok(`campaign "${c.name}" (world ${c.worldId}): ${c.root}`));
      } else if (joinedWorld === c.worldId) {
        out(ok(`campaign "${c.name}" names the joined world ${c.worldId}: ${c.root}`));
      } else {
        out(
          fail(
            `campaign.json's worldId is ${c.worldId} but host ${host} runs ${joinedWorld}: every ` +
              'read into this campaign is refused there. Point SCRIBE_CAMPAIGN_REPO at the ' +
              "world's campaign, or FOUNDRY_HOST at the campaign's host"
          )
        );
      }
    } catch (e) {
      out(fail(`campaign.json: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  // the machine's toolchain
  out(fromProbe(probeEdge(deps), 'PDF browser (render-pdf)'));
  out(skillLine(deps.skillLink()));
  const [python, ffmpeg] = await Promise.all([probePython(deps), probeFfmpeg(deps)]);
  const transcription = 'transcription only: run scripts/setup.ps1';
  out(
    python.ok
      ? ok(`Python venv: ${python.detail}`)
      : warn(`Python venv (${transcription}): ${python.detail}`)
  );
  out(
    ffmpeg.ok ? ok(`ffmpeg: ${ffmpeg.detail}`) : warn(`ffmpeg (${transcription}): ${ffmpeg.detail}`)
  );
  return failed;
}

async function checkReachable(
  deps: DoctorDeps,
  serverUrl: string,
  out: (l: Line) => void
): Promise<boolean> {
  const url = `${serverUrl}/api/status`;
  let reply: StatusReply;
  try {
    reply = await deps.getStatus(url);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const start =
      deps.host === 'local'
        ? 'start it: node ../fvtt-mcp-dnd5e/scripts/local-foundry.mjs start'
        : 'check FOUNDRY_URL and that the server is up';
    out(fail(`${serverUrl} unreachable (${why}): ${start}`));
    return false;
  }
  const s = reply.json as FoundryStatus | undefined;
  if (reply.status !== 200 || !s || typeof s !== 'object' || !('active' in s)) {
    // A hosted box that is asleep answers its own page; the join wakes it (FOUNDRY_WAKE_URL).
    out(
      warn(
        `${url} answered HTTP ${reply.status} without Foundry's status: asleep or not Foundry; ` +
          'the join below wakes a sleeping hosted box'
      )
    );
    return true;
  }
  if (!s.active) {
    out(
      fail(
        `Foundry ${s.version ?? '?'} is up at ${serverUrl} but no world is running: launch it ` +
          '(the scribe never launches a world)'
      )
    );
    return false;
  }
  out(
    ok(
      `Foundry ${s.version ?? '?'} reachable, world ${s.world ?? '?'} running` +
        `${s.system ? ` (${s.system})` : ''}, ${s.users ?? 0} user(s) connected`
    )
  );
  return true;
}

/** One join as the scribe. Answers the joined world's id, or undefined when the join failed. */
async function checkJoin(deps: DoctorDeps, out: (l: Line) => void): Promise<string | undefined> {
  const user = deps.config.scribeUser;
  const r = await deps.reader({
    op: 'probe',
    host: deps.host,
    timeoutMs: deps.joinTimeoutMs ?? 90_000,
  });
  const p = r.probe;
  if (!p) {
    const error = r.error ?? 'no reply';
    // protocol.scribeUserMissing() has already said it all: the variable, the users, the fix
    out(
      fail(error.startsWith('FOUNDRY_SCRIBE_USER') ? error : `join as "${user}" failed: ${error}`)
    );
    return undefined;
  }
  out(
    ok(
      `"${p.user.name}" is on /join and joined ${p.worldId} (Foundry ${p.foundryVersion}, ` +
        `${p.system.id} ${p.system.version}, ${rulesModuleLabel(p.bythebooks)}); hung up`
    )
  );
  if (!p.user.isGM) {
    out(
      fail(
        `"${p.user.name}" has role ${p.user.role}: the scribe needs Assistant GM (3) to see ` +
          'whispers and GM cards. Raise it in Foundry’s User Management'
      )
    );
  } else {
    const role = p.user.role === 3 ? 'Assistant GM' : 'Gamemaster; Assistant GM is enough';
    out(ok(`"${p.user.name}" has role ${p.user.role} (${role})`));
  }
  if (p.activeGM?.isSelf && p.combatActive) {
    out(
      warn(
        'the scribe was the elected GM with a combat running, so a real read would be refused ' +
          'now: connect the DM’s client first, or end the combat'
      )
    );
  }
  return p.worldId;
}

function skillLine(link: ReturnType<DoctorDeps['skillLink']>): Line {
  const fix = 'run npm run install-skill';
  if (link === 'here') return ok('session-scribe skill linked into ~/.claude/skills');
  if (link === 'missing') return warn(`session-scribe skill not in ~/.claude/skills: ${fix}`);
  if (link === 'dangling') {
    return warn(`~/.claude/skills/session-scribe is a link to a missing folder: ${fix}`);
  }
  if (link === 'real-dir') {
    return warn(
      '~/.claude/skills/session-scribe is a copy, not a link: it will not follow this repo ' +
        '(move it away, then npm run install-skill)'
    );
  }
  return warn(`~/.claude/skills/session-scribe links to ${link.elsewhere}, not this repo: ${fix}`);
}
